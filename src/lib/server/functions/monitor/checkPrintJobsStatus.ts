import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getAdminClient } from '../pocketbase/getAdminClient';
import type { PrintJobsRecord } from '../../pocketbase';
import { inactiveTimestamps, missingJobTimestamps } from './timestamps';
import { updateJobStatus } from './updateJobStatus';
import { GRACE_PERIOD_MS } from './constants';
import { getPrintedPages } from './getPrintedPages';

const execAsync = promisify(exec);

export async function checkPrintJobsStatus(): Promise<void> {
	try {
		const pb = await getAdminClient();

		// Fetch all jobs that are still active (pending or processing) and have a cups_job_id
		const activeJobs = await pb.collection('print_jobs').getFullList<PrintJobsRecord>({
			filter: '(status = "pending" || status = "processing") && cups_job_id != null'
		});

		if (activeJobs.length === 0) {
			return;
		}

		console.log(`[Monitor] Checking status for ${activeJobs.length} active print jobs...`);

		// Fetch active jobs and history detailed blocks from CUPS
		let activeOutput = '';
		let allOutput = '';
		let printerStatusOutput = '';
		try {
			const { stdout: activeOut } = await execAsync('lpstat -o', { shell: '/bin/bash' });
			activeOutput = activeOut;
			const { stdout: allOut } = await execAsync('lpstat -l -W all -o', { shell: '/bin/bash' });
			allOutput = allOut;
			const { stdout: printerOut } = await execAsync('lpstat -p', { shell: '/bin/bash' });
			printerStatusOutput = printerOut;
		} catch (err) {
			console.error('[Monitor] lpstat is not available. CUPS might be offline. Please contact Bornzi.', err);
			return;
		}

		// Split output into detailed job blocks (each block starts with alphanumeric character, e.g., printer name)
		const allBlocks = allOutput.split(/^(?=[A-Za-z0-9])/m).filter(Boolean);

		for (const job of activeJobs) {
			if (job.cups_job_id === null || job.cups_job_id <= 0) {
				continue;
			}
			const jobIdentifier = `${job.printer_name}-${job.cups_job_id}`;
			const isActive = activeOutput.includes(jobIdentifier) || printerStatusOutput.includes(jobIdentifier);

			if (isActive) {
				// The job is still in the active queue
				// If it was temporarily in inactive state, clear it
				inactiveTimestamps.delete(job.id);

				const matchingBlock = allBlocks.find((block) => block.trim().startsWith(jobIdentifier));
				if (matchingBlock) {
					const blockLower = matchingBlock.toLowerCase();
					if (blockLower.includes('pend') || blockLower.includes('hold')) {
						if (job.status !== 'pending') {
							await updateJobStatus(pb, job, 'pending');
						}
					} else {
						if (job.status !== 'processing') {
							await updateJobStatus(pb, job, 'processing');
						}
					}
				}
			} else {
				// The job is no longer in the active queue (meaning it has completed or failed)
				const matchingBlock = allBlocks.find((block) => block.trim().startsWith(jobIdentifier));
				if (matchingBlock) {
					const blockLower = matchingBlock.toLowerCase();

					if (blockLower.includes('cancel')) {
						inactiveTimestamps.delete(job.id);
						// เครื่องปริ้นยกเลิกงาน ตรวจสอบหน้าจริงที่พิมพ์ออกมาเพื่อหักเฉพาะส่วนนั้นและคืนที่เหลือ
						const { printed, isLogEnabled } = await getPrintedPages(job.cups_job_id);
						if (isLogEnabled) {
							const toRefund = Math.max(0, job.pages - printed);
							await updateJobStatus(
								pb,
								job,
								'failed',
								`Canceled at printer / Out of paper (Printed ${printed}/${job.pages} pages)`,
								toRefund,
								printed
							);
						} else {
							await updateJobStatus(pb, job, 'failed', 'Canceled at printer / Out of paper', job.pages);
						}
					} else if (
						blockLower.includes('fail') ||
						blockLower.includes('abort') ||
						blockLower.includes('error')
					) {
						inactiveTimestamps.delete(job.id);
						const { printed, isLogEnabled } = await getPrintedPages(job.cups_job_id);
						if (isLogEnabled) {
							const toRefund = Math.max(0, job.pages - printed);
							await updateJobStatus(
								pb,
								job,
								'failed',
								`Failed at printer (Printed ${printed}/${job.pages} pages)`,
								toRefund,
								printed
							);
						} else {
							await updateJobStatus(pb, job, 'failed', 'Failed at printer', job.pages);
						}
					} else {
						// เช็คประวัติการพิมพ์จริงทันทีก่อนใช้ Grace Period
						// หากพิมพ์สำเร็จครบจำนวนหน้าแล้ว ให้ตั้งเสร็จสมบูรณ์ (Completed) ทันทีเพื่อปิดรูรั่วปุ่มกดยกเลิก
						const { printed, isLogEnabled } = await getPrintedPages(job.cups_job_id);
						if (isLogEnabled && printed >= job.pages) {
							inactiveTimestamps.delete(job.id);
							await updateJobStatus(pb, job, 'completed');
						} else {
							// หากยังพิมพ์ไม่ครบ หรือปิดการใช้ log ไว้ ให้เข้าสู่ระบบตรวจสอบ Grace period
							if (!inactiveTimestamps.has(job.id)) {
								inactiveTimestamps.set(job.id, Date.now());
								console.log(`[Monitor] Job ${job.id} (CUPS #${job.cups_job_id}) left active queue. Starting ${GRACE_PERIOD_MS / 1000}s grace period for printer sync...`);
							} else {
								const elapsed = Date.now() - inactiveTimestamps.get(job.id)!;
								if (elapsed > GRACE_PERIOD_MS) {
									inactiveTimestamps.delete(job.id);

									if (isLogEnabled) {
										if (printed < job.pages) {
											// พิมพ์ได้บางส่วนแล้วแท่นหยุด/ยกเลิกกลางคัน คืนสิทธิ์หน้าที่เหลือ และปรับเลขหน้าในประวัติเป็นพิมพ์จริง
											const toRefund = Math.max(0, job.pages - printed);
											await updateJobStatus(
												pb,
												job,
												'failed',
												`Canceled at printer / Out of paper (Printed ${printed}/${job.pages} pages)`,
												toRefund,
												printed
											);
										} else {
											// พิมพ์ครบทุกหน้าเรียบร้อย
											await updateJobStatus(pb, job, 'completed');
										}
									} else {
										// หากระบบปิดการบันทึก log ไว้ ให้ fallback เป็นสำเร็จสมบูรณ์ตามสเตตัส CUPS
										await updateJobStatus(pb, job, 'completed');
									}
								}
							}
						}
					}
				} else {
					// If the job is completely missing from CUPS queue and history:
					// We start a grace period from when we first notice it is missing,
					// to give CUPS time to write to the page_log.
					if (!missingJobTimestamps.has(job.id)) {
						missingJobTimestamps.set(job.id, Date.now());
						console.log(`[Monitor] Job ${job.id} (CUPS #${job.cups_job_id}) is missing from lpstat. Waiting for sync...`);
					} else {
						const elapsed = Date.now() - missingJobTimestamps.get(job.id)!;
						if (elapsed > GRACE_PERIOD_MS) {
							missingJobTimestamps.delete(job.id);
							console.log(`[Monitor] Job ${job.id} (CUPS #${job.cups_job_id}) has been missing from lpstat for ${Math.round(elapsed / 1000)}s. Verifying via page_log...`);
							const { printed, isLogEnabled } = await getPrintedPages(job.cups_job_id);
							if (isLogEnabled) {
								const toRefund = Math.max(0, job.pages - printed);
								if (printed > 0) {
									await updateJobStatus(
										pb,
										job,
										'completed',
										undefined,
										toRefund,
										printed
									);
								} else {
									await updateJobStatus(pb, job, 'failed', 'Job disappeared from CUPS without printing pages');
								}
							} else {
								// Fallback if log is disabled
								await updateJobStatus(pb, job, 'completed');
							}
						}
					}
				}
			}
		}
	} catch (err) {
		console.error('[Monitor] Error in checkPrintJobsStatus:', err);
	}
}
