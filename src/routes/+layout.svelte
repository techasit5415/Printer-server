<script lang="ts">
	import "./layout.css";
	import { page } from "$app/state";
	import Navbar from "$lib/components/Navbar.svelte";
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head><title>Print Server</title></svelte:head>

<!-- Navbar renders its own brand mark, theme switcher, sign-in/out
     and conditional nav links (admin console / user dashboard). -->
<Navbar />

<!-- `min-h-[calc(100dvh-3.5rem)]` keeps the page filling the viewport
     below the sticky header (h-14 = 3.5rem). `bg-app` uses the design
     token so the dark/light themes swap automatically. -->
<main
	class="min-h-[calc(100dvh-3.5rem)] bg-app text-fg-app transition-colors duration-300"
>
	{@render children()}
</main>
