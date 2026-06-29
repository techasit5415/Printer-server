<script lang="ts">
	import { enhance } from "$app/forms";
	import { Printer, Search, Plus, RefreshCw, Users, X } from "@lucide/svelte";
	import AlertBanner from "$lib/components/AlertBanner.svelte";
	import Button from "$lib/components/Button.svelte";
	import QuotaBar from "$lib/components/QuotaBar.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import type { PageData, ActionData } from "./$types";
	import { onMount } from "svelte";
	import { pbBrowser } from "$lib/pb.client";
	import { invalidateAll } from "$app/navigation";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local search state for the user-quotas table — client-side filter
	// over the server-rendered list.
	let query = $state("");

	// Bulk-selection state for the user-quotas table. A `Set` so we
	// can answer "is this row selected?" in O(1) per render and so
	// "select all" / "clear" rebuild a fresh set without aliasing.
	let selectedIds = $state(new Set<string>());

	// Ref to the header "select all" checkbox — needed because the
	// `indeterminate` property is a DOM-only flag with no attribute
	// equivalent. We sync it from a `$effect` whenever the selection
	// count crosses the partial boundary. Plain `let` is fine here:
	// `bind:this` only writes once on mount and the `$effect` runs
	// after mount, so we don't need reactive state.
	let selectAllEl: HTMLInputElement | null = null;

	function toggleOne(id: string, checked: boolean): void {
		const next = new Set(selectedIds);
		if (checked) next.add(id);
		else next.delete(id);
		selectedIds = next;
	}

	function toggleAll(checked: boolean): void {
		selectedIds = checked
			? new Set(filteredUsers.map((u) => u.id))
			: new Set();
	}

	function clearSelection(): void {
		selectedIds = new Set();
	}

	/**
	 * `use:enhance` callback shared by both bulk-action forms.
	 * Default behaviour (rerender `data` + populate `form`) runs via
	 * `await update()`, then we clear the selection on success so
	 * the next bulk op starts from an empty slate.
	 */
	function clearOnSuccess() {
		return async ({
			result,
			update,
		}: {
			result: { type: string };
			update: () => Promise<void>;
		}) => {
			await update();
			if (result.type === "success") selectedIds = new Set();
		};
	}

	$effect(() => {
		if (!selectAllEl) return;
		const total = filteredUsers.length;
		const sel = selectedIds.size;
		selectAllEl.indeterminate = sel > 0 && sel < total;
	});

	let filteredUsers = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return data.users;
		return data.users.filter((u) => {
			return (
				(u.name ?? "").toLowerCase().includes(q) ||
				u.email.toLowerCase().includes(q) ||
				(u.role ?? "").toLowerCase().includes(q) ||
				u.id.toLowerCase().includes(q) ||
				(u.expand?.user_type?.type ?? "").toLowerCase().includes(q)
			);
		});
	});

	function jobRef(id: string): string {
		// Suffix of PB id uppercased — stable per row, ~4 chars.
		return `JOB-${id.slice(-4).toUpperCase()}`;
	}

	/**
	 * Display label for a job status. The mapping lives here (not in
	 * StatusBadge) because the UI also surfaces `queuePosition` for
	 * the "pending" state — "ต่อคิว (ลำดับ N)" — and StatusBadge is a
	 * pure chip with no per-state sub-text support.
	 */
	function jobStatusLabel(job: {
		status: string;
		queuePosition: number | null;
	}): string {
		switch (job.status) {
			case "processing":
				return "กำลังพิมพ์...";
			case "pending":
				return `ต่อคิว (ลำดับ ${job.queuePosition ?? "?"})`;
			case "completed":
				return "เสร็จสิ้น";
			case "failed":
				return "ล้มเหลว";
			default:
				return job.status;
		}
	}

	function requesterLabel(job: {
		expand?: { user?: { name?: string; email?: string } };
		user: string;
	}): string {
		const u = job.expand?.user;
		if (u?.name) return u.name;
		if (u?.email) return u.email;
		return job.user;
	}

	onMount(() => {
		let unsubscribeJobs: (() => void) | null = null;
		let unsubscribeQuota: (() => void) | null = null;

		async function init() {
			try {
				const pb = pbBrowser();

				// Subscribe to all print_jobs updates
				unsubscribeJobs = await pb
					.collection("print_jobs")
					.subscribe("*", () => {
						invalidateAll();
					});

				// Subscribe to all Quota updates
				unsubscribeQuota = await pb
					.collection("Quota")
					.subscribe("*", () => {
						invalidateAll();
					});
			} catch (err) {
				console.error(
					"Failed to subscribe to admin realtime updates:",
					err,
				);
			}
		}

		init();

		return () => {
			if (unsubscribeJobs) unsubscribeJobs();
			if (unsubscribeQuota) unsubscribeQuota();
		};
	});
</script>

<div class="mx-auto max-w-6xl px-6 py-8">
	<header class="mb-8">
		<h1 class="text-2xl font-semibold tracking-tight text-fg-app">
			Control Panel
		</h1>
	</header>

	{#if form?.message}
		<div class="mb-4">
			<AlertBanner
				variant={form.ok ? "success" : "error"}
				message={form.message}
			/>
		</div>
	{/if}

	<!-- ── System Print Queue ─────────────────────────────────────────── -->
	<section
		class="mb-8 rounded-xl border border-app bg-surface shadow-sm transition-colors"
	>
		<div class="flex items-center gap-2 border-b border-app px-6 py-4">
			<Printer class="h-4 w-4 text-accent" />
			<h2 class="text-base font-semibold text-fg-app">คิวเครื่องพิมพ์</h2>
		</div>
		<div class="max-h-[400px] overflow-auto">
			<table class="w-full text-sm">
				<thead
					class="sticky top-0 z-10 border-b border-app bg-surface text-xs tracking-wide text-muted-app"
				>
					<tr>
						<th class="px-6 py-3 text-left font-medium">รหัสงาน</th>
						<th class="px-6 py-3 text-left font-medium"
							>ชื่อไฟล์เอกสาร</th
						>
						<th class="px-6 py-3 text-left font-medium"
							>ผู้สั่งพิมพ์</th
						>
						<th class="px-6 py-3 text-left font-medium"
							>เครื่องพิมพ์</th
						>
						<th class="px-6 py-3 text-left font-medium"
							>สถานะระบบ</th
						>
						<th class="px-6 py-3 text-left font-medium"
							>การจัดการคิว</th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-app">
					{#each data.jobs as job (job.id)}
						<tr class="hover:bg-elevated transition-colors">
							<td class="px-6 py-4 font-mono text-xs text-accent"
								>#{jobRef(job.id)}</td
							>
							<td class="px-6 py-4 font-medium text-fg-app"
								>{job.filename}</td
							>
							<td class="px-6 py-4 text-secondary-app"
								>{requesterLabel(job)}</td
							>
							<td class="px-6 py-4 text-secondary-app"
								>{job.printer_name}</td
							>
							<td class="px-6 py-4">
								<StatusBadge status={job.status} />
								{#if job.status === "pending" || job.status === "processing"}
									<p class="mt-1 text-xs text-muted-app">
										{jobStatusLabel(job)}
									</p>
								{/if}
							</td>
							<td class="px-6 py-4">
								{#if job.status === "processing"}
									<form
										method="POST"
										action="?/suspend"
										use:enhance
									>
										<input
											type="hidden"
											name="jobId"
											value={job.id}
										/>
										<Button
											variant="danger"
											size="sm"
											type="submit">ระงับงาน</Button
										>
									</form>
								{:else if job.status === "pending"}
									<form
										method="POST"
										action="?/remove"
										use:enhance
									>
										<input
											type="hidden"
											name="jobId"
											value={job.id}
										/>
										<Button
											variant="danger"
											size="sm"
											type="submit">ลบคิว</Button
										>
									</form>
								{:else}
									<span class="text-xs text-muted-app">-</span
									>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td
								colspan="6"
								class="px-6 py-8 text-center text-sm text-muted-app"
							>
								ไม่มีงานพิมพ์ในคิว
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ── User Quotas ───────────────────────────────────────────────── -->
	<section
		class="rounded-xl border border-app bg-surface shadow-sm transition-colors"
	>
		<div class="flex items-center gap-2 border-b border-app px-6 py-4">
			<Users class="h-4 w-4 text-accent" />
			<h2 class="text-base font-semibold text-fg-app">
				การจัดการสิทธิ์และโควต้าพิมพ์กงาน (User Quotas)
			</h2>
		</div>

		<div class="border-b border-app px-6 py-3">
			<div class="relative">
				<Search
					class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-app"
				/>
				<input
					type="search"
					bind:value={query}
					placeholder="ค้นหาด้วยชื่อพนักงาน, ID หรือแผนก..."
					class="w-full rounded-md border border-app bg-elevated py-2 pl-10 pr-3 text-sm text-fg-app placeholder:text-muted-app transition-colors focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
				/>
			</div>
		</div>

		<!-- Bulk action bar — visible whenever there's at least one row.
		     Disabled state of the buttons reflects the selection count;
		     the summary text on the left tells the admin what's queued. -->
		{#if filteredUsers.length > 0}
			<div
				class="flex flex-wrap items-center gap-3 border-b border-app bg-elevated/50 px-6 py-3"
			>
				<span class="text-sm text-secondary-app">
					{#if selectedIds.size === 0}
						ยังไม่ได้เลือกผู้ใช้ — ติ๊ก checkbox เพื่อทำ bulk action
					{:else if selectedIds.size === filteredUsers.length}
						เลือกทั้งหมด {selectedIds.size} คน
					{:else}
						เลือก {selectedIds.size} จาก {filteredUsers.length} คน
					{/if}
				</span>

				<div class="ml-auto flex items-center gap-2">
					<form
						method="POST"
						action="?/bulkAdjustQuota"
						use:enhance={clearOnSuccess}
						class="flex items-center gap-1"
					>
						{#each [...selectedIds] as id (id)}
							<input type="hidden" name="userIds" value={id} />
						{/each}
						<div class="relative">
							<Plus
								class="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-app"
							/>
							<input
								type="number"
								name="delta"
								min="1"
								step="1"
								required
								placeholder=" จำนวน"
								title="จำนวนหน้าที่จะเพิ่ม (ใส่ค่าลบได้)"
								class="w-22 rounded-md border border-app bg-surface py-2 pl-6 pr-2 text-xs font-mono text-fg-app placeholder:text-muted-app focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
							/>
						</div>
						<Button
							variant="primary"
							size="sm"
							type="submit"
							disabled={selectedIds.size === 0}
						>
							เพิ่ม (ที่เลือก)
						</Button>
					</form>

					<form
						method="POST"
						action="?/bulkResetQuota"
						use:enhance={clearOnSuccess}
					>
						{#each [...selectedIds] as id (id)}
							<input type="hidden" name="userIds" value={id} />
						{/each}
						<Button
							variant="secondary"
							size="sm"
							type="submit"
							disabled={selectedIds.size === 0}
						>
							<RefreshCw class="h-3 w-3" />
							รีเซ็ต (ที่เลือก)
						</Button>
					</form>

					<Button
						variant="ghost"
						size="sm"
						onclick={clearSelection}
						disabled={selectedIds.size === 0}
					>
						<X class="h-3 w-3" />
						ล้างการเลือก
					</Button>
				</div>
			</div>
		{/if}

		<div class="max-h-[600px] overflow-auto">
			<table class="w-full text-sm">
				<thead
					class="sticky top-0 z-10 border-b border-app bg-surface text-xs tracking-wide text-muted-app"
				>
					<tr>
						<th class="w-10 px-6 py-3 text-left font-medium">
							<input
								type="checkbox"
								bind:this={selectAllEl}
								checked={filteredUsers.length > 0 &&
									selectedIds.size === filteredUsers.length}
								onchange={(e) =>
									toggleAll(e.currentTarget.checked)}
								aria-label="เลือกผู้ใช้ทั้งหมด"
								class="h-4 w-4 rounded border-strong-app text-accent focus:ring-accent/40"
							/>
						</th>
						<th class="px-6 py-3 text-left font-medium"
							>พนักงาน (User)</th
						>
						<th class="px-6 py-3 text-left font-medium"> ยศ</th>
						<th class="px-6 py-3 text-left font-medium"
							>สิทธิ์หลัก</th
						>
						<th class="px-6 py-3 text-left font-medium"
							>โควต้าที่ใช้ไป</th
						>
						<th class="px-6 py-3 text-left font-medium"
							>เครื่องมือจัดการโควต้า</th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-app">
					{#each filteredUsers as u (u.id)}
						{@const quota = u.quota}
						<tr class="hover:bg-elevated transition-colors">
							<td class="px-6 py-4">
								<input
									type="checkbox"
									checked={selectedIds.has(u.id)}
									onchange={(e) =>
										toggleOne(
											u.id,
											e.currentTarget.checked,
										)}
									aria-label={`เลือก ${u.name ?? u.email}`}
									class="h-4 w-4 rounded border-strong-app text-accent focus:ring-accent/40"
								/>
							</td>
							<td class="px-6 py-4">
								<div class="font-medium text-fg-app">
									{u.name ?? u.email}
								</div>
								<div
									class="mt-0.5 font-mono text-xs text-muted-app"
								>
									ID: {u.id.slice(-4)}
								</div>
							</td>
							<td class="px-6 py-4 text-secondary-app">
								{u.expand?.user_type?.type ?? "—"}
							</td>
							<td class="px-6 py-4 text-secondary-app"
								>{quota.tierTotal} หน้า / เทอม</td
							>
							<td class="px-6 py-4">
								<div class="text-sm font-medium text-fg-app">
									<span
										class={quota.remaining <= 0
											? "text-danger"
											: ""}
									>
										{quota.used}
									</span>
									<span class="text-muted-app">
										/ {quota.total} หน้า</span
									>
								</div>
								<div class="mt-1.5 w-40">
									<QuotaBar
										used={quota.used}
										total={quota.total}
									/>
								</div>
							</td>
							<td class="px-6 py-4">
								<div class="flex items-center gap-2">
									<form
										method="POST"
										action="?/adjustQuota"
										use:enhance
										class="flex items-center gap-1"
									>
										<input
											type="hidden"
											name="userId"
											value={u.id}
										/>
										<div class="relative">
											<Plus
												class="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-app"
											/>
											<input
												type="number"
												name="delta"
												min="1"
												step="1"
												required
												placeholder=" จำนวน"
												title="จำนวนหน้าที่ต้องการเพิ่ม (ใส่ค่าลบได้ถ้าต้องการลด)"
												class="w-22 rounded-md border border-app bg-surface py-2 pl-6 pr-2 text-xs font-mono text-fg-app placeholder:text-muted-app focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
											/>
										</div>
										<Button
											variant="primary"
											size="sm"
											type="submit"
										>
											เพิ่ม
										</Button>
									</form>
									<form
										method="POST"
										action="?/resetQuota"
										use:enhance
									>
										<input
											type="hidden"
											name="userId"
											value={u.id}
										/>
										<Button
											variant="secondary"
											size="sm"
											type="submit"
										>
											<RefreshCw class="h-3 w-3" />
											รีเซ็ต
										</Button>
									</form>
								</div>
							</td>
						</tr>
					{:else}
						<tr>
							<td
								colspan="6"
								class="px-6 py-8 text-center text-sm text-muted-app"
							>
								ไม่พบพนักงานที่ตรงกับคำค้น
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
