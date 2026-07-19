import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { serverEnv } from '../../env';

const execAsync = promisify(exec);

function sanitise(value: string, maxLen = 128): string {
	const cleaned = value.replace(/[^A-Za-z0-9._\- ]/g, '').trim();
	if (cleaned.length === 0) throw new Error(`Unsafe shell argument: "${value}"`);
	if (cleaned.length > maxLen) throw new Error(`Argument too long: ${cleaned.length} > ${maxLen}`);
	return cleaned;
}

export async function cancelPrintJob(cupsJobId: number, printerName?: string): Promise<void> {
	try {
		const printer = sanitise(printerName ?? serverEnv.printerName, 64);
		const cmd = `cancel '${printer}-${cupsJobId}'`;
		await execAsync(cmd, { shell: '/bin/bash' });
		console.log(`[Print] Canceled CUPS job ${printer}-${cupsJobId}`);
	} catch (err) {
		console.error(`[Print] Failed to cancel CUPS job ${cupsJobId}:`, err);
	}
}
