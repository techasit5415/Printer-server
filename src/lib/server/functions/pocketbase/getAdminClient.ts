import PocketBase from 'pocketbase';
import { serverEnv } from '../../env';
import { env } from '$env/dynamic/private';

let pbAdminInstance: PocketBase | null = null;

export async function getAdminClient(): Promise<PocketBase> {
	if (pbAdminInstance && pbAdminInstance.authStore.isValid) return pbAdminInstance;

	pbAdminInstance = new PocketBase(serverEnv.pocketbaseUrl);
	pbAdminInstance.autoCancellation(false);

	if (env.PB_ADMIN_EMAIL && env.PB_ADMIN_PASSWORD) {
		try {
			await pbAdminInstance.admins.authWithPassword(env.PB_ADMIN_EMAIL, env.PB_ADMIN_PASSWORD);
		} catch (authErr) {
			console.error('[PocketBase] Failed to authenticate as PB Admin:', authErr);
		}
	} else {
		console.warn('[PocketBase] PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD is not set. Admin operations might fail.');
	}

	return pbAdminInstance;
}
