import { redirect } from '@sveltejs/kit';
import { clearSession } from '$lib/server/functions/session/clearSession';
import type { RequestHandler } from './$types';

/**
 * Global logout endpoint — clears the `pb_auth` cookie and bounces to
 * the login page. Lives outside of any role-specific route so the
 * navbar can POST to `/logout` from both `/admin` and the user
 * dashboard without needing a per-page form action.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	clearSession(cookies);
	throw redirect(303, '/login');
};