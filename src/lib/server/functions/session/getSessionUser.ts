import type { Cookies } from '@sveltejs/kit';
import { createPocketBaseClient, type UsersRecord } from '../../pocketbase';
import { AUTH_COOKIE, type SessionUser } from '../../session';

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
