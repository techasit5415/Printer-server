import { checkPrintJobsStatus } from './checkPrintJobsStatus';

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
