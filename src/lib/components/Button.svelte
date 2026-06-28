<script lang="ts">
	/**
	 * Unified button. Token-based so light/dark themes work without
	 * swapping class lists. Renders an `<a>` when `href` is set,
	 * otherwise a real `<button>` so form actions still submit.
	 */
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
	type Size = 'sm' | 'md';

	interface Props {
		variant?: Variant;
		size?: Size;
		href?: string;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		fullWidth?: boolean;
		title?: string;
		class?: string;
		children: Snippet;
		onclick?: (e: MouseEvent) => void;
	}

	let {
		variant = 'secondary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		fullWidth = false,
		title,
		class: extraClass = '',
		children,
		onclick
	}: Props = $props();

	// Sizing — sm for inline table actions, md for CTAs.
	const sizeClasses: Record<Size, string> = {
		sm: 'h-8 px-3 text-xs',
		md: 'h-10 px-5 text-sm'
	};

	// Variant styling. All token-driven so themes swap automatically.
	const variantClasses: Record<Variant, string> = {
		primary:
			'bg-accent text-fg-app hover:bg-accent-soft hover:text-accent border border-transparent',
		secondary:
			'border border-app bg-surface text-secondary-app hover:border-strong-app hover:text-fg-app',
		danger:
			'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
		ghost:
			'text-secondary-app hover:text-fg-app hover:bg-elevated border border-transparent'
	};

	const base =
		'inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-wide ' +
		'transition-colors duration-200 ' +
		'disabled:cursor-not-allowed disabled:opacity-50 ' +
		'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 ' +
		'focus-visible:ring-offset-app';

	const classes = $derived(
		[
			base,
			sizeClasses[size],
			variantClasses[variant],
			fullWidth ? 'w-full' : '',
			extraClass
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

{#if href}
	<a {href} class={classes} {title} {onclick}>
		{@render children()}
	</a>
{:else}
	<button {type} class={classes} {disabled} {title} {onclick}>
		{@render children()}
	</button>
{/if}