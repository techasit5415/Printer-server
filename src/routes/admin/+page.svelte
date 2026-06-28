<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Printer,
		Search,
		Plus,
		RefreshCw,
		Zap,
		Hourglass,
		CheckCircle2,
		AlertTriangle,
		Users
	} from '@lucide/svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local search state for the user-quotas table — client-side filter
	// over the server-rendered list.
	let query = $state('');

	let filteredUsers = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return data.users;
		return data.users.filter((u) => {
			return (
				(u.name ?? '').toLowerCase().includes(q) ||
				u.email.toLowerCase().includes(q) ||
				(u.role ?? '').toLowerCase().includes(q) ||
				u.id.toLowerCase().includes(q) ||
				(u.expand?.user_type?.type ?? '').toLowerCase().includes(q)
			);
		});
	});

	function quotaPercent(used: number, total: number): number {
		if (total <= 0) return 0;
		return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
	}

	/**
	 * Colour the progress bar based on how much of the ceiling is
	 * still available (not consumed). `remaining` is the quota left
	 * out of `total` — when that drops below 30% we go amber, below
	 * 10% we go red.
	 */
	function quotaBarColor(remaining: number, total: number): string {
		const pct = quotaPercent(remaining, total);
		if (pct <= 10) return 'bg-red-500';
		if (pct <= 30) return 'bg-amber-500';
		return 'bg-blue-500';
	}

	function jobRef(id: string): string {
		// Suffix of PB id uppercased — stable per row, ~4 chars.
		return `JOB-${id.slice(-4).toUpperCase()}`;
	}

	type StatusView = {
		text: string;
		cls: string;
		icon: typeof Zap;
	};

	function statusView(job: { status: string; queuePosition: number | null }): StatusView {
		switch (job.status) {
			case 'processing':
				return {
					text: 'กำลังพิมพ์...',
					cls: 'bg-amber-50 text-amber-700 border-amber-200',
					icon: Zap
				};
			case 'pending':
				return {
					text: `ต่อคิว (ลำดับ ${job.queuePosition ?? '?'})`,
					cls: 'bg-amber-50 text-amber-700 border-amber-200',
					icon: Hourglass
				};
			case 'completed':
				return {
					text: 'เสร็จสิ้น',
					cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
					icon: CheckCircle2
				};
			case 'failed':
				return {
					text: 'ล้มเหลว',
					cls: 'bg-red-50 text-red-700 border-red-200',
					icon: AlertTriangle
				};
			default:
				return {
					text: job.status,
					cls: 'bg-slate-50 text-slate-700 border-slate-200',
					icon: Hourglass
				};
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
</script>

<div class="mx-auto max-w-6xl px-6 py-8">
	<header class="mb-8">
		<h1 class="text-2xl font-semibold text-slate-900">
			แผงควบคุมหลักผู้ดูแลระบบ (Admin Console)
		</h1>
		<p class="mt-2 text-sm text-slate-500">
			จัดการเครื่องพิมพ์ขนาดทั้งองค์กร และควบคุมโควต้าสำหรับการพิมพ์ของพนักงาน
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

	<!-- ── System Print Queue ─────────────────────────────────────────── -->
	<section class="mb-8 rounded-xl border border-slate-200 bg-white shadow-sm">
		<div class="flex items-center gap-2 border-b border-slate-200 px-6 py-4">
			<Printer class="h-4 w-4 text-blue-600" />
			<h2 class="text-base font-semibold text-slate-900">
				คิวเครื่องพิมพ์ทั้งหมดในระบบ (System Print Queue)
			</h2>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead
					class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
				>
					<tr>
						<th class="px-6 py-3 text-left font-medium">รหัสงาน</th>
						<th class="px-6 py-3 text-left font-medium">ชื่อไฟล์เอกสาร</th>
						<th class="px-6 py-3 text-left font-medium">ผู้สั่งพิมพ์</th>
						<th class="px-6 py-3 text-left font-medium">เครื่องพิมพ์</th>
						<th class="px-6 py-3 text-left font-medium">สถานะระบบ</th>
						<th class="px-6 py-3 text-left font-medium">การจัดการคิว</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200">
					{#each data.jobs as job (job.id)}
						{@const status = statusView(job)}
						<tr class="hover:bg-slate-50/60">
							<td class="px-6 py-4 font-mono text-xs text-blue-600">#{jobRef(job.id)}</td>
							<td class="px-6 py-4 font-medium text-slate-900">{job.filename}</td>
							<td class="px-6 py-4 text-slate-700">{requesterLabel(job)}</td>
							<td class="px-6 py-4 text-slate-700">{job.printer_name}</td>
							<td class="px-6 py-4">
								<span
									class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {status.cls}"
								>
									<status.icon class="h-3 w-3" />
									{status.text}
								</span>
							</td>
							<td class="px-6 py-4">
								{#if job.status === 'processing'}
									<form method="POST" action="?/suspend" use:enhance>
										<input type="hidden" name="jobId" value={job.id} />
										<button
											type="submit"
											class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
										>
											ระงับงาน
										</button>
									</form>
								{:else if job.status === 'pending'}
									<form method="POST" action="?/remove" use:enhance>
										<input type="hidden" name="jobId" value={job.id} />
										<button
											type="submit"
											class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
										>
											ลบคิว
										</button>
									</form>
								{:else}
									<span class="text-xs text-slate-400">-</span>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="6" class="px-6 py-8 text-center text-sm text-slate-500">
								ไม่มีงานพิมพ์ในคิว
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ── User Quotas ───────────────────────────────────────────────── -->
	<section class="rounded-xl border border-slate-200 bg-white shadow-sm">
		<div class="flex items-center gap-2 border-b border-slate-200 px-6 py-4">
			<Users class="h-4 w-4 text-blue-600" />
			<h2 class="text-base font-semibold text-slate-900">
				การจัดการสิทธิ์และโควต้าพิมพ์กงาน (User Quotas)
			</h2>
		</div>

		<div class="border-b border-slate-200 px-6 py-3">
			<div class="relative">
				<Search
					class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500"
				/>
				<input
					type="search"
					bind:value={query}
					placeholder="ค้นหาด้วยชื่อพนักงาน, ID หรือแผนก..."
					class="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
				/>
			</div>
		</div>

		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead
					class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
				>
					<tr>
						<th class="px-6 py-3 text-left font-medium">พนักงาน (User)</th>
						<th class="px-6 py-3 text-left font-medium">  ยศ</th>
						<th class="px-6 py-3 text-left font-medium">สิทธิ์หลัก</th>
						<th class="px-6 py-3 text-left font-medium">โควต้าที่ใช้ไป</th>
						<th class="px-6 py-3 text-left font-medium">เครื่องมือจัดการโควต้า</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200">
					{#each filteredUsers as u (u.id)}
						{@const quota = u.quota}
						{@const usedPct = quota.total <= 0
							? 0
							: Math.max(0, Math.min(100, Math.round((quota.used / quota.total) * 100)))}
						<tr class="hover:bg-slate-50/60">
							<td class="px-6 py-4">
								<div class="font-medium text-slate-900">{u.name ?? u.email}</div>
								<div class="mt-0.5 font-mono text-xs text-slate-500">
									ID: {u.id.slice(-4)}
								</div>
							</td>
							<td class="px-6 py-4 text-slate-700">
								{u.expand?.user_type?.type ?? '—'}
							</td>
							<td class="px-6 py-4 text-slate-700">{quota.tierTotal} หน้า / เดือน</td>
							<td class="px-6 py-4">
								<div class="text-sm font-medium text-slate-900">
									<span class={quota.remaining <= 0 ? 'text-red-600' : ''}>
										{quota.used}
									</span>
									/ {quota.remaining} หน้า
								</div>
								<div class="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-slate-200">
									<div
										class="h-1.5 rounded-full transition-all {quotaBarColor(
											quota.used,
											quota.total
										)}"
										style="width: {usedPct}%"
									></div>
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
										<input type="hidden" name="userId" value={u.id} />
										<div class="relative">
											<Plus
												class="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-blue-500"
											/>
											<input
												type="number"
												name="delta"
												min="1"
												step="1"
												required
												placeholder="จำนวน"
												title="จำนวนหน้าที่ต้องการเพิ่ม (ใส่ค่าลบได้ถ้าต้องการลด)"
												class="w-20 rounded-md border border-blue-200 bg-white py-1 pl-6 pr-2 text-xs font-mono text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
											/>
										</div>
										<button
											type="submit"
											class="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
										>
											เพิ่ม
										</button>
									</form>
									<form method="POST" action="?/resetQuota" use:enhance>
										<input type="hidden" name="userId" value={u.id} />
										<button
											type="submit"
											class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
										>
											<RefreshCw class="h-3 w-3" />
											รีเซ็ต
										</button>
									</form>
								</div>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="px-6 py-8 text-center text-sm text-slate-500">
								ไม่พบพนักงานที่ตรงกับคำค้น
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>