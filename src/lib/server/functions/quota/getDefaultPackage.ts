import { getAdminClient } from '../pocketbase/getAdminClient';
import type { AppPocketBase } from '../../pocketbase';
import { serverEnv } from '../../env';
import type { TotalQuotaPackage } from './types';

export async function getDefaultPackage(pb: AppPocketBase): Promise<TotalQuotaPackage> {
	const adminPb = await getAdminClient();
	try {
		return await adminPb.collection('Total_Quota').getFirstListItem<TotalQuotaPackage>('');
	} catch {
		return (await adminPb.collection('Total_Quota').create({
			Total_Quota: serverEnv.defaultQuotaPages || 500
		})) as TotalQuotaPackage;
	}
}
