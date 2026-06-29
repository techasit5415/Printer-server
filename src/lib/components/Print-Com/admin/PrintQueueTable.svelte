<script lang="ts">
	import { enhance } from "$app/forms";
	import { Printer } from "@lucide/svelte";
	import Button from "$lib/components/Button.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import type { PrintJobsRecord } from "$lib/server/pocketbase";

	let { jobs }: { jobs: Array<PrintJobsRecord & { queuePosition: number | null }> } = $props();

	function jobRef(id: string): string {
		// Suffix of PB id uppercased — stable per row, ~4 chars.
		return `JOB-${id.slice(-4).toUpperCase()}`;
	}

	function jobStatusLabel(job: {
		status: string;
		queuePosition: number | null;
		error_message?: string | null;
	}): string {
		switch (job.status) {
			case "processing":
				return "เครื่องกำลังทำงานอยู่";
			case "pending":
				return `ต่อคิว (ลำดับ ${job.queuePosition ?? "?"})`;
			case "completed":
				return "พิมพ์เสร็จเรียบร้อย";
			case "failed":
				return job.error_message ?? "เกิดข้อผิดพลาด";
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
</script>

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
					<th class="px-6 py-3 text-left font-medium">ชื่อไฟล์เอกสาร</th>
					<th class="px-6 py-3 text-left font-medium">ผู้สั่งพิมพ์</th>
					<th class="px-6 py-3 text-left font-medium">เครื่องพิมพ์</th>
					<th class="px-6 py-3 text-left font-medium">สถานะระบบ</th>
					<th class="px-6 py-3 text-left font-medium">การจัดการคิว</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-app">
				{#each jobs as job (job.id)}
					<tr class="hover:bg-elevated transition-colors">
						<td class="px-6 py-4 font-mono text-xs text-accent">
							#{jobRef(job.id)}
						</td>
						<td class="px-6 py-4 font-medium text-fg-app">
							{job.filename}
						</td>
						<td class="px-6 py-4 text-secondary-app">
							{requesterLabel(job)}
						</td>
						<td class="px-6 py-4 text-secondary-app">
							{job.printer_name}
						</td>
						<td class="px-6 py-4">
							<StatusBadge status={job.status} />
							{#if job.status === "pending" || job.status === "processing" || job.status === "failed" || job.status === "completed"}
								{@const label = jobStatusLabel(job)}
								{#if label}
									<p class="mt-1 text-xs text-muted-app">
										{label}
									</p>
								{/if}
							{/if}
						</td>
						<td class="px-6 py-4">
							{#if job.status === "processing"}
								<form method="POST" action="?/suspend" use:enhance>
									<input type="hidden" name="jobId" value={job.id} />
									<Button variant="danger" size="sm" type="submit">
										ระงับงาน
									</Button>
								</form>
							{:else if job.status === "pending"}
								<form method="POST" action="?/remove" use:enhance>
									<input type="hidden" name="jobId" value={job.id} />
									<Button variant="danger" size="sm" type="submit">
										ลบคิว
									</Button>
								</form>
							{:else}
								<span class="text-xs text-muted-app">-</span>
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
