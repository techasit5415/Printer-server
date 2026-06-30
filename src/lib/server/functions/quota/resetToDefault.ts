import type { AppPocketBase } from '../../pocketbase';
import { calculateSnapshot } from './calculateSnapshot';
import { getDefaultPackage } from './getDefaultPackage';
import type { QuotaRow, QuotaSnapshot } from './types';

export async function resetToDefault(pb: AppPocketBase, userId: string): Promise<QuotaSnapshot> {
	try {
		const row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, { expand: 'Total_Quota' });

		// ล้างยอด Use เป็น 0 และล้างโบนัส Add_Quota ส่วนตัวเป็น 0
		const updatedRow = await pb.collection('Quota').update<QuotaRow>(row.id, {
			Add_Quota: 0,
			Use: 0
		}, { expand: 'Total_Quota' });

		return calculateSnapshot(updatedRow);
	} catch {
		const defaultPkg = await getDefaultPackage(pb);
		const newRow = await pb.collection('Quota').create<QuotaRow>({
			// ⚡ ใส่ก้ามปูครอบเหมือนกัน
			user: [userId],
			Total_Quota: [defaultPkg.id],
			Add_Quota: 0,
			Use: 0
		}, { expand: 'Total_Quota' });

		return calculateSnapshot(newRow);
	}
}
