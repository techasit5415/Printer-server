<script lang="ts">
	import { theme } from '$lib/theme';
	import { Sun, Moon } from '@lucide/svelte';
</script>

<button
	type="button"
	onclick={() => theme.toggle()}
	aria-label="Toggle color theme"
	title="Toggle color theme"
	class="group inline-flex h-9 items-center gap-2 rounded-md border border-app bg-surface px-3 font-mono text-xs text-secondary-app transition-colors duration-300 hover:border-strong-app hover:text-fg-app"
>
	{#if $theme === 'midnight'}
		<Sun class="h-3.5 w-3.5 text-accent" />
		<span>Light</span>
	{:else}
		<Moon class="h-3.5 w-3.5 text-accent" />
		<span>Midnight</span>
	{/if}
</button>
