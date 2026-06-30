import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function getPageCountOfFile(filePath: string, ext: string): Promise<number> {
	const cleanExt = ext.toLowerCase();
	if (cleanExt === '.pdf') {
		// 1. ลองใช้ pdfinfo ก่อน
		try {
			const { stdout } = await execAsync(`pdfinfo '${filePath.replace(/'/g, `'\\''`)}'`);
			const match = stdout.match(/Pages:\s+(\d+)/i);
			if (match) {
				const pages = parseInt(match[1], 10);
				if (pages > 0) return pages;
			}
		} catch (err) {
			console.warn('[PageCount] pdfinfo failed, trying fallback regex:', err);
		}

		// 2. ลองใช้ Regex ตรวจสอบหา /Count ในกรณี pdfinfo ไม่มี/ล้มเหลว
		try {
			const { readFile } = await import('node:fs/promises');
			const content = await readFile(filePath, 'binary');
			const matches = [...content.matchAll(/\/Count\s+(\d+)/g)];
			if (matches.length > 0) {
				const counts = matches.map(m => parseInt(m[1], 10)).filter(c => c > 0);
				if (counts.length > 0) {
					return Math.max(...counts);
				}
			}
		} catch (err) {
			console.error('[PageCount] Fallback regex failed:', err);
		}
	} else if (cleanExt === '.ps') {
		try {
			const { readFile } = await import('node:fs/promises');
			const content = await readFile(filePath, 'utf-8');
			const match = content.match(/^%%Pages:\s+(\d+)/m);
			if (match) {
				return parseInt(match[1], 10);
			}
		} catch {
			/* fallback to 1 */
		}
	}

	// รูปภาพและไฟล์ข้อความทั่วไปมี 1 หน้า
	return 1;
}
