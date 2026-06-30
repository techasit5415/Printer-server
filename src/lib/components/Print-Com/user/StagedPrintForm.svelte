<script lang="ts">
	import { deserialize, applyAction } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import {
		BookOpen,
		Check,
		FileText,
		Minus,
		NotebookPen,
		Plus,
		Printer,
		Upload,
		X,
	} from "@lucide/svelte";
	import Button from "$lib/components/Button.svelte";

	let submitting = $state(false);
	let uploadProgress = $state(0);
	let isProcessing = $state(false);
	let dragOver = $state(false);

	// Two-step upload flow state.
	let selectedFile = $state<File | null>(null);
	let pagesPerSheet = $state<1 | 2 | 4>(1);
	let copies = $state(1);
	let sides = $state<
		"one-sided" | "two-sided-long-edge" | "two-sided-short-edge"
	>("one-sided");
	let color = $state<"color" | "mono">("color");

	// Refs for the upload form
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
		if (
			uploadFormEl &&
			uploadFileEl?.files &&
			uploadFileEl.files.length > 0
		) {
			uploadFormEl.requestSubmit();
		}
	}

	async function handleFormSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting) return;

		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);

		submitting = true;
		uploadProgress = 0;
		isProcessing = false;

		const xhr = new XMLHttpRequest();
		const actionUrl = form.action || "?/print";

		xhr.open("POST", actionUrl, true);
		xhr.setRequestHeader("x-sveltekit-action", "true");

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) {
				const pct = Math.round((e.loaded / e.total) * 100);
				uploadProgress = pct;
				if (pct >= 100) {
					isProcessing = true;
				}
			}
		};

		xhr.onload = async () => {
			try {
				if (xhr.status >= 200 && xhr.status < 300) {
					const result = deserialize(xhr.responseText);
					if (result.type === "success") {
						await invalidateAll();
						clearStaged();
					}
					await applyAction(result);
				} else {
					const result = {
						type: "failure",
						status: xhr.status,
						data: { ok: false, message: `เกิดข้อผิดพลาดในการส่งไฟล์ (${xhr.status})` }
					} as any;
					await applyAction(result);
				}
			} catch (err) {
				console.error("Failed to parse form action response:", err);
				const result = {
					type: "failure",
					status: 500,
					data: { ok: false, message: "การประมวลผลลัพธ์จากเซิร์ฟเวอร์ล้มเหลว" }
				} as any;
				await applyAction(result);
			} finally {
				submitting = false;
				uploadProgress = 0;
				isProcessing = false;
			}
		};

		xhr.onerror = async () => {
			submitting = false;
			uploadProgress = 0;
			isProcessing = false;
			const result = {
				type: "failure",
				status: 500,
				data: { ok: false, message: "เครือข่ายขัดข้อง กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต" }
			} as any;
			await applyAction(result);
		};

		xhr.send(formData);
	}
</script>

<section class="mb-8">
	<form
		bind:this={uploadFormEl}
		method="POST"
		action="?/print"
		enctype="multipart/form-data"
		onsubmit={handleFormSubmit}
	>
		<!-- Hidden file input -->
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
		<input type="hidden" name="sides" value={sides} />
		<input type="hidden" name="color" value={color} />
		<input type="hidden" name="pagesPerSheet" value={pagesPerSheet} />
		<input type="hidden" name="copies" value={copies} />

		{#if !selectedFile}
			<!-- Step 1: drop zone. -->
			<label
				for="upload-file-input"
				class={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors ${
					dragOver
						? "border-accent bg-accent-soft"
						: "border-strong-app bg-elevated hover:border-accent hover:bg-accent-soft/40"
				}`}
				ondragover={(e) => {
					e.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => (dragOver = false)}
				ondrop={onDropUpload}
			>
				<Upload
					class={`mb-3 h-7 w-7 ${dragOver ? "text-accent" : "text-muted-app"}`}
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
			{@const twoUpActive = pagesPerSheet === 2}
			{@const fourUpActive = pagesPerSheet === 4}
			{@const oneSidedActive = sides === "one-sided"}
			{@const longEdgeActive = sides === "two-sided-long-edge"}
			{@const shortEdgeActive = sides === "two-sided-short-edge"}
			{@const colorActive = color === "color"}
			{@const monoActive = color === "mono"}
			<div
				class="rounded-md border border-strong-app bg-surface p-6 transition-colors"
			>
				<!-- File header -->
				<div
					class="flex items-start justify-between gap-4 border-b border-app pb-4"
				>
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
								{fileSize(selectedFile.size)} · {selectedFile.type ||
									"ไม่ทราบชนิด"}
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
					<div class="mt-2 grid grid-cols-3 gap-3">
						<button
							type="button"
							onclick={() => (pagesPerSheet = 1)}
							disabled={submitting}
							class={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-colors disabled:opacity-50 ${
								oneUpActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<div
								class="flex h-16 w-12 items-center justify-center border border-strong-app bg-surface"
							>
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
							onclick={() => (pagesPerSheet = 2)}
							disabled={submitting}
							class={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-colors disabled:opacity-50 ${
								twoUpActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<div
								class="grid h-16 w-12 grid-cols-2 gap-0.5 border border-strong-app bg-surface p-0.5"
							>
								<div class="bg-elevated"></div>
								<div class="bg-elevated"></div>
							</div>
							<div class="flex items-center gap-1.5">
								{#if twoUpActive}
									<Check class="h-3.5 w-3.5 text-accent" />
								{/if}
								<span class="text-xs">2 หน้าต่อแผ่น</span>
							</div>
						</button>
						<button
							type="button"
							onclick={() => (pagesPerSheet = 4)}
							disabled={submitting}
							class={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-colors disabled:opacity-50 ${
								fourUpActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<div
								class="grid h-16 w-12 grid-cols-2 grid-rows-2 gap-0.5 border border-strong-app bg-surface p-0.5"
							>
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

				<!-- Sides (1-sided / 2-sided long edge / 2-sided short edge) -->
				<div class="mt-5">
					<p class="text-sm text-fg-app">การพิมพ์ 2 ด้าน</p>
					<div class="mt-2 grid grid-cols-3 gap-2">
						<button
							type="button"
							onclick={() => (sides = "one-sided")}
							disabled={submitting}
							class={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-center transition-colors disabled:opacity-50 ${
								oneSidedActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<Printer class="h-5 w-5 text-muted-app" />
							<span class="text-xs">1 ด้าน</span>
						</button>
						<button
							type="button"
							onclick={() => (sides = "two-sided-long-edge")}
							disabled={submitting}
							class={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-center transition-colors disabled:opacity-50 ${
								longEdgeActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<BookOpen class="h-5 w-5 text-muted-app" />
							<span class="text-xs">2 ด้าน (ยาว)</span>
						</button>
						<button
							type="button"
							onclick={() => (sides = "two-sided-short-edge")}
							disabled={submitting}
							class={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-center transition-colors disabled:opacity-50 ${
								shortEdgeActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<NotebookPen class="h-5 w-5 text-muted-app" />
							<span class="text-xs">2 ด้าน (สั้น)</span>
						</button>
					</div>
				</div>

				<!-- Colour mode (colour / mono) -->
				<div class="mt-5">
					<p class="text-sm text-fg-app">
						สี แต่ก็ปริ้นได้แค่ขาวดำเหมือนเดิมนั้นแหละมีให้ดีใจเล่น
					</p>
					<div class="mt-2 grid grid-cols-2 gap-2">
						<button
							type="button"
							onclick={() => (color = "color")}
							disabled={submitting}
							class={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-center transition-colors disabled:opacity-50 ${
								colorActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<div class="flex gap-0.5">
								<div class="h-3 w-2 rounded-sm bg-danger"></div>
								<div class="h-3 w-2 rounded-sm bg-warning"></div>
								<div class="h-3 w-2 rounded-sm bg-accent"></div>
								<div class="h-3 w-2 rounded-sm bg-success"></div>
							</div>
							<span class="text-xs">สี </span>
							<span class="text-xs text-red-700">
								(แต่ก็ปริ้นได้แค่ขาวดำเหมือนเดิมนั้นแหละมีให้ดีใจเล่น)
							</span>
						</button>
						<button
							type="button"
							onclick={() => (color = "mono")}
							disabled={submitting}
							class={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-center transition-colors disabled:opacity-50 ${
								monoActive
									? "border-accent bg-accent-soft ring-2 ring-accent/30"
									: "border-strong-app bg-app hover:border-accent/60"
							}`}
						>
							<div class="h-3 w-8 rounded-sm bg-fg-app"></div>
							<span class="text-xs">ขาวดำ</span>
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
						<span class="text-xs text-muted-app">ชุด </span>
					</div>
				</div>

				<!-- Confirm + cancel row -->
				{#if submitting}
					<div class="mt-6 border-t border-strong-app pt-5">
						<div class="flex items-center justify-between text-xs mb-2">
							<span class="font-medium text-fg-app flex items-center gap-2">
								{#if isProcessing}
									<span class="relative flex h-2 w-2">
										<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
										<span class="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
									</span>
									กำลังประมวลผลไฟล์และจัดทำคิวพิมพ์...
								{:else}
									<Upload class="h-3.5 w-3.5 animate-bounce text-accent" />
									กำลังอัปโหลดไฟล์...
								{/if}
							</span>
							<span class="font-mono text-muted-app">{uploadProgress}%</span>
						</div>
						<div class="w-full overflow-hidden rounded-full bg-elevated h-2">
							<div
								class="h-full rounded-full bg-accent transition-all duration-300 ease-out shadow-[0_0_8px_rgba(37,99,235,0.4)]"
								style="width: {uploadProgress}%"
							></div>
						</div>
						<p class="mt-2 text-center text-xs text-muted-app animate-pulse">
							{#if isProcessing}
								กรุณารอสักครู่ ระบบกำลังคำนวณจำนวนหน้าและส่งเข้าเครื่องพิมพ์
							{:else}
								อย่าเพิ่งปิดหน้าต่างนี้จนกว่าการอัปโหลดจะเสร็จสิ้น
							{/if}
						</p>
					</div>
				{:else}
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
							ยืนยันพิมพ์
						</Button>
					</div>
				{/if}
			</div>
		{/if}
	</form>
</section>
