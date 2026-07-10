<script lang="ts">
	import { onMount } from "svelte";
	import { pbBrowser } from "$lib/pb/client";
	import { invalidateAll } from "$app/navigation";
	import AlertBanner from "$lib/components/AlertBanner.svelte";
	import QuotaBar from "$lib/components/QuotaBar.svelte";
	import StagedPrintForm from "$lib/components/Print-Com/user/StagedPrintForm.svelte";
	import UserJobsTable from "$lib/components/Print-Com/user/UserJobsTable.svelte";
	import type { PageData, ActionData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	onMount(() => {
		let unsubscribeJobs: (() => void) | null = null;
		let unsubscribeQuota: (() => void) | null = null;

		async function init() {
			try {
				const pb = pbBrowser();

				// Subscribe to print_jobs changes for the current user
				unsubscribeJobs = await pb
					.collection("print_jobs")
					.subscribe("*", (e) => {
						if (e.record.user === data.user?.id) {
							invalidateAll();
						}
					});

				// Subscribe to Quota changes for the current user
				if (data.user?.quota?.id) {
					unsubscribeQuota = await pb
						.collection("Quota")
						.subscribe(data.user.quota.id, () => {
							invalidateAll();
						});
				}
			} catch (err) {
				console.error("Failed to subscribe to realtime updates:", err);
			}
		}

		init();

		return () => {
			if (unsubscribeJobs) unsubscribeJobs();
			if (unsubscribeQuota) unsubscribeQuota();
		};
	});
</script>

<div class="mx-auto max-w-7xl px-6 py-8">
	<header class="mb-8">
		<h1
			class="text-2xl font-semibold tracking-tight text-center text-fg-app"
		>
			อัปโหลดไฟล์
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

	<!-- ── Quota summary ── -->
	<section
		class="mb-6 rounded-xl border border-app bg-surface p-5 shadow-sm transition-colors"
	>
		<div class="flex items-center justify-between gap-4">
			<div>
				<p class="text-xs font-mono text-muted-app">
					โควต้าคงเหลือ (Quota Remaining)
				</p>
				<p class="mt-1 text-2xl font-semibold text-fg-app">
					{#if ['000000000000002', '000000000000009'].includes(data.user?.user_type_id ?? '')}
						<span class="text-accent">ไม่จำกัด (Unlimited)</span>
					{:else}
						<span
							class={data.quota.remaining <= 0
								? "text-danger"
								: "text-accent"}
						>
							{data.quota.remaining}
						</span>
						<span class="text-base font-normal text-muted-app"
							>/ {data.quota.total} หน้า</span
						>
					{/if}
				</p>
			</div>
			{#if ['000000000000002', '000000000000009'].includes(data.user?.user_type_id ?? '')}
				<div class="hidden flex-1 sm:block text-right">
					<p class="text-xs text-muted-app">
						ใช้ไปแล้วทั้งหมด {data.quota.used} หน้า
					</p>
				</div>
			{:else if data.quota.total > 0}
				<div class="hidden flex-1 sm:block">
					<QuotaBar used={data.quota.used} total={data.quota.total} />
					<p class="mt-1 text-right text-xs text-muted-app">
						ใช้ไปแล้ว {data.quota.used} หน้า ({Math.round(
							(data.quota.used / data.quota.total) * 100,
						)}%)
					</p>
				</div>
			{/if}
		</div>
	</section>

	<StagedPrintForm />

	<UserJobsTable jobs={data.jobs} />
</div>
