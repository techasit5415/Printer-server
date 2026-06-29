import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/private';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { refundQuota } from './quota';
import type { PrintJobsRecord } from './pocketbase';
import { serverEnv } from './env';

const execAsync = promisify(exec);

// ปรับค่าหน่วงเวลาสำหรับการทำงานของระบบ Monitor (มิลลิวินาที)
const GRACE_PERIOD_MS = 2000;       // ระยะเวลาเพื่อรอเครื่องพิมพ์ซิงค์ข้อมูลลง log (เดิม 4000ms / 4 วินาที)
const MISSING_JOB_AGE_MS = 4000;    // อายุงานขั้นต่ำที่จะถือว่างานพิมพ์เสร็จสิ้นหากคิวหายไป (เดิม 8000ms / 8 วินาที)

let pbAdmin: PocketBase | null = null;

async function getAdminClient(): Promise<PocketBase> {
	if (pbAdmin && pbAdmin.authStore.isValid) return pbAdmin;

	const pocketbaseUrl = serverEnv.pocketbaseUrl;
	pbAdmin = new PocketBase(pocketbaseUrl);
	pbAdmin.autoCancellation(false);

	if (env.PB_ADMIN_EMAIL && env.PB_ADMIN_PASSWORD) {
		try {
			await pbAdmin.admins.authWithPassword(env.PB_ADMIN_EMAIL, env.PB_ADMIN_PASSWORD);
			console.log('[Monitor] Authenticated successfully as PB Admin.');
		} catch (authErr) {
			console.error('[Monitor] Failed to authenticate as PB Admin:', authErr);
		}
	} else {
		console.warn('[Monitor] PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD is not set. Real-time updates might fail.');
	}

	return pbAdmin;
}

async function updateJobStatus(
	pb: PocketBase,
	job: PrintJobsRecord,
	newStatus: 'completed' | 'failed' | 'processing' | 'pending',
	errorMessage?: string,
	refundPages?: number,
	actualPages?: number
): Promise<void> {
	console.log(`[Monitor] Updating job ${job.id} (CUPS #${job.cups_job_id}) from "${job.status}" to "${newStatus}"`);

	try {
		const updatePayload: any = {
			status: newStatus,
			error_message: errorMessage || null
		};
		if (actualPages !== undefined) {
			updatePayload.pages = actualPages;
		}
		await pb.collection('print_jobs').update(job.id, updatePayload);
	} catch (dbErr) {
		console.error(`[Monitor] Failed to update job status for ${job.id} in DB:`, dbErr);
		return;
	}

	const pagesToRefund = refundPages !== undefined ? refundPages : (newStatus === 'failed' ? job.pages : 0);

	if (pagesToRefund > 0) {
		try {
			console.log(`[Monitor] Refunding ${pagesToRefund} pages to user ${job.user} for job ${job.id}`);
			await refundQuota(pb, job.user, pagesToRefund);
		} catch (refundErr) {
			console.error(`[Monitor] Failed to refund user ${job.user} for job ${job.id}:`, refundErr);
		}
	}
}

/**
 * ดึงจำนวนหน้าจริงที่พิมพ์เสร็จออกจากเครื่องปริ้นจริงจาก /var/log/cups/page_log
 */
async function getPrintedPages(cupsJobId: number): Promise<{ printed: number; isLogEnabled: boolean }> {
	try {
		// ค้นหาบรรทัดของ Job ID นี้ในไฟล์ page_log
		const cmd = `grep -E '^[^ ]+\\s+[^ ]+\\s+${cupsJobId}\\b' /var/log/cups/page_log`;
		const { stdout } = await execAsync(cmd, { shell: '/bin/bash' });

		let totalFromLog: number | null = null;
		let pageSum = 0;
		const lines = stdout.split('\n').filter(Boolean);
		for (const line of lines) {
			const bracketIndex = line.indexOf(']');
			if (bracketIndex !== -1) {
				const afterDate = line.substring(bracketIndex + 1).trim();
				const tokens = afterDate.split(/\s+/);
				if (tokens.length >= 2) {
					const pageNumOrTotal = tokens[0];
					const copiesOrPages = parseInt(tokens[1], 10);
					if (Number.isInteger(copiesOrPages) && copiesOrPages > 0) {
						if (pageNumOrTotal.toLowerCase() === 'total') {
							totalFromLog = copiesOrPages;
						} else {
							pageSum += copiesOrPages;
						}
					}
				}
			}
		}

		const printed = totalFromLog !== null ? totalFromLog : pageSum;
		return { printed, isLogEnabled: true };
	} catch (err: any) {
		// grep จะคืนค่า exit code 1 หากไม่พบประวัติในไฟล์ (แปลว่าไฟล์เปิดได้ แต่ยังไม่มีหน้าใดพิมพ์สำเร็จเลย)
		if (err && err.code === 1) {
			try {
				// เช็คความเคลื่อนไหวล่าสุดของไฟล์เพื่อตรวจสอบว่าระบบเปิดบันทึก page_log อยู่จริงไหม
				const { stdout: tailOut } = await execAsync('tail -n 10 /var/log/cups/page_log', { shell: '/bin/bash' });
				const isLogEnabled = tailOut.trim().length > 0;
				return { printed: 0, isLogEnabled };
			} catch {
				return { printed: 0, isLogEnabled: false };
			}
		}

		// เปิดไฟล์ไม่ได้ หรือไม่มีสิทธิ์อ่าน
		return { printed: 0, isLogEnabled: false };
	}
}

// Map to track when jobs left the active queue to enforce a sync grace period
const inactiveTimestamps = new Map<string, number>();

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
		let useMock = false;
		try {
			const { stdout: activeOut } = await execAsync('lpstat -o', { shell: '/bin/bash' });
			activeOutput = activeOut;
			const { stdout: allOut } = await execAsync('lpstat -l -W all -o', { shell: '/bin/bash' });
			allOutput = allOut;
		} catch (err) {
			// lpstat failed (probably running on Windows local dev or CUPS is offline)
			useMock = true;
		}

		if (useMock) {
			console.log('[Monitor] lpstat is not available. Simulating print queue status updates (Mock Mode)...');
			for (const job of activeJobs) {
				const ageMs = Date.now() - new Date(job.created).getTime();
				if (job.status === 'pending') {
					await updateJobStatus(pb, job, 'processing');
				} else if (job.status === 'processing' && ageMs > 10000) {
					// After 10 seconds, auto-complete the job
					await updateJobStatus(pb, job, 'completed');
				}
			}
			return;
		}

		// Split output into detailed job blocks (each block starts with alphanumeric character, e.g., printer name)
		const allBlocks = allOutput.split(/^(?=[A-Za-z0-9])/m).filter(Boolean);

		for (const job of activeJobs) {
			if (job.cups_job_id === null) {
				continue;
			}
			const jobIdentifier = `${job.printer_name}-${job.cups_job_id}`;
			const isActive = activeOutput.includes(jobIdentifier);

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
					// If it has been at least MISSING_JOB_AGE_MS since the job was created, it means
					// the print job has finished printing and was removed from history.
					const ageMs = Date.now() - new Date(job.created).getTime();
					if (ageMs > MISSING_JOB_AGE_MS) {
						inactiveTimestamps.delete(job.id);
						console.log(`[Monitor] Job ${job.id} (CUPS #${job.cups_job_id}) is missing from lpstat and is ${Math.round(ageMs/1000)}s old. Assuming completed.`);
						await updateJobStatus(pb, job, 'completed');
					} else {
						console.log(`[Monitor] Job ${job.id} (CUPS #${job.cups_job_id}) is brand new (${Math.round(ageMs/1000)}s old) and not yet listed. Waiting...`);
					}
				}
			}
		}
	} catch (err) {
		console.error('[Monitor] Error in checkPrintJobsStatus:', err);
	}
}

const GLOBAL_MONITOR_KEY = Symbol.for('antigravity.print_job_monitor');

export function startPrintJobMonitor(intervalMs = 5000): void {
	// Check if running on global object to prevent duplicate loops during Vite HMR
	if ((globalThis as any)[GLOBAL_MONITOR_KEY]) {
		return;
	}

	console.log(`[Monitor] Starting print job monitor (interval: ${intervalMs}ms)...`);

	// Run immediately once
	checkPrintJobsStatus();

	const interval = setInterval(async () => {
		await checkPrintJobsStatus();
	}, intervalMs);

	(globalThis as any)[GLOBAL_MONITOR_KEY] = interval;
}

export function stopPrintJobMonitor(): void {
	const interval = (globalThis as any)[GLOBAL_MONITOR_KEY];
	if (interval) {
		clearInterval(interval);
		delete (globalThis as any)[GLOBAL_MONITOR_KEY];
		console.log('[Monitor] Print job monitor stopped.');
	}
}
