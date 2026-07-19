/**
 * Centralised, type-safe access to private environment variables.
 *
 * SvelteKit only exposes `$env/static/private` to server-side code, so
 * this module is safe to import from any `+page.server.ts`,
 * `+server.ts`, or `hooks.server.ts`.
 */
import { env } from '$env/dynamic/private';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface ServerEnv {
	pocketbaseUrl: string;
	printerName: string;
	teacherPrinterName: string;
	tempDir: string;
	defaultQuotaPages: number;
	gracePeriodMs: number;
	missingJobAgeMs: number;
}

function readEnv(): ServerEnv {
	const pocketbaseUrl = env.PRIVATE_POCKETBASE_URL;
	const printerName = env.PRIVATE_PRINTER_NAME;
	const teacherPrinterName = env.PRIVATE_TEACHER_PRINTER_NAME || printerName;
	const tempDir = env.PRIVATE_TEMP_DIR;
	const defaultQuotaPages = env.PRIVATE_DEFAULT_QUOTA_PAGES;
	const gracePeriodRaw = env.PRIVATE_GRACE_PERIOD_MS;
	const missingJobAgeRaw = env.PRIVATE_MISSING_JOB_AGE_MS;

	if (!pocketbaseUrl) {
		throw new Error('Missing PRIVATE_POCKETBASE_URL environment variable.');
	}
	if (!printerName) {
		throw new Error('Missing PRIVATE_PRINTER_NAME environment variable.');
	}

	// Resolve `tempDir` to an absolute, writable path. The hard-coded
	// `/tmp` fallback was a Linux path that translated to `C:\tmp` on
	// Windows (often unwritable for non-admin users); `os.tmpdir()`
	// returns the platform-correct location — Windows users get
	// `%LOCALAPPDATA%\Temp`, macOS/Linux get `/var/folders/...` or
	// `/tmp`. If `PRIVATE_TEMP_DIR` is set we still trust it but make
	// it absolute so relative paths in `.env` work either way.
	const resolvedTempDir = path.resolve(
		tempDir && tempDir.length > 0 ? tempDir : tmpdir()
	);

	return {
		pocketbaseUrl: pocketbaseUrl.replace(/\/+$/, ''),
		printerName,
		teacherPrinterName,
		tempDir: resolvedTempDir,
		defaultQuotaPages:
			defaultQuotaPages && Number.isFinite(Number(defaultQuotaPages))
				? Math.max(0, Math.floor(Number(defaultQuotaPages)))
				: 0,
		gracePeriodMs:
			gracePeriodRaw && Number.isFinite(Number(gracePeriodRaw))
				? Math.max(0, Math.floor(Number(gracePeriodRaw)))
				: 6000,
		missingJobAgeMs:
			missingJobAgeRaw && Number.isFinite(Number(missingJobAgeRaw))
				? Math.max(0, Math.floor(Number(missingJobAgeRaw)))
				: 8000
	};
}

export const serverEnv: ServerEnv = readEnv();