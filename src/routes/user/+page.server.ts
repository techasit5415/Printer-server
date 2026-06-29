import { error, redirect, type Actions } from '@sveltejs/kit';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	createPocketBaseClient,
	type PrintJobsRecord
} from '$lib/server/pocketbase';
import { safeUnlink, submitPrintJob, cancelPrintJob, getPageCountOfFile } from '$lib/server/print';
import { deductQuota, getQuota, refundQuota } from '$lib/server/quota';
import { clearSession } from '$lib/server/session';
import { serverEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

// ─── Tunables ────────────────────────────────────────────────────────────────
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB hard cap (per the new UI copy)

/**
 * Type guard for PocketBase SDK errors. `ClientResponseError` carries
 * the parsed response body under `response` (and `originalError`),
 * including the per-field validation map. We use it to surface the
 * exact field the schema rejected.
 */
interface PBFieldErrors {
	[key: string]: unknown;
}

interface PBClientErrorShape {
	status: number;
	response?: { data?: PBFieldErrors; message?: string };
	originalError?: { data?: PBFieldErrors };
}

function isClientResponseError(err: unknown): err is PBClientErrorShape {
	if (typeof err !== 'object' || err === null) return false;
	const obj = err as { status?: unknown; response?: unknown };
	return typeof obj.status === 'number' && obj.response !== undefined;
}
const ALLOWED_MIME = new Set([
	'application/pdf',
	'application/postscript',
	'image/jpeg',
	'image/png',
	'text/plain'
]);
const ALLOWED_EXT = new Set(['.pdf', '.ps', '.jpg', '.jpeg', '.png', '.txt']);

// Rough average wait per queued job, in minutes. The Fuji Xerox C3061
// averages ~2 min/page, and the queue depth correlates with wait — this
// drives the "รออีก N คิว (ประมาณ X นาที)" copy in the UI.
const AVG_MINUTES_PER_QUEUE_SLOT = 2;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	// Admins are allowed to land on this page too (e.g. to test the
	// personal print flow from the user perspective). We still scope
	// every query to `locals.user.id` below, so they only ever see
	// their own jobs/quota.

	const pb = createPocketBaseClient();
	pb.authStore.save(locals.user.token);

	const [quota, jobsResult] = await Promise.all([
		getQuota(pb, locals.user.id),
		pb.collection('print_jobs').getList<PrintJobsRecord>(1, 50, {
			filter: `user="${locals.user.id}"`,
			sort: '-created'
		})
	]);

	// Pull the full live queue (across all users) so we can compute
	// "รออีก N คิว" for each of this user's pending jobs.
	const queueResult = await pb.collection('print_jobs').getList<PrintJobsRecord>(
		1,
		200,
		{
			filter: 'status="processing" || status="pending"',
			sort: 'created',
			fields: 'id,created,status,user'
		}
	);

	const queueIndex = new Map<string, number>();
	queueResult.items.forEach((j, idx) => queueIndex.set(j.id, idx));

	const jobs = jobsResult.items.map((j) => {
		const queuePos = queueIndex.get(j.id);
		const queueAhead = queuePos === undefined ? null : Math.max(0, queuePos - 1);
		const etaMinutes = queueAhead === null ? null : queueAhead * AVG_MINUTES_PER_QUEUE_SLOT;
		return { ...j, queueAhead, etaMinutes };
	});

	return { quota, jobs };
};

/**
 * User actions — submit a print job, or cancel one already in the queue.
 */
export const actions: Actions = {
	print: async ({ request, locals }) => {
		if (!locals.user) throw error(401, 'Unauthorized');

		const data = await request.formData();
		const file = data.get('file');
		const copiesRaw = data.get('copies');
		const sidesRaw = data.get('sides');

		if (!(file instanceof File) || file.size === 0) {
			return { ok: false, message: 'กรุณาเลือกไฟล์ที่ต้องการพิมพ์' };
		}
		if (file.size > MAX_FILE_BYTES) {
			return { ok: false, message: `ไฟล์มีขนาดเกิน ${MAX_FILE_BYTES / 1024 / 1024} MiB` };
		}

		const ext = path.extname(file.name).toLowerCase();
		if (!ALLOWED_EXT.has(ext) || (file.type && !ALLOWED_MIME.has(file.type))) {
			return { ok: false, message: 'ประเภทไฟล์ไม่ได้รับอนุญาต' };
		}

		const copies = Math.min(
			99,
			Math.max(1, Number.parseInt(String(copiesRaw ?? '1'), 10) || 1)
		);
		const sidesRawStr = String(sidesRaw ?? 'one-sided');
		const sides: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge' =
			sidesRawStr === 'two-sided-long-edge' || sidesRawStr === 'two-sided-short-edge'
				? sidesRawStr
				: 'one-sided';
		// N-up layout (pages per sheet) — confirmed in the preview
		// step before submit. Defaults to 1 (full-size pages).
		const nupRaw = Number.parseInt(String(data.get('pagesPerSheet') ?? '1'), 10);
		const pagesPerSheet: 1 | 2 | 4 = nupRaw === 2 || nupRaw === 4 ? nupRaw : 1;

		// Colour mode — defaults to colour. Mono prints B&W on a
		// colour printer, saving toner/ink.
		const colorRaw = String(data.get('color') ?? 'color');
		const color: 'color' | 'mono' = colorRaw === 'mono' ? 'mono' : 'color';

		const pb = createPocketBaseClient();
		pb.authStore.save(locals.user.token);

		// Force a fresh auth refresh so `pb.authStore.record` is
		// populated before any create. PB's `user = @request.auth.id`
		// rule internally joins back to the auth user record — if the
		// client-side record is null (which `authStore.save({token})`
		// leaves it), some rule-evaluation paths fall through to a
		// `sql: no rows in result set` error. Refreshing ensures the
		// SDK and server are in sync, and surfaces a 401 here if the
		// token has gone stale.
		try {
			await pb.collection('users').authRefresh();
		} catch (refreshErr) {
			console.warn('[user/print] authRefresh failed (token may be stale):', refreshErr);
			return { ok: false, message: 'เซสชันหมดอายุ กรุณา login ใหม่' };
		}

		// Make sure the temp dir exists, then stream the upload to disk
		// in chunks — never load the whole buffer into RAM.
		await mkdir(serverEnv.tempDir, { recursive: true });
		const safeName = path
			.basename(file.name)
			.replace(/[^A-Za-z0-9._\-]/g, '_')
			.slice(0, 80);
		const tempPath = path.join(serverEnv.tempDir, `${randomUUID()}-${safeName}`);

		let jobRecordId: string | null = null;
		let chargedPages = 0;

		try {
			// Stream to disk via Web ReadableStream → Node WritableStream.
			// This caps memory at ~64 KiB regardless of file size.
			const nodeStream = await import('node:stream');
			const { Readable } = nodeStream;
			const writeStream = (await import('node:fs')).createWriteStream(tempPath, {
				mode: 0o600,
				flags: 'wx'
			});

			const webStream = file.stream() as unknown as ReadableStream<Uint8Array>;
			const nodeReadable = Readable.fromWeb(webStream as never);

			await new Promise<void>((resolve, reject) => {
				nodeReadable.pipe(writeStream);
				nodeReadable.on('error', reject);
				writeStream.on('error', reject);
				writeStream.on('finish', () => resolve());
			});

			// Calculate actual page count
			const actualPages = await getPageCountOfFile(tempPath, ext);
			const totalPages = actualPages * copies;

			// Reserve the quota based on the actual pages
			const reservation = await deductQuota(pb, locals.user.id, totalPages);
			if (!reservation) {
				throw new Error('INSUFFICIENT_QUOTA');
			}
			chargedPages = totalPages;

			// Record the job in PB before touching CUPS — we want a
			// durable audit trail even if the daemon is unreachable.
			// `cups_job_id` and `error_message` are intentionally
			// omitted from the create payload — they're populated by
			// the update calls below (CUPS success / failure paths).
			// Sending them as `null` was rejected by PB with a generic
			// 400 because the schema marks them as required.
			const jobPayload = {
				user: locals.user.id,
				filename: safeName,
				status: 'pending',
				pages: totalPages,
				copies,
				printer_name: serverEnv.printerName
			};
			// Diagnostic — PB's createRule `user = @request.auth.id`
			// fails with "sql: no rows in result set" when the ids
			// disagree (e.g. token bound to a deleted/renamed user).
			// Log the payload + the auth record PB resolved from the
			// token so a future regression is one grep away.
			console.log('[user/print] create payload:', jobPayload);
			console.log('[user/print] auth record:', pb.authStore.record);
			const created = await pb.collection('print_jobs').create<PrintJobsRecord>(jobPayload);
			jobRecordId = created.id;

			// Hand the file to CUPS. This is the point of no return.
			const result = await submitPrintJob({
				filePath: tempPath,
				copies,
				title: `${locals.user.email} — ${safeName}`,
				sides,
				pagesPerSheet,
				color
			});

			await pb.collection('print_jobs').update<PrintJobsRecord>(created.id, {
				status: 'processing',
				cups_job_id: result.jobId
			});

			return {
				ok: true,
				message: `ส่งงานพิมพ์เข้าคิว CUPS เรียบร้อย (job #${result.jobId})`,
				jobId: result.jobId,
				quota: reservation
			};
		} catch (err) {
			if (err instanceof Error && err.message === 'INSUFFICIENT_QUOTA') {
				return { ok: false, message: 'โควต้าคงเหลือไม่เพียงพอ' };
			}

			// Log the full error to the dev server console so the
			// actual failure point (validation, mkdir, stream, PB
			// create, CUPS submit) is debuggable. The user-facing
			// `message` below carries the same err.message so it
			// also appears in the UI.
			console.error('[user/print] failed for', locals.user.id, err);

			// Surface PB field-level validation details when the SDK
			// exposes them via `response.data`. The top-level
			// `err.message` is just "Failed to create record." which
			// is useless — the per-field map tells us which column
			// actually failed (e.g. `{user: {"code":"validation_required"}}`).
			const pbFieldErrors = isClientResponseError(err)
				? err.response?.data
				: undefined;
			if (pbFieldErrors && Object.keys(pbFieldErrors).length > 0) {
				console.error('[user/print] PB field errors:', pbFieldErrors);
			}

			// Try to refund the reservation and mark the job as failed.
			// Capture the refund outcome so we can surface it in the UI
			// — silently swallowed refund failures used to leave the
			// user's quota "stuck" (deducted but not returned) after
			// a failed print, with no signal that anything was wrong.
			let refundOk = false;
			if (chargedPages > 0) {
				try {
					await refundQuota(pb, locals.user.id, chargedPages);
					refundOk = true;
				} catch (refundErr) {
					console.error('[user/print] refund failed:', refundErr);
				}
			}
			if (jobRecordId) {
				try {
					await pb.collection('print_jobs').update<PrintJobsRecord>(jobRecordId, {
						status: 'failed',
						error_message: err instanceof Error ? err.message : 'unknown error'
					});
				} catch {
					/* swallow */
				}
			}

			// Build a user-facing message that includes the PB field
			// hint when available — admins can see exactly which
			// column the schema rejected.
			const fieldHint =
				pbFieldErrors && Object.keys(pbFieldErrors).length > 0
					? ` (ฟิลด์ที่มีปัญหา: ${Object.keys(pbFieldErrors).join(', ')})`
					: '';
			const refundNote = refundOk || chargedPages === 0 ? '' : ' (คืนโควต้าไม่สำเร็จ — โควต้าอาจถูกหักค้างไว้ กรุณาแจ้ง admin)';
			const message =
				err instanceof Error
					? `ส่งงานพิมพ์ไม่สำเร็จ: ${err.message}${fieldHint}${refundNote}`
					: `ไม่สามารถส่งงานพิมพ์ได้ กรุณาลองใหม่${refundNote}`;

			return { ok: false, message };
		} finally {
			// ALWAYS drop the temp file — no matter what happened.
			await safeUnlink(tempPath);
		}
	},

	cancel: async ({ request, locals }) => {
		if (!locals.user) throw error(401, 'Unauthorized');

		const data = await request.formData();
		const jobId = String(data.get('jobId') ?? '');
		if (!jobId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

		const pb = createPocketBaseClient();
		pb.authStore.save(locals.user.token);

		try {
			const job = await pb.collection('print_jobs').getOne<PrintJobsRecord>(jobId);
			if (job.user !== locals.user.id) {
				throw error(403, 'Forbidden');
			}
			if (job.status !== 'pending' && job.status !== 'processing') {
				return { ok: false, message: 'ไม่สามารถยกเลิกงานที่พิมพ์เสร็จแล้ว' };
			}

			await pb.collection('print_jobs').update(jobId, {
				status: 'failed',
				error_message: 'Cancelled by user'
			});
			// Refund the pages we charged up-front so the user can resubmit.
			try {
				await refundQuota(pb, locals.user.id, job.pages);
			} catch {
				/* swallow — refund is best-effort */
			}
			// Cancel in CUPS if queued
			if (job.cups_job_id) {
				await cancelPrintJob(job.cups_job_id);
			}
			return { ok: true, message: 'ยกเลิกงานพิมพ์เรียบร้อย' };
		} catch (e) {
			if (e instanceof Error && 'status' in e) throw e;
			return { ok: false, message: 'ไม่สามารถยกเลิกงานได้' };
		}
	},

	logout: async ({ cookies }) => {
		clearSession(cookies);
		throw redirect(303, '/login');
	}
};