<script lang="ts">
	import type { LeaseStatus } from '$lib/types';
	import { CheckCircle2, CircleDashed } from '@lucide/svelte';

	let { status }: { status: LeaseStatus } = $props();
</script>

{#if status === 'pending'}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-app bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-secondary-app"
	>
		<CircleDashed class="h-3 w-3 text-accent" />
		pending
	</span>
{:else}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-app bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-app"
	>
		<CheckCircle2 class="h-3 w-3 text-success" style="color: var(--success)" />
		completed
	</span>
{/if}
