import { error, redirect, type Actions } from '@sveltejs/kit';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	createPocketBaseClient,
	type PrintJobsRecord
} from '$lib/server/pocketbase';
import { safeUnlink } from '$lib/server/functions/print/safeUnlink';
import { submitPrintJob } from '$lib/server/functions/print/submitPrintJob';
import { cancelPrintJob } from '$lib/server/functions/print/cancelPrintJob';
import { getPageCountOfFile } from '$lib/server/functions/print/getPageCountOfFile';
import { deductQuota } from '$lib/server/functions/quota/deductQuota';
import { getQuota } from '$lib/server/functions/quota/getQuota';
import { refundQuota } from '$lib/server/functions/quota/refundQuota';
import { clearSession } from '$lib/server/functions/session/clearSession';
import { serverEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

// ─── Tunables ────────────────────────────────────────────────────────────────
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB hard cap (per the new UI copy)

/**
 * Type guard for PocketBase SDK errors.
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

// Rough average wait per queued job, in minutes.
const AVG_MINUTES_PER_QUEUE_SLOT = 2;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (locals.user.role !== 'teachers' && locals.user.role !== 'superadmin' && locals.user.role !== 'admin') {
		throw error(403, 'นักศึกษาไม่ได้รับอนุญาตให้ใช้งานระบบนี้');
	}

	const pb = createPocketBaseClient();
	pb.authStore.save(locals.user.token);

	const isUserAdmin = locals.user.role === 'superadmin' || locals.user.role === 'admin';
	const filter = isUserAdmin
		? `printer_name="${serverEnv.teacherPrinterName}"`
		: `user="${locals.user.id}" && printer_name="${serverEnv.teacherPrinterName}"`;

	const [quota, jobsResult] = await Promise.all([
		getQuota(pb, locals.user.id),
		pb.collection('print_jobs').getList<PrintJobsRecord>(1, 50, {
			filter,
			sort: '-created'
		})
	]);

	// Pull the full live queue (across all users) for the teacher's printer so we can compute queue wait.
	const queueResult = await pb.collection('print_jobs').getList<PrintJobsRecord>(
		1,
		200,
		{
			filter: `printer_name="${serverEnv.teacherPrinterName}" && (status="processing" || status="pending")`,
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
		if (locals.user.role !== 'teachers' && locals.user.role !== 'superadmin' && locals.user.role !== 'admin') {
			throw error(403, 'Forbidden');
		}

		const data = await request.formData();
		const file = data.get('file');
		const copiesRaw = data.get('copies');
		const sidesRaw = data.get('sides');

		if (!(file instanceof File) || file.size === 0) {
			return { ok: false, message: 'กรุณาอัปโหลดไฟล์ที่ถูกต้อง' };
		}
		if (file.size > MAX_FILE_BYTES) {
			return {
				ok: false,
				message: 'ขนาดไฟล์เกินขีดจำกัด 50 MB กรุณาเลือกไฟล์ที่เล็กลง'
			};
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
		
		const nupRaw = Number.parseInt(String(data.get('pagesPerSheet') ?? '1'), 10);
		const pagesPerSheet: 1 | 2 | 4 = nupRaw === 2 || nupRaw === 4 ? nupRaw : 1;

		const colorRaw = String(data.get('color') ?? 'color');
		const color: 'color' | 'mono' = colorRaw === 'mono' ? 'mono' : 'color';

		const pb = createPocketBaseClient();
		pb.authStore.save(locals.user.token);

		try {
			await pb.collection('users').authRefresh();
		} catch (refreshErr) {
			console.warn('[user/print/teacher] authRefresh failed:', refreshErr);
			return { ok: false, message: 'เซสชันหมดอายุ กรุณา login ใหม่' };
		}

		await mkdir(serverEnv.tempDir, { recursive: true });
		const safeName = path
			.basename(file.name)
			.replace(/[^A-Za-z0-9._\-]/g, '_')
			.slice(0, 80);
		const tempPath = path.join(serverEnv.tempDir, `${randomUUID()}-${safeName}`);

		let jobRecordId: string | null = null;
		let chargedPages = 0;

		try {
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

			const actualPages = await getPageCountOfFile(tempPath, ext);
			const printedPagesPerCopy = Math.ceil(actualPages / pagesPerSheet);
			const totalPages = printedPagesPerCopy * copies;

			const reservation = await deductQuota(pb, locals.user.id, totalPages, locals.user.user_type_id);
			if (!reservation) {
				throw new Error('INSUFFICIENT_QUOTA');
			}
			chargedPages = totalPages;

			const jobPayload = {
				user: locals.user.id,
				filename: safeName,
				status: 'pending',
				pages: totalPages,
				copies,
				printer_name: serverEnv.teacherPrinterName
			};
			console.log('[user/print/teacher] create payload:', jobPayload);
			const created = await pb.collection('print_jobs').create<PrintJobsRecord>(jobPayload);
			jobRecordId = created.id;

			const result = await submitPrintJob({
				filePath: tempPath,
				copies,
				title: `${locals.user.email} — ${safeName}`,
				sides,
				pagesPerSheet,
				color,
				printerName: serverEnv.teacherPrinterName
			});

			await pb.collection('print_jobs').update<PrintJobsRecord>(created.id, {
				status: 'processing',
				cups_job_id: result.jobId
			});

			return {
				ok: true,
				message: `ส่งงานพิมพ์เข้าคิวเครื่องพิมพ์อาจารย์เรียบร้อย (job #${result.jobId})`,
				jobId: result.jobId,
				quota: reservation
			};
		} catch (err) {
			if (err instanceof Error && err.message === 'INSUFFICIENT_QUOTA') {
				return { ok: false, message: 'โควต้าคงเหลือไม่เพียงพอ' };
			}

			console.error('[user/print/teacher] failed for', locals.user.id, err);

			const pbFieldErrors = isClientResponseError(err)
				? err.response?.data
				: undefined;
			if (pbFieldErrors && Object.keys(pbFieldErrors).length > 0) {
				console.error('[user/print/teacher] PB field errors:', pbFieldErrors);
			}

			let refundOk = false;
			if (chargedPages > 0) {
				try {
					await refundQuota(pb, locals.user.id, chargedPages);
					refundOk = true;
				} catch (refundErr) {
					console.error('[user/print/teacher] refund failed:', refundErr);
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
			await safeUnlink(tempPath);
		}
	},

	cancel: async ({ request, locals }) => {
		if (!locals.user) throw error(401, 'Unauthorized');
		if (locals.user.role !== 'teachers' && locals.user.role !== 'superadmin' && locals.user.role !== 'admin') {
			throw error(403, 'Forbidden');
		}

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
			try {
				await refundQuota(pb, locals.user.id, job.pages);
			} catch {
				/* swallow */
			}
			if (job.cups_job_id) {
				await cancelPrintJob(job.cups_job_id, job.printer_name);
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
