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
