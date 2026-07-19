<script lang="ts">
	import { page } from "$app/state";
	import {
		Printer,
		Upload,
		ShieldCheck,
		LogOut,
		LogIn,
		Menu,
		X,
	} from "@lucide/svelte";

	let user = $derived(page.data.user);
	const isSuperAdmin = $derived(user?.role === "superadmin");
	const isTeacher = $derived(user?.role === "teachers");
	const canPrintTeacher = $derived(isTeacher || isSuperAdmin);

	const links = $derived([
		...(canPrintTeacher
			? [
					{ href: "/user", label: "พิมพ์ (ทั่วไป)", icon: Upload, exact: true },
					{ href: "/user/teacher", label: "พิมพ์ (อาจารย์)", icon: Printer },
			  ]
			: user
			? [{ href: "/user", label: "พิมพ์", icon: Upload }]
			: []),
		...(isSuperAdmin
			? [{ href: "/admin", label: "แผงควบคุม", icon: ShieldCheck }]
			: []),
	]);

	// Mobile menu state — separate from the desktop nav so the hamburger
	// can collapse everything into a sheet on small screens. The menu
	// auto-closes on route change so we don't have a stale open sheet
	// when the user navigates.
	let mobileOpen = $state(false);

	$effect(() => {
		// Re-run when the pathname changes — reading `page.url.pathname`
		// inside the effect registers it as a reactive dependency.
		page.url.pathname;
		mobileOpen = false;
	});
</script>

<header
	class="sticky top-0 z-30 border-b border-app bg-app/80 backdrop-blur transition-colors duration-300"
>
	<div
		class="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:gap-6 sm:px-6"
	>
		<a
			href="/"
			class="flex items-center gap-2 font-mono text-sm tracking-tight text-fg-app"
		>
			<Printer class="h-4 w-4 text-accent" />
			<div class="flex flex-col">
				<span class="font-semibold leading-none">print server</span>
				<span
					class="mt-0.5 text-[12px] text-muted-app leading-none font-normal"
				>
					พบ ปัญหาติดต่อ Bornzi
				</span>
			</div>
			<!-- Brand suffix only shows from md up — keeps the row from
			     getting crowded on phones where every pixel counts. -->
		</a>_

		<!-- Desktop nav — hidden below lg where the hamburger takes over. -->
		<nav class="hidden items-center gap-1 lg:flex">
			{#each links as link (link.href)}
				{@const active = link.exact ? page.url.pathname === link.href : page.url.pathname.startsWith(link.href)}
				<a
					href={link.href}
					class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 font-mono text-xs transition-colors duration-200 {active
						? 'bg-elevated text-fg-app'
						: 'text-secondary-app hover:bg-elevated hover:text-fg-app'}"
				>
					<link.icon
						class="h-3.5 w-3.5 {active ? 'text-accent' : ''}"
					/>
					{link.label}
				</a>
			{/each}

			<div class="ml-2 flex items-center gap-2">
				{#if user}
					<form action="/logout" method="POST">
						<button
							type="submit"
							class="inline-flex h-9 items-center gap-1.5 rounded-md border border-app bg-surface px-3 font-mono text-xs text-secondary-app transition-colors duration-200 hover:border-strong-app hover:text-fg-app"
							title={user.email}
						>
							<LogOut class="h-3.5 w-3.5" />
							<span class="hidden xl:inline">Sign out</span>
						</button>
					</form>
				{:else}
					<a
						href="/login"
						class="inline-flex h-9 items-center gap-1.5 rounded-md border border-app bg-surface px-3 font-mono text-xs text-secondary-app transition-colors duration-200 hover:border-strong-app hover:text-fg-app"
					>
						<LogIn class="h-3.5 w-3.5" />
						<span class="hidden xl:inline">Sign in</span>
					</a>
				{/if}
			</div>
		</nav>

		<!-- Mobile controls — hamburger + always-visible auth button so
		     the user is never trapped without a sign-out. -->
		<div class="flex items-center gap-2 lg:hidden">
			{#if user}
				<form action="/logout" method="POST">
					<button
						type="submit"
						aria-label="Sign out"
						title={user.email}
						class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app bg-surface text-secondary-app transition-colors duration-200 hover:border-strong-app hover:text-fg-app"
					>
						<LogOut class="h-3.5 w-3.5" />
					</button>
				</form>
			{:else}
				<a
					href="/login"
					aria-label="Sign in"
					class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app bg-surface text-secondary-app transition-colors duration-200 hover:border-strong-app hover:text-fg-app"
				>
					<LogIn class="h-3.5 w-3.5" />
				</a>
			{/if}
			<button
				type="button"
				aria-label={mobileOpen ? "Close menu" : "Open menu"}
				aria-expanded={mobileOpen}
				onclick={() => (mobileOpen = !mobileOpen)}
				class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app bg-surface text-secondary-app transition-colors duration-200 hover:border-strong-app hover:text-fg-app"
			>
				{#if mobileOpen}
					<X class="h-4 w-4" />
				{:else}
					<Menu class="h-4 w-4" />
				{/if}
			</button>
		</div>
	</div>

	<!-- Mobile sheet. Dropdown rather than full-screen overlay — keeps
	     it cheap and in keeping with the rest of the UI's tone. The
	     svelte:window click-outside handler closes it when the user
	     taps anywhere else. -->
	{#if mobileOpen}
		<div class="border-t border-app bg-surface lg:hidden">
			<nav
				class="mx-auto flex max-w-[1400px] flex-col gap-1 px-4 py-3 sm:px-6"
			>
				{#each links as link (link.href)}
					{@const active = link.exact ? page.url.pathname === link.href : page.url.pathname.startsWith(link.href)}
					<a
						href={link.href}
						class="inline-flex h-10 items-center gap-2 rounded-md px-3 font-mono text-xs transition-colors duration-200 {active
							? 'bg-elevated text-fg-app'
							: 'text-secondary-app hover:bg-elevated hover:text-fg-app'}"
					>
						<link.icon
							class="h-4 w-4 {active ? 'text-accent' : ''}"
						/>
						{link.label}
					</a>
				{:else}
					<p class="px-3 py-4 text-center text-xs text-muted-app">
						Sign in to access Request and Status.
					</p>
				{/each}
				{#if user}
					<p
						class="mt-2 truncate border-t border-app pt-2 font-mono text-[11px] text-muted-app"
					>
						{user.email}
					</p>
				{/if}
			</nav>
		</div>
	{/if}
</header>

<svelte:window
	onpointerdown={(e) => {
		if (!mobileOpen) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest("header")) return;
		mobileOpen = false;
	}}
/>
