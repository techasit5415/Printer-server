import type { QuotaRow, QuotaSnapshot } from './types';

export function calculateSnapshot(row: QuotaRow): QuotaSnapshot & { tierTotal: number } {
	const tierTotal = row.expand?.Total_Quota?.Total_Quota || 0; // ดึงจากตารางแม่
	const personalBonus = row.Add_Quota || 0;                    // ดึงโบนัสส่วนตัว
	const absoluteTotal = tierTotal + personalBonus;             // รวมโควต้าทั้งหมด
	const used = row.Use || 0;

	return {
		remaining: Math.max(0, absoluteTotal - used),
		total: absoluteTotal,
		used: Math.max(0, used),
		tierTotal
	};
}
