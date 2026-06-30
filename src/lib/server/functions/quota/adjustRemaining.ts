import type { AppPocketBase } from '../../pocketbase';
import { calculateSnapshot } from './calculateSnapshot';
import { getDefaultPackage } from './getDefaultPackage';
import type { QuotaRow, QuotaSnapshot } from './types';
import { getQuota } from './getQuota';

export async function adjustRemaining(pb: AppPocketBase, userId: string, delta: number): Promise<QuotaSnapshot> {
	if (!Number.isFinite(delta) || delta === 0) return getQuota(pb, userId);

	try {
		const row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, { expand: 'Total_Quota' });

		// อัปเดตตัวเลขเข้าฟิลด์ Add_Quota
		const updatedRow = await pb.collection('Quota').update<QuotaRow>(row.id, {
			Add_Quota: row.Add_Quota + delta
		}, { expand: 'Total_Quota' });

		return calculateSnapshot(updatedRow);
	} catch {
		// ถ้าไม่เคยมีฐานข้อมูลโควต้า สร้างใหม่เลย
		const defaultPkg = await getDefaultPackage(pb);
		const newRow = await pb.collection('Quota').create<QuotaRow>({
			// ⚡ ใส่ก้ามปูครอบให้กลายเป็น Array
			user: [userId],
			Total_Quota: [defaultPkg.id],
			Add_Quota: delta > 0 ? delta : 0,
			Use: 0
		}, { expand: 'Total_Quota' });

		return calculateSnapshot(newRow);
	}
}
