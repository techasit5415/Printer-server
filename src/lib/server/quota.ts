/**
 * Quota helpers — backed by the `Quota` PocketBase collection.
 *
 *   - `Total_Quota` (package collection) — LEGACY. Kept around for
 *                       rollback safety but no longer the source of
 *                       truth. Old `Quota` rows may still point at
 *                       a package via the `Quota` relation; we read
 *                       those as a migration fallback only.
 *
 *   - `Quota`        — one row PER USER:
 *                        `relation`    → `users`        (who owns it)
 *                        `Quota`       → `Total_Quota`  (LEGACY relation,
 *                                                          only consulted
 *                                                          as a fallback
 *                                                          when the per-user
 *                                                          number is missing)
 *                        `Total_Quota` → number         (per-user ceiling —
 *                                                          THIS is the source
 *                                                          of truth, "ของใคร
 *                                                          ของมัน")
 *                        `Use`         → USED pages
 *
 * `Use` and the per-user `Total_Quota` (number) are the two fields we
 * read / mutate directly. The linked package, if any, is metadata.
 * Admin "+ เพิ่มโควต้า" bumps the user's own row's `Total_Quota`
 * number — never the package.
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
	/** LEGACY relation → a `Total_Quota` package row. Kept on disk
	 *  for backwards compat; `resolveTotal` only consults it as a
	 *  fallback when the per-user number is missing. */
	Quota?: string;
	/** Per-user ceiling — source of truth ("ของใครของมัน").
	 *  Optional in the PocketBase schema; `resolveTotal` handles the
	 *  `undefined` case via the legacy package / env default. */
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

/**
 * Resolve the ceiling for a single Quota row. The per-user
 * `Total_Quota` NUMBER on the row itself is the source of truth —
 * "ของใครของมัน". If the field is missing/unset on the row (legacy
 * data), we fall back to the linked `Total_Quota` package via the
 * `Quota` relation as a one-time migration aid. As a last resort
 * (no row, no relation) we return the env default.
 *
 * Note: an explicit `0` on the row IS respected (admin can lock a
 * user out) — we only fall back when the value is missing or
 * non-finite.
 */
async function resolveTotal(pb: AppPocketBase, row: QuotaRow | null): Promise<number> {
	const own = row?.Total_Quota;
	if (typeof own === 'number' && Number.isFinite(own)) return clampInt(own);

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
 * Resolve the master tier value for a Quota row — STRICTLY from the
 * linked `Total_Quota` package via the `Quota` relation. This is the
 * value the admin table shows in the "สิทธิ์หลัก" column and what
 * "reset" re-syncs the per-user ceiling back to. Used to be
 * conflated with `resolveTotal`; split out so the per-user ceiling
 * and the master tier can drift independently when admin grants
 * bonus pages via "+ เพิ่มโควต้า".
 *
 * If the relation is missing (legacy row, package deleted), fall
 * back to the env default rather than the per-user number — the
 * tier label must not silently track admin bonus grants.
 */
async function resolveTierTotal(pb: AppPocketBase, row: QuotaRow | null): Promise<number> {
	const pkg = row?.expand?.Quota;
	if (typeof pkg?.Total_Quota === 'number' && Number.isFinite(pkg.Total_Quota)) {
		return clampInt(pkg.Total_Quota);
	}

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
 * creates the row — seeded with the env default ceiling — on first
 * write. The row's own `Total_Quota` number is the per-user ceiling.
 */
async function mutate(
	pb: AppPocketBase,
	userId: string,
	fn: (cur: QuotaSnapshot & { row: QuotaRow }) => QuotaSnapshot
): Promise<QuotaSnapshot> {
	let row = await findUserQuota(pb, userId);

	if (!row) {
		row = (await pb.collection('Quota').create({
			relation: userId,
			Total_Quota: serverEnv.defaultQuotaPages,
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
 * Read-only quota lookup. `total` is pulled from the per-user
 * `Total_Quota` number on the row itself (via `resolveTotal`, which
 * may fall back to the legacy package relation); `Use` is read
 * straight off the row. `remaining` is computed as `total - used`.
 */
export async function getQuota(
	pb: AppPocketBase,
	userId: string
): Promise<QuotaSnapshot> {
	const row = await findUserQuota(pb, userId);
	if (!row) {
		const total = serverEnv.defaultQuotaPages;
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
 * Admin "+ เพิ่มโควต้า" — bump the user's OWN `Quota` row's
 * `Total_Quota` number by `delta`. "ของใครของมัน" — never touches
 * a shared package row, so a +N for User A cannot leak into User B.
 *
 * If the user has no `Quota` row yet, we create one seeded with
 * `max(default, default + delta)` so the admin's "+N" intent is
 * honoured (a "+10" on a brand-new user shouldn't be capped at the
 * env default).
 *
 * If the existing row has no per-user `Total_Quota` set (legacy
 * data), we read the current ceiling via `resolveTotal` (which may
 * fall back to the package / env default) and write the new value
 * back onto the per-user field — promoting it to the source of
 * truth on the first bump.
 */
export async function adjustRemaining(
	pb: AppPocketBase,
	userId: string,
	delta: number
): Promise<QuotaSnapshot> {
	if (!Number.isFinite(delta) || delta === 0) return getQuota(pb, userId);

	const existing = await findUserQuota(pb, userId);

	if (existing) {
		const currentTotal = await resolveTotal(pb, existing);
		const nextTotal = clampInt(currentTotal + delta);
		await pb.collection('Quota').update(existing.id, { Total_Quota: nextTotal });
	} else {
		await pb.collection('Quota').create({
			relation: userId,
			Total_Quota: clampInt(Math.max(serverEnv.defaultQuotaPages, serverEnv.defaultQuotaPages + delta)),
			Use: 0
		});
	}

	return getQuota(pb, userId);
}

/**
 * Admin "รีเซ็ต" — re-sync the per-user ceiling back to the master
 * tier value (pulled from the `Quota` relation) and zero out `Use`.
 * Any bonus granted via "+ เพิ่มโควต้า" is wiped — the user is
 * back to their tier default. If the user has no `Quota` row yet,
 * one is created with the env default ceiling.
 */
export async function resetToDefault(
	pb: AppPocketBase,
	userId: string
): Promise<QuotaSnapshot> {
	const row = await findUserQuota(pb, userId);
	const tierTotal = await resolveTierTotal(pb, row);

	if (!row) {
		await pb.collection('Quota').create({
			relation: userId,
			Total_Quota: tierTotal,
			Use: 0
		});
		return { remaining: tierTotal, used: 0, total: tierTotal };
	}

	await pb.collection('Quota').update(row.id, {
		Total_Quota: tierTotal,
		Use: 0
	});

	return { remaining: tierTotal, used: 0, total: tierTotal };
}

/**
 * Bulk quota snapshot for the admin table — one round-trip.
 *
 *   `total`     — the per-user ceiling (from the row's `Total_Quota`
 *                 number, possibly grown by admin "+N"). Drives the
 *                 "remaining" / progress bar.
 *   `tierTotal` — the master tier value pulled from the `Quota`
 *                 relation (the user's package). Drives the
 *                 "สิทธิ์หลัก" column. Independent of admin grants.
 */
export interface UserQuotaRow {
	userId: string;
	remaining: number;
	total: number;
	used: number;
	tierTotal: number;
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
		const tierTotal = await resolveTierTotal(pb, r);
		const used = clampInt(Number(r.Use), 0);
		out.set(r.relation, {
			userId: r.relation,
			remaining: Math.max(0, total - used),
			used,
			total,
			tierTotal
		});
	}
	return out;
}