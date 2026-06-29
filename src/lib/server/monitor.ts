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

// Track missing count to avoid premature completion if CUPS clears the queue during a transient delay
const missingCounts = new Map<string, number>();

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

		// Fetch all jobs from CUPS history (both active and completed/canceled)
		let lpstatOutput = '';
		try {
			const { stdout } = await execAsync('lpstat -W all -o', { shell: '/bin/bash' });
			lpstatOutput = stdout;
		} catch (err) {
			console.error('[Monitor] Failed to query CUPS job status (lpstat error):', err);
			return;
		}

		const lines = lpstatOutput.split('\n');

		for (const job of activeJobs) {
			const jobIdentifier = `${job.printer_name}-${job.cups_job_id}`;
			const matchingLine = lines.find((line) => line.includes(jobIdentifier));

			if (matchingLine) {
				// Reset missing count if we found it
				missingCounts.delete(job.id);

				const lineLower = matchingLine.toLowerCase();

				if (lineLower.includes('cancel')) {
					await updateJobStatus(pb, job, 'failed', 'Canceled at printer / Out of paper');
				} else if (
					lineLower.includes('fail') ||
					lineLower.includes('abort') ||
					lineLower.includes('error')
				) {
					await updateJobStatus(pb, job, 'failed', 'Failed at printer');
				} else if (lineLower.includes('complete')) {
					await updateJobStatus(pb, job, 'completed');
				} else if (lineLower.includes('process') || lineLower.includes('print')) {
					if (job.status !== 'processing') {
						await updateJobStatus(pb, job, 'processing');
					}
				} else if (lineLower.includes('pend') || lineLower.includes('hold')) {
					if (job.status !== 'pending') {
						await updateJobStatus(pb, job, 'pending');
					}
				}
			} else {
				// If it is not found in lpstat output
				const count = (missingCounts.get(job.id) || 0) + 1;
				missingCounts.set(job.id, count);

				console.warn(
					`[Monitor] Job ${job.id} (CUPS #${job.cups_job_id}) not found in lpstat output (attempt ${count}/3)`
				);

				if (count >= 3) {
					missingCounts.delete(job.id);
					// Treat as completed if it completely disappeared from history without being marked canceled
					console.log(`[Monitor] Job ${job.id} has been missing for 3 checks. Assuming completed.`);
					await updateJobStatus(pb, job, 'completed');
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
