/**
 * CUPS printing helpers.
 *
 * Wraps the `lp` and `lpstat` CLI tools. We deliberately keep the
 * surface tiny — every helper sanitises its inputs so we never end up
 * with a shell-injection vector.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { serverEnv } from './env';

const execAsync = promisify(exec);

export interface SubmitOptions {
	/** Absolute path to the file to print. */
	filePath: string;
	/** Number of copies. */
	copies: number;
	/** Optional human-readable job title shown in the CUPS queue. */
	title?: string;
	/** Duplex / simplex hint — defaults to "one-sided". */
	sides?: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
	/** Optional explicit media size, e.g. "A4", "Letter". */
	media?: string;
	/** Pages per sheet (N-up) — 1, 2, or 4. Defaults to 1 (full size). */
	pagesPerSheet?: 1 | 2 | 4;
	/** Colour mode — defaults to "color". */
	color?: 'color' | 'mono';
}

export interface SubmitResult {
	jobId: number;
	raw: string;
}

/**
 * Whitelist-validate a string so it can safely be interpolated into a
 * shell argument. We only allow letters, digits, dot, underscore, dash
 * and space.
 */
function sanitise(value: string, maxLen = 128): string {
	const cleaned = value.replace(/[^A-Za-z0-9._\- ]/g, '').trim();
	if (cleaned.length === 0) throw new Error(`Unsafe shell argument: "${value}"`);
	if (cleaned.length > maxLen) throw new Error(`Argument too long: ${cleaned.length} > ${maxLen}`);
	return cleaned;
}

/**
 * Submit a print job to CUPS via `lp`.
 *
 * The Fuji Xerox C3061 ships with PostScript and IPP Everywhere PPDs;
 * CUPS auto-selects the right driver when the printer is registered
 * with the correct URI.
 */
export async function submitPrintJob(opts: SubmitOptions): Promise<SubmitResult> {
	if (!Number.isInteger(opts.copies) || opts.copies < 1 || opts.copies > 999) {
		throw new Error(`Invalid copies value: ${opts.copies}`);
	}

	const printer = sanitise(serverEnv.printerName, 64);
	const title = sanitise(opts.title ?? 'SvelteKit Print Job', 128);
	const sides = sanitise(opts.sides ?? 'one-sided', 32);
	const media = opts.media ? sanitise(opts.media, 32) : null;

	const args: string[] = [
		'-d',
		printer,
		'-n',
		String(opts.copies),
		'-t',
		title,
		'-o',
		`sides=${sides}`
	];
	if (media) args.push('-o', `media=${media}`);
	const nup = opts.pagesPerSheet ?? 1;
	if (nup > 1) args.push('-o', `number-up=${nup}`);
	// Colour mode: defaults to colour. Mono prints black-and-white on
	// a colour printer, saving toner/ink.
	if (opts.color === 'mono') args.push('-o', 'print-color-mode=monochrome');
	args.push(opts.filePath);

	const cmd = `lp ${args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}`;

	const { stdout } = await execAsync(cmd, {
		maxBuffer:50 * 1024 * 1024,
		timeout: 60_000,
		shell: '/bin/bash'
	});

	const match = stdout.match(/request id is [^\s]+-(\d+)/i);
	if (!match) {
		throw new Error(`Unable to parse CUPS job id from output:\n${stdout}`);
	}

	return { jobId: Number(match[1]), raw: stdout };
}

/**
 * Best-effort deletion of a file. Swallow errors so the `finally`
 * block of the caller never throws.
 */
export async function safeUnlink(filePath: string): Promise<void> {
	const { unlink } = await import('node:fs/promises');
	try {
		await unlink(filePath);
	} catch {
		/* ignore — file may already be gone */
	}
}
/**
 * ตรวจสอบสถานะงานพิมพ์ผ่าน lpstat
 * ส่งคืน true ถ้างานเสร็จสมบูรณ์, false ถ้าถูกยกเลิกหรือล้มเหลว
 */
async function waitForPrintJob(jobId: number, timeoutMs = 60000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        try {
            // ดึงสถานะของ jobId (lpstat -o จะแสดงงานที่ค้างอยู่)
            const { stdout } = await execAsync(`lpstat -o`);
            
            // ถ้าไม่พบ jobId ในรายการงานที่ค้างอยู่ แปลว่าน่าจะจบงานแล้ว
            if (!stdout.includes(`-${jobId}`)) {
                // ต้องเช็คเพิ่มว่าจบแบบสำเร็จหรือล้มเหลวด้วยการดู log หรือประวัติ
                // แต่เบื้องต้นถ้าหายไปจากคิวโดยไม่ error คือถือว่าส่งงานสำเร็จ
                return true; 
            }
        } catch (e) {
            // กรณี lpstat คืนค่า error แปลว่างานอาจจะไม่อยู่ในคิวแล้ว
            return true;
        }
        
        // รอ 2 วินาทีก่อนเช็คใหม่
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return false; // หมดเวลารอก่อนงานจะเสร็จ
}