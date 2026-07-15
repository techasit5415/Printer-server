import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Root entry point — bounce visitors straight to the unified login
 * page. Authenticated users skip the form and go to their dashboard.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (locals.user.role === 'superadmin') {
		throw redirect(303, '/admin');
	} else if (locals.user.role === 'teachers' || locals.user.role === 'admin') {
		throw redirect(303, '/user');
	} else {
		throw error(403, 'นักศึกษาไม่ได้รับอนุญาตให้ใช้งานระบบนี้');
	}
};