/**
 * Server-side session helpers.
 *
 * SvelteKit cookies are the single source of truth for "who am I" —
 * PocketBase's auth token is opaque and we treat it like any other
 * bearer secret.
 *
 * Quota fields live in their own collections (`Quota`, `Total_Quota`),
 * NOT on the `users` record — so this type only carries auth identity.
 */
import type { Cookies } from '@sveltejs/kit';
import { createPocketBaseClient, type UsersRecord } from './pocketbase';

export const AUTH_COOKIE = 'pb_auth';

export interface SessionUser {
	id: string;
	email: string;
	name?: string;
	username?: string;
	role: UsersRecord['role'];
	/** PB auth token — used by route actions to rebuild a private
	 * PB client without re-validating the cookie. */
	token: string;
}

/**
 * Read the auth cookie, replay it against PocketBase to confirm it
 * is still valid, and return a fully typed user. Returns `null` if
 * the cookie is missing, malformed, or the token has been revoked.
 */
export async function getSessionUser(cookies: Cookies): Promise<SessionUser | null> {
	const raw = cookies.get(AUTH_COOKIE);
	if (!raw) return null;

	let parsed: { token?: string };
	try {
		parsed = JSON.parse(raw);
	} catch {
		cookies.delete(AUTH_COOKIE, { path: '/' });
		return null;
	}
	if (!parsed.token) return null;

	const pb = createPocketBaseClient();
	pb.authStore.save(raw);

	try {
		if (!pb.authStore.isValid) return null;
		const refreshed = await pb.collection('users').authRefresh<UsersRecord>();
		const u = refreshed.record;
		return {
			id: u.id,
			email: u.email,
			name: u.name,
			username: u.username,
			role: u.role,
			token: pb.authStore.token
		};
	} catch {
		cookies.delete(AUTH_COOKIE, { path: '/' });
		return null;
	}
}

export function clearSession(cookies: Cookies): void {
	cookies.delete(AUTH_COOKIE, { path: '/' });
}