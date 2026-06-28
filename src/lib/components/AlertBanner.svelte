<script lang="ts">
	/**
	 * Inline alert banner — token-driven so it looks right in both
	 * midnight and light themes. Renders an icon (auto-picked from
	 * the variant) + a message line. Use for form-action feedback,
	 * page-level notices, etc.
	 */
	import { AlertCircle, AlertTriangle, CheckCircle2, Info } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	type Variant = 'success' | 'error' | 'warning' | 'info';

	interface Props {
		variant: Variant;
		message: string;
		/** Optional extra detail / body slot rendered under the title line. */
		children?: Snippet;
		class?: string;
	}

	let { variant, message, children, class: extraClass = '' }: Props = $props();

	// Icon + accent colour per variant. All token-based.
	const config: Record<Variant, { Icon: typeof AlertCircle; cls: string }> = {
		success: { Icon: CheckCircle2, cls: 'border-success/30 bg-success/10 text-success' },
		error: { Icon: AlertCircle, cls: 'border-danger/30 bg-danger/10 text-danger' },
		warning: { Icon: AlertTriangle, cls: 'border-warning/30 bg-warning/10 text-warning' },
		info: { Icon: Info, cls: 'border-accent/30 bg-accent-soft text-accent' }
	};

	let { Icon, cls } = $derived(config[variant]);
</script>

<div
	role={variant === 'error' ? 'alert' : 'status'}
	class={`flex items-start gap-3 rounded-md border p-3 text-sm ${cls} ${extraClass}`}
>
	<Icon class="mt-0.5 h-4 w-4 shrink-0" />
	<div class="flex-1">
		<p class="font-medium leading-snug">{message}</p>
		{#if children}
			<div class="mt-1 text-xs opacity-80">
				{@render children()}
			</div>
		{/if}
	</div>
</div>