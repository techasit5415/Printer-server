<script lang="ts">
	import { onMount } from "svelte";
	import { pbBrowser } from "$lib/pb.client";
	import { invalidateAll } from "$app/navigation";
	import AlertBanner from "$lib/components/AlertBanner.svelte";
	import PrintQueueTable from "$lib/components/Print-Com/PrintQueueTable.svelte";
	import UserQuotasTable from "$lib/components/Print-Com/UserQuotasTable.svelte";
	import type { PageData, ActionData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

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
	<!-- <header class="mb-8">
		<h1 class="text-2xl font-semibold tracking-tight text-fg-app">
			Control Panel
		</h1>
	</header> -->

	{#if form?.message}
		<div class="mb-4">
			<AlertBanner
				variant={form.ok ? "success" : "error"}
				message={form.message}
			/>
		</div>
	{/if}

	<PrintQueueTable jobs={data.jobs} />

	<UserQuotasTable users={data.users} />
</div>
