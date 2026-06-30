import type { AppPocketBase } from '../../pocketbase';
import { calculateSnapshot } from './calculateSnapshot';
import type { QuotaRow, UserQuotaRow } from './types';

export async function listAllQuotas(pb: AppPocketBase): Promise<Map<string, UserQuotaRow>> {
	const rows = await pb.collection('Quota').getFullList<QuotaRow>({
		expand: 'Total_Quota' // ⚡ ดึงข้อมูลตารางแม่มาพร้อมกันทุกคนใน Request เดียว
	});

	const out = new Map<string, UserQuotaRow>();
	for (const r of rows) {
		if (!r.user) continue;
		const snap = calculateSnapshot(r);
		out.set(r.user, { userId: r.user, ...snap });
	}
	return out;
}
