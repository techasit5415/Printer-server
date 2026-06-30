const GLOBAL_MONITOR_KEY = Symbol.for('antigravity.print_job_monitor');

export function stopPrintJobMonitor(): void {
	const interval = (globalThis as any)[GLOBAL_MONITOR_KEY];
	if (interval) {
		clearInterval(interval);
		delete (globalThis as any)[GLOBAL_MONITOR_KEY];
		console.log('[Monitor] Print job monitor stopped.');
	}
}
