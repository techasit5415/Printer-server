<script lang="ts">
	/**
	 * Status pill — token-driven. Covers the four `print_jobs` statuses
	 * (`pending` | `processing` | `completed` | `failed`) plus the
	 * lease `pending` / `completed` statuses from `$lib/types`. The
	 * labels render in Thai to match the rest of the UI.
	 */
	import {
		AlertCircle,
		CheckCircle2,
		CircleDashed,
		Hourglass
	} from '@lucide/svelte';
	import type { LeaseStatus } from '$lib/types';

	/** Accepts either the lease status or the wider print_jobs status set. */
	type Status = LeaseStatus | 'processing' | 'failed';

	interface Props {
		status: Status;
		class?: string;
	}

	let { status, class: extraClass = '' }: Props = $props();

	// Each status maps to { icon, label (Thai), chip class, icon colour class }.
	const config: Record<
		Status,
		{ Icon: typeof CircleDashed; label: string; chip: string; iconCls: string }
	> = {
		pending: {
			Icon: CircleDashed,
			label: 'รอดำเนินการ',
			chip: 'border-warning/30 bg-warning/10 text-warning',
			iconCls: 'text-warning'
		},
		processing: {
			Icon: Hourglass,
			label: 'กำลังพิมพ์',
			chip: 'border-accent/30 bg-accent-soft text-accent',
			iconCls: 'text-accent'
		},
		completed: {
			Icon: CheckCircle2,
			label: 'สำเร็จ',
			chip: 'border-success/30 bg-success/10 text-success',
			iconCls: 'text-success'
		},
		failed: {
			Icon: AlertCircle,
			label: 'ล้มเหลว',
			chip: 'border-danger/30 bg-danger/10 text-danger',
			iconCls: 'text-danger'
		}
	};

	let { Icon, label, chip, iconCls } = $derived(config[status]);
</script>

<span
	class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${chip} ${extraClass}`}
>
	<Icon class={`h-3 w-3 ${iconCls}`} />
	{label}
</span>