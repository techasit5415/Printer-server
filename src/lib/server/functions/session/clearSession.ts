import type { Cookies } from '@sveltejs/kit';
import { AUTH_COOKIE } from '../../session';

export function clearSession(cookies: Cookies): void {
	cookies.delete(AUTH_COOKIE, { path: '/' });
}
