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
		user_type?: { id: string; type?: string; name?: string };
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