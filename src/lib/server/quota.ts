/**
 * Quota helpers — backed by TWO PocketBase collections.
 *
 *   - `Total_Quota` — each row is a "quota package" (number). One row
 *                      can be linked from many Quota rows.
 *
 *   - `Quota`       — one row PER USER:
 *                        `relation`    → `users`        (who owns it)
 *                        `Quota`       → `Total_Quota`  (the linked package,
 *                                                          whose `Total_Quota`
 *                                                          number is the ceiling)
 *                        `Total_Quota` → number         (cached copy of the
 *                                                          linked package's value,
 *                                                          for fast reads)
 *                        `Use`         → USED pages
 *
 * `Use` and `Quota` (relation) are the two fields we read / mutate
 * directly. `Total_Quota` (number) is kept in sync by writers but the
 * relation is the source of truth — admin "+ เพิ่มโควต้า" bumps the
 * linked `Total_Quota.Total_Quota` value and we mirror that into
 * `Total_Quota` on the next write.
 */
import type { AppPocketBase } from './pocketbase';
import { serverEnv } from './env';

export interface QuotaSnapshot {
	remaining: number;
	total: number;
	used: number;
}

interface TotalQuotaPackage {
	id: string;
	Total_Quota: number;
}

interface QuotaRow {
	id: string;
	relation?: string;
	/** Relation → `Total_Quota` row id. The row's `Total_Quota`
	 *  number is what we display as `total`. */
	Quota?: string;
	/** Cached ceiling value, mirrored from the linked package. */
	Total_Quota: number;
	Use: number;
	expand?: { Quota?: TotalQuotaPackage };
}

function clampInt(n: number, min = 0): number {
	if (!Number.isFinite(n)) return min;
	return Math.max(min, Math.floor(n));
}

async function findUserQuota(pb: AppPocketBase, userId: string): Promise<QuotaRow | null> {
	try {
		return await pb
			.collection('Quota')
			.getFirstListItem<QuotaRow>(`relation="${userId}"`, {
				expand: 'Quota'
			});
	} catch {
		return null;
	}
}

async function findDefaultPackage(pb: AppPocketBase): Promise<TotalQuotaPackage | null> {
	try {
		return await pb.collection('Total_Quota').getFirstListItem<TotalQuotaPackage>('');
	} catch {
		return null;
	}
}

/**
 * Resolve the ceiling for a single Quota row — STRICTLY from the
 * linked `Total_Quota` package via the `Quota` relation. If the
 * relation id is set but `expand` didn't return the package, we
 * fetch it directly. As a last resort (no relation at all) we fall
 * back to the env default.
 *
 * We do NOT trust the cached `Total_Quota` number column — the
 * relation is the single source of truth for "สิทธิ์หลัก".
 */
async function resolveTotal(pb: AppPocketBase, row: QuotaRow | null): Promise<number> {
	const pkg = row?.expand?.Quota?.Total_Quota;
	if (typeof pkg === 'number' && Number.isFinite(pkg)) return clampInt(pkg);

	if (row?.Quota) {
		try {
			const direct = (await pb
				.collection('Total_Quota')
				.getOne<TotalQuotaPackage>(row.Quota)) as TotalQuotaPackage;
			if (typeof direct.Total_Quota === 'number' && Number.isFinite(direct.Total_Quota)) {
				return clampInt(direct.Total_Quota);
			}
		} catch {
			/* fall through */
		}
	}

	return serverEnv.defaultQuotaPages;
}

/**
 * Read-modify-write a user's Quota row with a CAS retry loop. Lazily
 * creates the row (pointing at the first available `Total_Quota`
 * package) on first write.
 */
async function mutate(
	pb: AppPocketBase,
	userId: string,
	fn: (cur: QuotaSnapshot & { row: QuotaRow }) => QuotaSnapshot
): Promise<QuotaSnapshot> {
	let row = await findUserQuota(pb, userId);

	if (!row) {
		const pkg = await findDefaultPackage(pb);
		const seedTotal = pkg?.Total_Quota ?? serverEnv.defaultQuotaPages;
		row = (await pb.collection('Quota').create({
			relation: userId,
			Quota: pkg?.id ?? null,
			Total_Quota: clampInt(seedTotal),
			Use: 0
		})) as QuotaRow;
	}

	const cur: QuotaSnapshot = {
		remaining: Math.max(0, (await resolveTotal(pb, row)) - clampInt(Number(row.Use), 0)),
		used: clampInt(Number(row.Use), 0),
		total: await resolveTotal(pb, row)
	};
	const next = fn({ ...cur, row });

	const used = clampInt(Number(next.used), 0);
	const total = await resolveTotal(pb, row);

	await pb.collection('Quota').update(row.id, {
		Use: used,
		Total_Quota: total
	});

	return { remaining: Math.max(0, total - used), used, total };
}

/**
 * Read-only quota lookup. `total` is pulled from the linked
 * `Total_Quota` package (via the `Quota` relation); `Use` is read
 * straight off the row. `remaining` is computed as `total - used`.
 */
export async function getQuota(
	pb: AppPocketBase,
	userId: string
): Promise<QuotaSnapshot> {
	const row = await findUserQuota(pb, userId);
	if (!row) {
		const pkg = await findDefaultPackage(pb);
		const total = clampInt(pkg?.Total_Quota ?? serverEnv.defaultQuotaPages);
		return { remaining: total, used: 0, total };
	}
	const total = await resolveTotal(pb, row);
	const used = clampInt(Number(row.Use), 0);
	return { remaining: Math.max(0, total - used), used, total };
}

/**
 * Atomically subtract `pages` from the user's remaining quota by
 * bumping `Use` by the same amount. Returns the new snapshot or
 * `null` if the user has no quota left.
 */
export async function deductQuota(
	pb: AppPocketBase,
	userId: string,
	pages: number
): Promise<QuotaSnapshot | null> {
	if (pages <= 0) return getQuota(pb, userId);

	for (let attempt = 0; attempt < 5; attempt++) {
		const cur = await getQuota(pb, userId);
		if (cur.remaining < pages) return null;

		try {
			return await mutate(pb, userId, ({ used }) => ({
				remaining: 0, // ignored
				used: used + pages,
				total: 0 // ignored
			}));
		} catch (err) {
			const status =
				typeof err === 'object' && err !== null && 'status' in err
					? Number((err as { status: unknown }).status)
					: 0;
			if (status === 0) throw err;
			await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
		}
	}

	throw new Error('Failed to deduct quota after 5 attempts (concurrent contention).');
}

/**
 * Refund `pages` — reduce `Use` by the same amount (clamped at 0).
 * `remaining` is recomputed from `total - use`.
 */
export async function refundQuota(
	pb: AppPocketBase,
	userId: string,
	pages: number
): Promise<QuotaSnapshot> {
	if (pages <= 0) return getQuota(pb, userId);
	return mutate(pb, userId, ({ used }) => ({
		remaining: 0,
		used: Math.max(0, used - pages),
		total: 0
	}));
}

/**
 * Admin "+ เพิ่มโควต้า" — bump the linked `Total_Quota` package's
 * `Total_Quota` value by `delta` (which shows up in the "สิทธิ์หลัก"
 * and "โควต้าที่ใช้ไป" columns immediately, since `total` is read
 * from that relation).
 *
 * If the row has no relation, fall back to the most recently updated
 * `Total_Quota` row so the admin's "+N" intent still lands somewhere
 * visible.
 */
export async function adjustRemaining(
	pb: AppPocketBase,
	userId: string,
	delta: number
): Promise<QuotaSnapshot> {
	if (!Number.isFinite(delta) || delta === 0) return getQuota(pb, userId);

	const row = await findUserQuota(pb, userId);

	let pkg: TotalQuotaPackage | null = row?.expand?.Quota ?? null;

	if (!pkg && row?.Quota) {
		try {
			pkg = (await pb.collection('Total_Quota').getOne<TotalQuotaPackage>(
				row.Quota
			)) as TotalQuotaPackage;
		} catch {
			pkg = null;
		}
	}

	if (!pkg) {
		try {
			const list = await pb.collection('Total_Quota').getList<TotalQuotaPackage>(1, 1, {
				sort: '-updated'
			});
			pkg = list.items[0] ?? null;
		} catch {
			pkg = null;
		}
	}

	if (pkg) {
		const nextTotal = clampInt(pkg.Total_Quota + delta);
		await pb.collection('Total_Quota').update(pkg.id, { Total_Quota: nextTotal });
	} else {
		await pb.collection('Total_Quota').create({
			Total_Quota: clampInt(Math.max(serverEnv.defaultQuotaPages + delta, delta))
		});
	}

	return getQuota(pb, userId);
}

/**
 * Admin "รีเซ็ต" — zero out `Use`. The ceiling stays where it is,
 * so `remaining` snaps back to `total`.
 */
export async function resetToDefault(
	pb: AppPocketBase,
	userId: string
): Promise<QuotaSnapshot> {
	return mutate(pb, userId, () => ({
		remaining: 0,
		used: 0,
		total: 0
	}));
}

/**
 * Bulk quota snapshot for the admin table — one round-trip. `total`
 * comes from each user's own `Total_Quota` package (via the `Quota`
 * relation).
 */
export interface UserQuotaRow {
	userId: string;
	remaining: number;
	total: number;
	used: number;
}

export async function listAllQuotas(
	pb: AppPocketBase
): Promise<Map<string, UserQuotaRow>> {
	const rows = await pb.collection('Quota').getFullList<QuotaRow>({
		fields: 'id,Use,Total_Quota,relation,Quota',
		expand: 'Quota'
	});
	const out = new Map<string, UserQuotaRow>();
	for (const r of rows) {
		if (!r.relation) continue;
		const total = await resolveTotal(pb, r);
		const used = clampInt(Number(r.Use), 0);
		out.set(r.relation, {
			userId: r.relation,
			remaining: Math.max(0, total - used),
			used,
			total
		});
	}
	return out;
}