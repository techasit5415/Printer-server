import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/private';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { refundQuota } from './quota';
import type { PrintJobsRecord } from './pocketbase';
import { serverEnv } from './env';

const execAsync = promisify(exec);

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
	errorMessage?: string
): Promise<void> {
	console.log(`[Monitor] Updating job ${job.id} (CUPS #${job.cups_job_id}) from "${job.status}" to "${newStatus}"`);

	try {
		await pb.collection('print_jobs').update(job.id, {
			status: newStatus,
			error_message: errorMessage || null
		});
	} catch (dbErr) {
		console.error(`[Monitor] Failed to update job status for ${job.id} in DB:`, dbErr);
		return;
	}

	if (newStatus === 'failed') {
		try {
			console.log(`[Monitor] Refunding ${job.pages} pages to user ${job.user} for failed job ${job.id}`);
			await refundQuota(pb, job.user, job.pages);
		} catch (refundErr) {
			console.error(`[Monitor] Failed to refund user ${job.user} for job ${job.id}:`, refundErr);
		}
	}
}

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
			const jobIdentifier = `${job.printer_name}-${job.cups_job_id}`;
			const isActive = activeOutput.includes(jobIdentifier);

			if (isActive) {
				// The job is still in the active queue
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
						await updateJobStatus(pb, job, 'failed', 'Canceled at printer / Out of paper');
					} else if (
						blockLower.includes('fail') ||
						blockLower.includes('abort') ||
						blockLower.includes('error')
					) {
						await updateJobStatus(pb, job, 'failed', 'Failed at printer');
					} else {
						// Not active and not canceled/failed -> Completed!
						await updateJobStatus(pb, job, 'completed');
					}
				} else {
					// If the job is completely missing from CUPS queue and history:
					// If it has been at least 8 seconds since the job was created, it means
					// the print job has finished printing and was removed from history.
					const ageMs = Date.now() - new Date(job.created).getTime();
					if (ageMs > 8000) {
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
