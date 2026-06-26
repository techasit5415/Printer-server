<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { Printer, LogOut } from '@lucide/svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
	let user = $derived(page.data.user);

	// Pull up to two capital letters from the user's display name (or
	// fall back to the local-part of the email). Splits on whitespace
	// and dots so names like "Techasit.V" → "TV".
	function initials(name?: string | null, email?: string | null): string {
		const source = (name && name.trim()) || (email ? email.split('@')[0] : '') || '';
		const parts = source.split(/[\s.]+/).filter(Boolean);
		const letters = parts
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('');
		if (letters) return letters;
		return (email?.[0] ?? '?').toUpperCase();
	}

	function roleLabel(role?: string | null): string {
		if (role === 'admin') return 'ผู้ดูแลระบบ';
		if (role === 'user') return 'พนักงานทั่วไป';
		return '';
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if user}
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
			<a href="/" class="flex items-center gap-2 text-slate-900">
				<Printer class="h-5 w-5 text-blue-600" />
				<span class="text-base font-semibold tracking-tight">PrintOS Platform</span>
			</a>

			<div class="flex items-center gap-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700"
					>
						{initials(user.name, user.email)}
					</div>
					<div class="hidden sm:block leading-tight">
						<p class="text-sm font-medium text-slate-900">{user.name ?? user.email}</p>
						<p class="text-xs text-slate-500">{roleLabel(user.role)}</p>
					</div>
				</div>
				<form action="/logout" method="POST">
					<button
						type="submit"
						class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
					>
						<LogOut class="h-4 w-4" />
						ออกจากระบบ
					</button>
				</form>
			</div>
		</div>
	</header>
{/if}

<main class="min-h-[calc(100vh-4rem)] bg-slate-50">
	{@render children()}
</main>