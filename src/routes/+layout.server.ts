import type { LayoutServerLoad } from './$types';

/**
 * Forward the resolved session user to every page via `page.data.user`
 * so shared chrome (navbar, etc.) can render without each page doing
 * its own session lookup.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user
	};
};