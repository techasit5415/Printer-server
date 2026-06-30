import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function getPrintedPages(cupsJobId: number): Promise<{ printed: number; isLogEnabled: boolean }> {
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
		return { printed: 0, isLogEnabled: false };
	}
}
