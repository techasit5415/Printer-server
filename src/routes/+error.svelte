<script lang="ts">
	import { page } from "$app/state";
	import { AlertTriangle, LogOut, Home } from "@lucide/svelte";
	import Button from "$lib/components/Button.svelte";
</script>

<div
	class="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-md flex-col justify-center px-4 py-12"
>
	<div
		class="rounded-xl border border-strong-app bg-surface p-6 shadow-sm text-center"
	>
		<div
			class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger mb-4"
		>
			<AlertTriangle class="h-6 w-6" />
		</div>

		<h1 class="text-xl font-semibold text-fg-app mb-2">
			{page.status} — เกิดข้อผิดพลาด
		</h1>

		<p class="text-sm text-muted-app mb-6">
			{page.error?.message || "ไม่สามารถดำเนินการตามคำขอของคุณได้"}
		</p>

		<div class="space-y-3">
			<Button href="/" variant="secondary" fullWidth>
				<Home class="h-4 w-4" />
				กลับไปหน้าหลัก
			</Button>

			{#if page.data.user}
				<form action="/logout" method="POST" class="w-full">
					<Button variant="primary" type="submit" fullWidth>
						<LogOut class="h-4 w-4" />
						ออกจากระบบ (Sign out)
					</Button>
				</form>
			{/if}
		</div>
	</div>
</div>
