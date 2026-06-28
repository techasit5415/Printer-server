<script lang="ts">
	import { enhance } from '$app/forms';
	import { Check, Copy, FileText, Minus, Plus, Upload, X } from '@lucide/svelte';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import Button from '$lib/components/Button.svelte';
	import QuotaBar from '$lib/components/QuotaBar.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let dragOver = $state(false);

	// Two-step upload flow state. `selectedFile` is the staged file
	// the user picked or dropped; the actual `?/print` submit only
	// fires after they confirm the preview panel (layout + copies).
	let selectedFile = $state<File | null>(null);
	let pagesPerSheet = $state<1 | 4>(1);
	let copies = $state(1);

	// Refs for the upload form — submitted only when the user clicks
	// "ยืนยันพิมพ์" in the preview panel.
	let uploadFormEl: HTMLFormElement | null = null;
	let uploadFileEl: HTMLInputElement | null = null;

	// Human-readable file size.
	function fileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function stageFile(file: File): void {
		if (!uploadFileEl) return;
		// Assign the dropped/picked file to the hidden `<input type="file">`
		// so it serialises into the multipart form data on submit.
		// `DataTransfer` is the only spec-blessed way to set `input.files`.
		const dt = new DataTransfer();
		dt.items.add(file);
		uploadFileEl.files = dt.files;
		selectedFile = file;
		// Reset print settings each time a new file is staged.
		pagesPerSheet = 1;
		copies = 1;
	}

	function clearStaged(): void {
		selectedFile = null;
		if (uploadFileEl) uploadFileEl.files = null;
	}

	function onFileChosen(): void {
		const file = uploadFileEl?.files?.[0];
		if (file) stageFile(file);
	}

	function onDropUpload(e: DragEvent): void {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) stageFile(file);
	}

	function bumpCopies(delta: number): void {
		copies = Math.min(99, Math.max(1, copies + delta));
	}

	function confirmPrint(): void {
		if (uploadFormEl && uploadFileEl?.files && uploadFileEl.files.length > 0) {
			uploadFormEl.requestSubmit();
		}
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
	<!-- ── Upload + confirmation (2-step flow) ───────────────────── -->
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
					clearStaged();
				};
			}}
		>
			<!-- Hidden file input — kept in the DOM so the multipart
			     form can submit it. The label below uses `for=` to
			     trigger it on click; without that link the drop zone
			     is just visual because the input sits outside the
			     <label> (no implicit association). -->
			<input
				id="upload-file-input"
				bind:this={uploadFileEl}
				name="file"
				type="file"
				required
				accept=".pdf,.ps,.jpg,.jpeg,.png,.txt,application/pdf,application/postscript,image/jpeg,image/png,text/plain"
				class="sr-only"
				onchange={onFileChosen}
			/>
			<input type="hidden" name="sides" value="one-sided" />
			<input type="hidden" name="pagesPerSheet" value={pagesPerSheet} />
			<input type="hidden" name="copies" value={copies} />

			{#if !selectedFile}
				<!-- Step 1: drop zone. -->
				<label
					for="upload-file-input"
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
						คลิกหรือลากไฟล์มาวางที่นี่เพื่อพิมพ์
					</p>
					<p class="mt-1 text-xs text-muted-app">
						รองรับ PDF / PS / JPG / PNG / TXT (สูงสุด 50MB)
					</p>
				</label>
			{:else}
				<!-- Step 2: confirmation panel. -->
				{@const oneUpActive = pagesPerSheet === 1}
				{@const fourUpActive = pagesPerSheet === 4}
				<div class="rounded-md border border-strong-app bg-surface p-6 transition-colors">
					<!-- File header -->
					<div class="flex items-start justify-between gap-4 border-b border-app pb-4">
						<div class="flex items-start gap-3 min-w-0">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
							>
								<FileText class="h-5 w-5" />
							</div>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium text-fg-app">
									{selectedFile.name}
								</p>
								<p class="mt-0.5 text-xs text-muted-app">
									{fileSize(selectedFile.size)} · {selectedFile.type || 'ไม่ทราบชนิด'}
								</p>
							</div>
						</div>
						<button
							type="button"
							onclick={clearStaged}
							disabled={submitting}
							class="rounded-md p-1 text-muted-app hover:bg-elevated hover:text-fg-app disabled:opacity-50"
							title="ยกเลิก"
							aria-label="ยกเลิกการเลือกไฟล์"
						>
							<X class="h-4 w-4" />
						</button>
					</div>

					<!-- Page layout toggle -->
					<div class="mt-5">
						<p class="text-sm text-fg-app">จัดหน้า</p>
						<div class="mt-2 grid grid-cols-2 gap-3">
							<button
								type="button"
								onclick={() => (pagesPerSheet = 1)}
								disabled={submitting}
								class={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-colors disabled:opacity-50 ${
									oneUpActive
										? 'border-accent bg-accent-soft ring-2 ring-accent/30'
										: 'border-strong-app bg-app hover:border-accent/60'
								}`}
							>
								<div class="flex h-16 w-12 items-center justify-center border border-strong-app bg-surface">
									<span class="text-[10px] text-muted-app">1</span>
								</div>
								<div class="flex items-center gap-1.5">
									{#if oneUpActive}
										<Check class="h-3.5 w-3.5 text-accent" />
									{/if}
									<span class="text-xs">1 หน้าต่อแผ่น</span>
								</div>
							</button>
							<button
								type="button"
								onclick={() => (pagesPerSheet = 4)}
								disabled={submitting}
								class={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-colors disabled:opacity-50 ${
									fourUpActive
										? 'border-accent bg-accent-soft ring-2 ring-accent/30'
										: 'border-strong-app bg-app hover:border-accent/60'
								}`}
							>
								<div class="grid h-16 w-12 grid-cols-2 grid-rows-2 gap-0.5 border border-strong-app bg-surface p-0.5">
									<div class="bg-elevated"></div>
									<div class="bg-elevated"></div>
									<div class="bg-elevated"></div>
									<div class="bg-elevated"></div>
								</div>
								<div class="flex items-center gap-1.5">
									{#if fourUpActive}
										<Check class="h-3.5 w-3.5 text-accent" />
									{/if}
									<span class="text-xs">4 หน้าต่อแผ่น</span>
								</div>
							</button>
						</div>
					</div>

					<!-- Copies stepper -->
					<div class="mt-5">
						<p class="text-sm text-fg-app">จำนวนชุด</p>
						<div class="mt-2 flex items-center gap-2">
							<button
								type="button"
								onclick={() => bumpCopies(-1)}
								disabled={submitting || copies <= 1}
								class="flex h-9 w-9 items-center justify-center rounded-md border border-strong-app bg-app text-fg-app hover:bg-elevated disabled:opacity-50"
								aria-label="ลดจำนวน"
							>
								<Minus class="h-4 w-4" />
							</button>
							<input
								type="number"
								min="1"
								max="99"
								bind:value={copies}
								disabled={submitting}
								class="w-20 rounded-md border border-strong-app bg-app py-1.5 text-center text-base text-fg-app focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
							/>
							<button
								type="button"
								onclick={() => bumpCopies(+1)}
								disabled={submitting || copies >= 99}
								class="flex h-9 w-9 items-center justify-center rounded-md border border-strong-app bg-app text-fg-app hover:bg-elevated disabled:opacity-50"
								aria-label="เพิ่มจำนวน"
							>
								<Plus class="h-4 w-4" />
							</button>
							<span class="text-xs text-muted-app">ชุด (สูงสุด 99)</span>
						</div>
					</div>

					<!-- Confirm + cancel row -->
					<div class="mt-6 flex items-center justify-end gap-2">
						<Button
							variant="ghost"
							size="md"
							type="button"
							onclick={clearStaged}
							disabled={submitting}
						>
							ยกเลิก
						</Button>
						<Button
							variant="primary"
							size="md"
							type="button"
							onclick={confirmPrint}
							disabled={submitting || copies < 1}
						>
							{submitting ? 'กำลังส่ง...' : 'ยืนยันพิมพ์'}
						</Button>
					</div>
				</div>
			{/if}
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