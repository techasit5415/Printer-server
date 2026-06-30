/**
 * PocketBase client factory.
 *
 * Each call returns a *fresh* `PocketBase` instance — the SDK keeps an
 * in-memory auth store per instance, and we never want to leak a user's
 * token across requests.
 */
import PocketBase from 'pocketbase';
import { serverEnv } from './env';

// ─── PocketBase schema typing ────────────────────────────────────────────────
// Mirror your actual collections here. The SDK does not export a generic
// `TypedPocketBase`, so we keep the interfaces and pass them where needed
// for `getOne<T>` / `getList<T>` autocompletion.
export interface UsersRecord {
	id: string;
	email: string;
	username?: string;
	name?: string;
	avatar?: string;
	user_type?: string | null;
	role?: 'admin' | 'user';
	verified?: boolean;
	created?: string;
	updated?: string;
	// Quota fields live in dedicated `Quota` / `Total_Quota` collections,
	// NOT on the user record — see `$lib/server/quota.ts`.
	expand?: {
		user_type?: { id: string; type?: string };
	};
}

export interface PrintJobsRecord {
	id: string;
	user: string; // relation id → users
	filename: string;
	status: 'pending' | 'processing' | 'completed' | 'failed';
	pages: number;
	copies: number;
	printer_name: string;
	cups_job_id: number | null;
	error_message: string | null;
	created: string;
	updated: string;
	expand?: { user?: UsersRecord };
}

export type AppPocketBase = PocketBase;

export function createPocketBaseClient(): AppPocketBase {
	return new PocketBase(serverEnv.pocketbaseUrl);
}

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