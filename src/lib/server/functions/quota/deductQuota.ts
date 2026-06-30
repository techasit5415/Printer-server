import { getAdminClient } from '../pocketbase/getAdminClient';
import type { AppPocketBase } from '../../pocketbase';
import { calculateSnapshot } from './calculateSnapshot';
import { getDefaultPackage } from './getDefaultPackage';
import type { QuotaRow, QuotaSnapshot } from './types';
import { getQuota } from './getQuota';

export async function deductQuota(pb: AppPocketBase, userId: string, pages: number): Promise<QuotaSnapshot | null> {
	if (pages <= 0) return getQuota(pb, userId);

	try {
		let row: QuotaRow;
		try {
			row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, {
				expand: 'Total_Quota'
			});
		} catch {
			// หากไม่มีข้อมูลโควต้าในฐานข้อมูล ให้สร้างขึ้นมาใหม่
			const adminPb = await getAdminClient();
			const defaultPkg = await getDefaultPackage(pb);
			row = await adminPb.collection('Quota').create<QuotaRow>({
				user: [userId],
				Total_Quota: [defaultPkg.id],
				Add_Quota: 0,
				Use: 0
			}, { expand: 'Total_Quota' });
		}

		const snap = calculateSnapshot(row);
		if (snap.remaining < pages) return null; // โควต้าไม่พอ

		// อัปเดตยอดใช้ไป
		const adminPb = await getAdminClient();
		const updatedRow = await adminPb.collection('Quota').update<QuotaRow>(row.id, {
			Use: row.Use + pages
		}, { expand: 'Total_Quota' });

		return calculateSnapshot(updatedRow);
	} catch (err) {
		console.error('[Quota] deductQuota failed:', err);
		return null;
	}
}
