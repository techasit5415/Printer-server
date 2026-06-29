<script lang="ts">
	import { enhance } from "$app/forms";
	import { Upload, X } from "@lucide/svelte";
	import Button from "$lib/components/Button.svelte";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import type { PrintJobsRecord } from "$lib/server/pocketbase";

	let { jobs }: { jobs: Array<PrintJobsRecord & { queueAhead: number | null; etaMinutes: number | null }> } = $props();

	function jobStatusSub(job: {
		status: string;
		queueAhead: number | null;
		etaMinutes: number | null;
		error_message?: string | null;
	}): string {
		switch (job.status) {
			case "processing":
				return "เครื่องกำลังทำงานอยู่";
			case "pending": {
				const ahead = job.queueAhead ?? 0;
				const eta = job.etaMinutes ?? ahead * 2;
				return ahead === 0
					? "กำลังจะเริ่มพิมพ์ในอีกสักครู่"
					: `รออีก ${ahead} คิว (ประมาณ ${eta} นาที)`;
			}
			case "completed":
				return "พิมพ์เสร็จเรียบร้อย";
			case "failed":
				return job.error_message ?? "เกิดข้อผิดพลาด";
			default:
				return "";
		}
	}
</script>

<section
	class="rounded-xl border border-app bg-surface shadow-sm transition-colors"
>
	<div class="flex items-center gap-2 border-b border-app px-6 py-4">
		<Upload class="h-4 w-4 text-accent" />
		<h2 class="text-base font-semibold text-fg-app">
			งานพิมพ์ของคุณ (Your Job)
		</h2>
	</div>
	<div class="overflow-x-auto">
		{#if jobs.length === 0}
			<div class="px-6 py-12 text-center">
				<Upload class="mx-auto mb-3 h-8 w-8 text-muted-app" />
				<p class="text-sm text-muted-app">ยังไม่มีงานพิมพ์</p>
			</div>
		{:else}
			<table class="w-full text-sm px-2">
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
					{#each jobs as job (job.id)}
						{@const sub = jobStatusSub(job)}
						<tr class="hover:bg-elevated transition-colors">
							<td class="px-6 py-4 font-medium text-fg-app">
								{job.filename}
							</td>
							<td class="px-6 py-4 text-secondary-app">
								{job.printer_name}
							</td>
							<td class="px-6 py-4 text-secondary-app">
								{job.pages} หน้า
							</td>
							<td class="px-6 py-4">
								<StatusBadge status={job.status} />
								{#if sub}
									<p class="mt-1 text-xs text-muted-app">
										{sub}
									</p>
								{/if}
							</td>
							<td class="px-6 py-4">
								{#if job.status === "pending" || job.status === "processing"}
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
