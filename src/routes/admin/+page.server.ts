import { error, redirect, type Actions } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	createPocketBaseClient,
	type PrintJobsRecord,
	type UsersRecord
} from '$lib/server/pocketbase';
import {
	adjustRemaining,
	listAllQuotas,
	resetToDefault
} from '$lib/server/quota';
import { clearSession } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/**
 * Build a PocketBase client authenticated as the `_superusers` admin.
 *
 * The `users` collection's update/list rules (see `users.updateRule`
 * in PB) only allow self-edit OR a `_superusers` caller — a regular
 * user tagged with `role="admin"` is NOT a superuser and therefore
 * cannot list, view, or mutate other user records. Same story for
 * `print_jobs` (updateRule/deleteRule are both `""`). So all admin
 * console operations go through this elevated client.
 */
async function createSuperuserClient() {
	if (!env.PB_ADMIN_EMAIL || !env.PB_ADMIN_PASSWORD) {
		throw new Error(
			'PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set in .env — required to bypass collection rules.'
		);
	}
	const pb = createPocketBaseClient();
	pb.autoCancellation(false);
	await pb.admins.authWithPassword(env.PB_ADMIN_EMAIL, env.PB_ADMIN_PASSWORD);
	return pb;
}

/**
 * Decorate each job with its 1-based position in the live queue (only
 * `processing` + `pending` jobs occupy a slot — completed/failed are
 * dropped). The page UI uses the position for the "ต่อคิว (ลำดับ N)"
 * badge and to derive a rough ETA for the user dashboard.
 */
function decorateQueuePositions(
	jobs: PrintJobsRecord[]
): Array<PrintJobsRecord & { queuePosition: number | null }> {
	const active = jobs
		.filter((j) => j.status === 'processing' || j.status === 'pending')
		.sort((a, b) => a.created.localeCompare(b.created));

	const positionById = new Map<string, number>();
	active.forEach((job, idx) => positionById.set(job.id, idx + 1));

	return jobs.map((j) => ({
		...j,
		queuePosition: positionById.get(j.id) ?? null
	}));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (locals.user.role !== 'admin') throw redirect(303, '/page-user-dashboard');

	const pb = await createSuperuserClient();

	const [users, jobsResult, quotasByUser] = await Promise.all([
		pb.collection('users').getFullList<UsersRecord>({
			sort: 'name',
			// Expand `user_type` so the admin table's "แผนก / ฝ่าย"
			// column can show the department name (and the search box
			// can match against it) without N+1 fetches.
			expand: 'user_type'
		}),
		pb.collection('print_jobs').getList<PrintJobsRecord>(1, 100, {
			sort: '-created',
			expand: 'user'
		}),
		listAllQuotas(pb)
	]);

	// Attach quota snapshot to each user row so the table can render
	// without N+1 reads. Users without a Quota row yet get the default
	// snapshot synthesised inside `listAllQuotas`.
	const usersWithQuota = users.map((u) => {
		const q = quotasByUser.get(u.id);
		return {
			...u,
			quota: q ?? { userId: u.id, remaining: 0, total: 0, used: 0, tierTotal: 0 }
		};
	});

	return {
		users: usersWithQuota,
		jobs: decorateQueuePositions(jobsResult.items)
	};
};

/**
 * Admin-only actions — queue control and quota management. All go
 * through the superuser client so PB's collection rules don't reject
 * the writes.
 */
export const actions: Actions = {
	adjustQuota: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const delta = Number(data.get('delta') ?? 0);

		if (!userId || !Number.isFinite(delta) || delta === 0) {
			return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };
		}

		const pb = await createSuperuserClient();

		try {
			const snapshot = await adjustRemaining(pb, userId, delta);
			const user = await pb.collection('users').getOne<UsersRecord>(userId);
			return {
				ok: true,
				message: `เพิ่มโควต้าให้ ${user.name ?? user.email} แล้ว (เหลือ ${snapshot.remaining}/${snapshot.total} หน้า)`
			};
		} catch (e) {
			console.error('[admin/adjustQuota] failed:', e);
			return { ok: false, message: 'ไม่สามารถอัปเดตโควต้าได้' };
		}
	},

	resetQuota: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		if (!userId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

		const pb = await createSuperuserClient();

		try {
			const snapshot = await resetToDefault(pb, userId);
			const user = await pb.collection('users').getOne<UsersRecord>(userId);
			return {
				ok: true,
				message: `รีเซ็ตโควต้าให้ ${user.name ?? user.email} เป็น ${snapshot.total} หน้าแล้ว`
			};
		} catch (e) {
			console.error('[admin/resetQuota] failed:', e);
			return { ok: false, message: 'ไม่สามารถรีเซ็ตโควต้าได้' };
		}
	},

	suspend: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

		const data = await request.formData();
		const jobId = String(data.get('jobId') ?? '');
		if (!jobId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

		const pb = await createSuperuserClient();

		try {
			await pb.collection('print_jobs').update(jobId, {
				status: 'failed',
				error_message: 'Suspended by admin'
			});
			return { ok: true, message: 'ระงับงานเรียบร้อย' };
		} catch (e) {
			console.error('[admin/suspend] failed:', e);
			return { ok: false, message: 'ไม่สามารถระงับงานได้' };
		}
	},

	remove: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

		const data = await request.formData();
		const jobId = String(data.get('jobId') ?? '');
		if (!jobId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

		const pb = await createSuperuserClient();

		try {
			await pb.collection('print_jobs').delete(jobId);
			return { ok: true, message: 'ลบงานออกจากคิวเรียบร้อย' };
		} catch (e) {
			console.error('[admin/remove] failed:', e);
			return { ok: false, message: 'ไม่สามารถลบงานได้' };
		}
	},

	logout: async ({ cookies }) => {
		clearSession(cookies);
		throw redirect(303, '/login');
	}
};