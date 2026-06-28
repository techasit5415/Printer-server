<script lang="ts">
	/**
	 * Quota usage progress bar — token-driven.
	 *
	 * `used / total` ratio decides the bar colour:
	 *   - ≤10% remaining → danger
	 *   - ≤30% remaining → warning
	 *   - otherwise      → accent
	 *
	 * `remaining` of 0 (or any negative `used - total`) still renders a
	 * 100% bar with the danger colour so the UI honestly reflects
	 * "out of quota" without hiding behind an empty track.
	 */
	interface Props {
		used: number;
		total: number;
		size?: 'sm' | 'md';
		showLabel?: boolean;
		class?: string;
	}

	let { used, total, size = 'md', showLabel = false, class: extraClass = '' }: Props = $props();

	const safeTotal = $derived(Math.max(0, total));
	const safeUsed = $derived(Math.max(0, Math.min(used, safeTotal)));
	const pct = $derived(safeTotal === 0 ? 0 : Math.round((safeUsed / safeTotal) * 100));
	const remaining = $derived(Math.max(0, safeTotal - safeUsed));
	const remainingPct = $derived(safeTotal === 0 ? 0 : Math.round((remaining / safeTotal) * 100));

	const severity = $derived(
		remainingPct <= 10 ? 'danger' : remainingPct <= 30 ? 'warning' : 'accent'
	);

	const severityClasses = {
		accent: 'bg-accent',
		warning: 'bg-warning',
		danger: 'bg-danger'
	} as const;

	const trackHeight = $derived(size === 'sm' ? 'h-1' : 'h-1.5');
</script>

<div class={`w-full ${extraClass}`}>
	{#if showLabel}
		<div class="mb-1.5 flex items-center justify-between text-xs">
			<span class="text-muted-app font-mono">{safeUsed} / {safeTotal} หน้า</span>
			<span class="text-muted-app font-mono">{pct}%</span>
		</div>
	{/if}
	<div class={`w-full overflow-hidden rounded-full bg-elevated ${trackHeight}`}>
		<div
			class={`h-full rounded-full transition-all duration-300 ${severityClasses[severity]}`}
			style="width: {pct}%"
		></div>
	</div>
</div>