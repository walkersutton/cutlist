<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { csvToHtmlTable } from './csv.js';

	let {
		title,
		summary,
		csv,
		fileName,
		ondownload,
		onclose
	}: {
		title: string;
		/** e.g. "4 panels · inches" */
		summary: string;
		csv: string;
		fileName: string;
		ondownload: () => void;
		onclose: () => void;
	} = $props();

	let copied = $state(false);
	/** Set when the browser refuses clipboard access: the text is selected for a manual copy. */
	let copyFailed = $state(false);
	let textarea = $state<HTMLTextAreaElement>();
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	let pressedBackdrop = false;

	async function writeClipboard() {
		try {
			// Spreadsheets paste the HTML table into cells; text fields get the CSV.
			await navigator.clipboard.write([
				new ClipboardItem({
					'text/plain': new Blob([csv], { type: 'text/plain' }),
					'text/html': new Blob([csvToHtmlTable(csv)], { type: 'text/html' })
				})
			]);
		} catch {
			await navigator.clipboard.writeText(csv);
		}
	}

	async function copy() {
		try {
			// Some embedded browsers leave a clipboard write pending forever instead of refusing it.
			await Promise.race([
				writeClipboard(),
				new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
			]);
		} catch {
			copyFailed = true;
			textarea?.focus();
			textarea?.select();
			return;
		}
		copyFailed = false;
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1600);
	}

	const copyKeys = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘C' : 'Ctrl+C';
	const lines = $derived(csv.trimEnd().split('\n').length);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
	class="fixed inset-0 z-40 bg-black/40"
	transition:fade={{ duration: 200 }}
	onpointerdown={(e) => (pressedBackdrop = e.target === e.currentTarget)}
	onclick={() => pressedBackdrop && onclose()}
	role="presentation"
></div>
<div
	class="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-xl sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:w-[34rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
	transition:fly={{ y: 40, duration: 240, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-labelledby="csv-export-title"
>
	<div class="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
		<div class="min-w-0">
			<h2 id="csv-export-title" class="text-[15px] font-semibold tracking-tight text-zinc-900">
				{title}
			</h2>
			<p class="truncate text-xs text-zinc-500">{summary}</p>
		</div>
		<button
			onclick={onclose}
			aria-label="Close"
			class="press -mr-1.5 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
				><path d="M4 4l8 8M12 4l-8 8" stroke-width="1.7" stroke-linecap="round" /></svg
			>
		</button>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
		<textarea
			bind:this={textarea}
			readonly
			value={csv}
			rows={Math.min(Math.max(lines, 4), 12)}
			wrap="off"
			spellcheck="false"
			aria-label="CSV text"
			onfocus={(e) => e.currentTarget.select()}
			class="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-base leading-relaxed text-zinc-800 focus:border-zinc-400 focus:outline-none sm:text-[13px]"
		></textarea>
		<p class="mt-1.5 text-xs {copyFailed ? 'text-amber-700' : 'text-zinc-500'}">
			{#if copyFailed}
				Your browser blocked copying. The text is selected: press {copyKeys} to copy it.
			{:else}
				Paste into a spreadsheet, or into Import CSV in another plan.
			{/if}
		</p>
	</div>

	<div
		class="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3"
	>
		<button
			onclick={ondownload}
			title={fileName}
			class="press mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M8 3v7M5 7l3 3 3-3" /><path d="M3 11v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" /></svg
			>
			Download .csv
		</button>
		<button
			onclick={copy}
			class="press grid min-w-[5.5rem] rounded-lg bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zinc-800"
		>
			<!-- Both labels share one grid cell so the button never changes width -->
			<span
				class="col-start-1 row-start-1 transition-[opacity,filter] duration-200 {copied
					? 'opacity-0 blur-[2px]'
					: ''}">Copy</span
			>
			<span
				class="col-start-1 row-start-1 transition-[opacity,filter] duration-200 {copied
					? ''
					: 'opacity-0 blur-[2px]'}"
				aria-hidden="true">✓ Copied</span
			>
			<span class="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
		</button>
	</div>
</div>
