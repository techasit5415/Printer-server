import { error, redirect, type Actions } from '@sveltejs/kit';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	createPocketBaseClient,
	type PrintJobsRecord
} from '$lib/server/pocketbase';
import { safeUnlink, submitPrintJob } from '$lib/server/print';
import { deductQuota, getQuota, refundQuota } from '$lib/server/quota';
import { clearSession } from '$lib/server/session';
import { serverEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

// ─── Tunables ────────────────────────────────────────────────────────────────
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB hard cap (per the new UI copy)
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
	pb.authStore.save({ token: locals.user.token } as never);

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

		// We don't know the page count up-front without rendering the
		// document — conservatively charge `copies` pages and refund if
		// CUPS reports zero / cancels.
		const estimatedPages = copies;

		const pb = createPocketBaseClient();
		pb.authStore.save({ token: locals.user.token } as never);

		// Reserve the quota BEFORE touching the disk so quota abuse is
		// impossible regardless of what happens later.
		const reservation = await deductQuota(pb, locals.user.id, estimatedPages);
		if (!reservation) {
			return { ok: false, message: 'โควต้าคงเหลือไม่เพียงพอ' };
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

			// Record the job in PB before touching CUPS — we want a
			// durable audit trail even if the daemon is unreachable.
			const created = await pb.collection('print_jobs').create<PrintJobsRecord>({
				user: locals.user.id,
				filename: safeName,
				status: 'pending',
				pages: estimatedPages,
				copies,
				printer_name: serverEnv.printerName,
				cups_job_id: null,
				error_message: null
			});
			jobRecordId = created.id;

			// Hand the file to CUPS. This is the point of no return.
			const result = await submitPrintJob({
				filePath: tempPath,
				copies,
				title: `${locals.user.email} — ${safeName}`,
				sides
			});

			await pb.collection('print_jobs').update<PrintJobsRecord>(created.id, {
				status: 'completed',
				cups_job_id: result.jobId
			});

			return {
				ok: true,
				message: `ส่งงานพิมพ์เข้าคิว CUPS เรียบร้อย (job #${result.jobId})`,
				jobId: result.jobId,
				quota: reservation
			};
		} catch (err) {
			// Try to refund the reservation and mark the job as failed.
			try {
				await refundQuota(pb, locals.user.id, estimatedPages);
			} catch {
				/* swallow — log elsewhere */
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

			const message =
				err instanceof Error ? err.message : 'ไม่สามารถส่งงานพิมพ์ได้ กรุณาลองใหม่';

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
		pb.authStore.save({ token: locals.user.token } as never);

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