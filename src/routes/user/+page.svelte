<script lang="ts">
	import { enhance } from '$app/forms';
	import { Upload, X } from '@lucide/svelte';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import Button from '$lib/components/Button.svelte';
	import QuotaBar from '$lib/components/QuotaBar.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
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

	/**
	 * Display label for a job status. Lives here (not in StatusBadge)
	 * because we also surface queue position + ETA as sub-text, and
	 * StatusBadge is a pure chip with no per-state sub-text support.
	 */
	function jobStatusSub(job: {
		status: string;
		queueAhead: number | null;
		etaMinutes: number | null;
		error_message?: string | null;
	}): string {
		switch (job.status) {
			case 'processing':
				return 'เครื่องกำลังทำงานอยู่';
			case 'pending': {
				const ahead = job.queueAhead ?? 0;
				const eta = job.etaMinutes ?? ahead * 2;
				return ahead === 0
					? 'กำลังจะเริ่มพิมพ์ในอีกสักครู่'
					: `รออีก ${ahead} คิว (ประมาณ ${eta} นาที)`;
			}
			case 'completed':
				return 'พิมพ์เสร็จเรียบร้อย';
			case 'failed':
				return job.error_message ?? 'เกิดข้อผิดพลาด';
			default:
				return '';
		}
	}
</script>

<div class="mx-auto max-w-4xl px-6 py-8">
	<header class="mb-8">
		<h1 class="text-2xl font-semibold tracking-tight text-fg-app">
			อัปโหลดไฟล์
		</h1>

	</header>

	{#if form?.message}
		<div class="mb-4">
			<AlertBanner variant={form.ok ? 'success' : 'error'} message={form.message} />
		</div>
	{/if}

	<!-- ── Quota summary ────────────────────────────────────────────── -->
	<section class="mb-6 rounded-xl border border-app bg-surface p-5 shadow-sm transition-colors">
		<div class="flex items-center justify-between gap-4">
			<div>
				<p class="text-xs font-mono text-muted-app">
					โควต้าคงเหลือ (Quota Remaining)
				</p>
				<p class="mt-1 text-2xl font-semibold text-fg-app">
					<span class={data.quota.remaining <= 0 ? 'text-danger' : 'text-accent'}>
						{data.quota.remaining}
					</span>
					<span class="text-base font-normal text-muted-app">/ {data.quota.total} หน้า</span>
				</p>
			</div>
			{#if data.quota.total > 0}
				<div class="hidden flex-1 sm:block">
					<QuotaBar used={data.quota.used} total={data.quota.total} />
					<p class="mt-1 text-right text-xs text-muted-app">
						ใช้ไปแล้ว {data.quota.used} หน้า ({Math.round((data.quota.used / data.quota.total) * 100)}%)
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
				class={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors ${
					dragOver
						? 'border-accent bg-accent-soft'
						: 'border-strong-app bg-elevated hover:border-accent hover:bg-accent-soft/40'
				}`}
				ondragover={(e) => {
					e.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => (dragOver = false)}
				ondrop={onDropUpload}
			>
				<Upload
					class={`mb-3 h-7 w-7 ${dragOver ? 'text-accent' : 'text-muted-app'}`}
				/>
				<p class="text-base font-medium text-fg-app">
					{submitting ? 'กำลังส่งงานพิมพ์...' : 'คลิกหรือลากไฟล์มาวางที่นี่เพื่อพิมพ์'}
				</p>
				<!-- <p class="text-base font-medium text-fg-app">
					{submitting ? 'กำลังส่งงานพิมพ์...' : 'คลิกหรือลากไฟล์มาวางที่นี่เพื่อพิมพ์'}
				</p> -->
				<p class="mt-1 text-xs text-muted-app">
					รองรับ PDF / PS / JPG / PNG / TXT (สูงสุด 25MB)
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
	<section class="rounded-xl border border-app bg-surface shadow-sm transition-colors">
		<div class="flex items-center gap-2 border-b border-app px-6 py-4">
			<Upload class="h-4 w-4 text-accent" />
			<h2 class="text-base font-semibold text-fg-app">งานพิมพ์ของคุณ (Your Job)</h2>
		</div>
		<div class="overflow-x-auto">
			{#if data.jobs.length === 0}
				<div class="px-6 py-12 text-center">
					<Upload class="mx-auto mb-3 h-8 w-8 text-muted-app" />
					<p class="text-sm text-muted-app">
						ยังไม่มีงานพิมพ์ — ลากไฟล์มาวางที่กล่องด้านบนเพื่อเริ่มงานแรกของคุณ
					</p>
				</div>
			{:else}
				<table class="w-full text-sm">
					<thead
						class="border-b border-app text-xs tracking-wide text-muted-app"
					>
						<tr>
							<th class="px-6 py-3 text-left font-medium">ชื่อเอกสาร</th>
							<th class="px-6 py-3 text-left font-medium">เครื่องพิมพ์</th>
							<th class="px-6 py-3 text-left font-medium">ความยาว</th>
							<th class="px-6 py-3 text-left font-medium">สถานะ / ลำดับคิว</th>
							<th class="px-6 py-3 text-left font-medium">การจัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-app">
						{#each data.jobs as job (job.id)}
							{@const sub = jobStatusSub(job)}
							<tr class="hover:bg-elevated transition-colors">
								<td class="px-6 py-4 font-medium text-fg-app">{job.filename}</td>
								<td class="px-6 py-4 text-secondary-app">{job.printer_name}</td>
								<td class="px-6 py-4 text-secondary-app">{job.pages} หน้า</td>
								<td class="px-6 py-4">
									<StatusBadge status={job.status} />
									{#if sub}
										<p class="mt-1 text-xs text-muted-app">{sub}</p>
									{/if}
								</td>
								<td class="px-6 py-4">
									{#if job.status === 'pending' || job.status === 'processing'}
										<form method="POST" action="?/cancel" use:enhance>
											<input type="hidden" name="jobId" value={job.id} />
											<Button variant="danger" size="sm" type="submit">
												<X class="h-3 w-3" />
												ยกเลิกงานพิมพ์
											</Button>
										</form>
									{:else}
										<span class="text-xs text-muted-app">-</span>
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