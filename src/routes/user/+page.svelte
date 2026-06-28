<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Upload,
		Hourglass,
		Zap,
		CheckCircle2,
		AlertTriangle,
		X
	} from '@lucide/svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let copies = $state(1);
	let dragOver = $state(false);

	// Refs for the upload form — there is no visible submit button,
	// so the form has to be triggered programmatically when the user
	// picks a file via the hidden `<input type="file">` or drops one
	// onto the drop zone. Without this the form silently does
	// nothing on selection (which is why "อัพไฟล์ไม่ได้" was
	// reported as a no-op rather than a thrown error).
	let uploadFormEl: HTMLFormElement | null = null;
	let uploadFileEl: HTMLInputElement | null = null;

	function submitUpload(): void {
		if (uploadFormEl && uploadFileEl?.files && uploadFileEl.files.length > 0) {
			uploadFormEl.requestSubmit();
		}
	}

	function onFileChosen(): void {
		submitUpload();
	}

	function onDropUpload(e: DragEvent): void {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files?.[0];
		if (!file || !uploadFileEl) return;

		// Move the dropped file onto the hidden `<input type="file">`
		// so it gets serialised into the multipart form data, then
		// trigger the submit. `DataTransfer` is the only spec-blessed
		// way to assign to `input.files` programmatically.
		const dt = new DataTransfer();
		dt.items.add(file);
		uploadFileEl.files = dt.files;

		submitUpload();
	}

	type StatusView = {
		text: string;
		sub: string;
		textClass: string;
		icon: typeof Hourglass;
	};

	function statusView(job: {
		status: string;
		queueAhead: number | null;
		etaMinutes: number | null;
		error_message?: string | null;
	}): StatusView {
		switch (job.status) {
			case 'processing':
				return {
					text: 'กำลังพิมพ์',
					sub: 'เครื่องกำลังทำงานอยู่',
					textClass: 'text-amber-700',
					icon: Zap
				};
			case 'pending': {
				const ahead = job.queueAhead ?? 0;
				const eta = job.etaMinutes ?? ahead * 2;
				return {
					text: 'ต่อคิว',
					sub:
						ahead === 0
							? 'กำลังจะเริ่มพิมพ์ในอีกสักครู่'
							: `รออีก ${ahead} คิว (ประมาณ ${eta} นาที)`,
					textClass: 'text-amber-700',
					icon: Hourglass
				};
			}
			case 'completed':
				return {
					text: 'เสร็จสิ้น',
					sub: 'พิมพ์เสร็จเรียบร้อย',
					textClass: 'text-emerald-700',
					icon: CheckCircle2
				};
			case 'failed':
				return {
					text: 'ล้มเหลว',
					sub: job.error_message ?? 'เกิดข้อผิดพลาด',
					textClass: 'text-red-700',
					icon: AlertTriangle
				};
			default:
				return {
					text: job.status,
					sub: '',
					textClass: 'text-slate-700',
					icon: Hourglass
				};
		}
	}
</script>

<div class="mx-auto max-w-4xl px-6 py-8">
	<header class="mb-8">
		<h1 class="text-2xl font-semibold text-slate-900">พื้นที่ส่งงานพิมพ์ส่วนตัว</h1>
		<p class="mt-2 text-sm text-slate-500">
			อัปโหลดไฟล์เพื่อส่งพิมพ์อย่างปลอดภัย
			ระบบจะแสดงผลเฉพาะทางของคุณเพื่อความเป็นส่วนตัวสูงสุด
		</p>
	</header>

	{#if form?.message}
		<p
			class="mb-4 rounded-lg border px-3 py-2 text-sm {form.ok
				? 'border-emerald-200 bg-emerald-50 text-emerald-700'
				: 'border-red-200 bg-red-50 text-red-700'}"
		>
			{form.message}
		</p>
	{/if}

	<!-- ── Quota summary ────────────────────────────────────────────── -->
	<section class="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
		<div class="flex items-center justify-between gap-4">
			<div>
				<p class="text-xs font-mono uppercase tracking-widest text-slate-500">
					โควต้าคงเหลือ (Quota Remaining)
				</p>
				<p class="mt-1 text-2xl font-semibold text-slate-900">
					<span class={data.quota.remaining <= 0 ? 'text-red-600' : 'text-blue-600'}>
						{data.quota.remaining}
					</span>
					<span class="text-base font-normal text-slate-500">/ {data.quota.total} หน้า</span>
				</p>
			</div>
			{#if data.quota.total > 0}
				{@const qPct = Math.min(100, Math.round((data.quota.used / data.quota.total) * 100))}
				<div class="hidden flex-1 sm:block">
					<div class="h-2 w-full overflow-hidden rounded-full bg-slate-200">
						<div
							class="h-2 rounded-full transition-all {qPct >= 90
								? 'bg-red-500'
								: qPct >= 70
									? 'bg-amber-500'
									: 'bg-blue-500'}"
							style="width: {qPct}%"
						></div>
					</div>
					<p class="mt-1 text-right text-xs text-slate-500">
						ใช้ไปแล้ว {data.quota.used} หน้า ({qPct}%)
					</p>
				</div>
			{/if}
		</div>
	</section>

	<!-- ── Upload area ───────────────────────────────────────────────── -->
	<section class="mb-8">
		<form
			bind:this={uploadFormEl}
			method="POST"
			action="?/print"
			enctype="multipart/form-data"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<label
				class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors {dragOver
					? 'border-blue-500 bg-blue-50'
					: 'border-blue-300 bg-blue-50/30 hover:bg-blue-50/60'}"
				ondragover={(e) => {
					e.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => (dragOver = false)}
				ondrop={onDropUpload}
			>
				<Upload class="mb-3 h-7 w-7 text-slate-700" />
				<p class="text-base font-medium text-slate-900">
					คลิกหรือลากไฟล์มาวางที่นี่เพื่อพิมพ์
				</p>
				<p class="mt-1 text-xs text-slate-500">
					รองรับไฟล์เอกสารและรูปภาพทุกประเภท (สูงสุด 25MB)
				</p>
				<input
					bind:this={uploadFileEl}
					name="file"
					type="file"
					required
					accept=".pdf,.ps,.jpg,.jpeg,.png,.txt,application/pdf,application/postscript,image/jpeg,image/png,text/plain"
					class="sr-only"
					onchange={onFileChosen}
				/>
				<input type="hidden" name="copies" value={copies} />
				<input type="hidden" name="sides" value="one-sided" />
			</label>
		</form>
	</section>

	<!-- ── Your Job ──────────────────────────────────────────────────── -->
	<section class="rounded-xl border border-slate-200 bg-white shadow-sm">
		<div class="border-b border-slate-200 px-6 py-4">
			<h2 class="text-base font-semibold text-slate-900">งานพิมพ์ของคุณ (Your Job)</h2>
		</div>
		<div class="overflow-x-auto">
			{#if data.jobs.length === 0}
				<p class="px-6 py-10 text-center text-sm text-slate-500">
					ยังไม่มีงานพิมพ์ — ลากไฟล์มาวางที่กล่องด้านบนเพื่อเริ่มงานแรกของคุณ
				</p>
			{:else}
				<table class="w-full text-sm">
					<thead
						class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
					>
						<tr>
							<th class="px-6 py-3 text-left font-medium">ชื่อเอกสาร</th>
							<th class="px-6 py-3 text-left font-medium">เครื่องพิมพ์</th>
							<th class="px-6 py-3 text-left font-medium">ความยาว</th>
							<th class="px-6 py-3 text-left font-medium">สถานะ / ลำดับคิว</th>
							<th class="px-6 py-3 text-left font-medium">การจัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-200">
						{#each data.jobs as job (job.id)}
							{@const status = statusView(job)}
							<tr class="hover:bg-slate-50/60">
								<td class="px-6 py-4 font-medium text-slate-900">{job.filename}</td>
								<td class="px-6 py-4 text-slate-700">{job.printer_name}</td>
								<td class="px-6 py-4 text-slate-700">{job.pages} หน้า</td>
								<td class="px-6 py-4">
									<div class="inline-flex items-center gap-1.5 {status.textClass}">
										<status.icon class="h-4 w-4" />
										<span class="font-medium">{status.text}</span>
									</div>
									{#if status.sub}
										<div class="mt-0.5 text-xs text-slate-500">{status.sub}</div>
									{/if}
								</td>
								<td class="px-6 py-4">
									{#if job.status === 'pending' || job.status === 'processing'}
										<form method="POST" action="?/cancel" use:enhance>
											<input type="hidden" name="jobId" value={job.id} />
											<button
												type="submit"
												class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
											>
												<X class="h-3 w-3" />
												ยกเลิกงานพิมพ์
											</button>
										</form>
									{:else}
										<span class="text-xs text-slate-400">-</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</section>
</div>