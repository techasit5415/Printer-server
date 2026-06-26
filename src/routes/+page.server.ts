import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Root entry point — bounce visitors straight to the unified login
 * page. Authenticated users skip the form and go to their dashboard.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	throw redirect(303, locals.user.role === 'admin' ? '/admin' : '/page-user-dashboard');
};