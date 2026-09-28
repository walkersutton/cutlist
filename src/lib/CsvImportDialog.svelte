<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		guessUnit,
		parseCsv,
		rowsToParts,
		rowsToStock,
		type CsvImport,
		type CsvKind,
		type CsvParseResult
	} from './csv.js';
	import { stockName } from './stock.js';
	import type { Unit } from './plans.js';

	let {
		unit,
		target: initialTarget,
		stockLabel,
		onimport,
		onclose
	}: {
		/** The app's current unit; imported values are converted into it. */
		unit: Unit;
		/** Where the importer was opened from. */
		target: CsvKind;
		/** "My shop stock" or "This plan's stock": whichever stock an import would change. */
		stockLabel: string;
		onimport: (result: CsvImport) => void;
		onclose: () => void;
	} = $props();

	let source = $state<{ name: string; text: string } | null>(null);
	let pasted = $state('');
	let error = $state<string | null>(null);
	let dragging = $state(false);
	// Only a press that starts on the backdrop dismisses: not a text drag that ends there, nor a
	// click whose button moved away as the dialog resized.
	let pressedBackdrop = false;
	let target = $state<CsvKind>(untrack(() => initialTarget)); // only the opening context matters
	let fileUnit = $state<Unit>('in');
	/** Why fileUnit starts where it does: named in the file, or guessed from the sizes. */
	let unitSource = $state<'file' | 'guess' | null>(null);
	let replace = $state(false);
	let fileInput = $state<HTMLInputElement>();

	const parsed = $derived<CsvParseResult | null>(source ? parseCsv(source.text) : null);
	const parts = $derived(parsed ? rowsToParts(parsed.rows, fileUnit, unit) : null);
	const stock = $derived(parsed ? rowsToStock(parsed.rows, fileUnit, unit) : null);
	const count = $derived(parsed?.rows.length ?? 0);

	function load(name: string, text: string) {
		const result = parseCsv(text);
		if (!result.rows.length) {
			error = result.skipped
				? `None of the ${result.skipped} rows had a width × height or a length.`
				: 'That file is empty.';
			return;
		}
		error = null;
		source = { name, text };
		unitSource = result.unit ? 'file' : guessUnit(result.rows) ? 'guess' : null;
		fileUnit = result.unit ?? guessUnit(result.rows) ?? unit;
	}

	async function loadFile(file: File | undefined) {
		if (!file) return;
		try {
			load(file.name, await file.text());
		} catch {
			error = 'Could not read that file.';
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function submit() {
		if (!parsed || !count) return;
		onimport(
			target === 'parts'
				? { kind: 'parts', replace, data: parts! }
				: { kind: 'stock', replace, data: stock! }
		);
	}

	const u = $derived(unit === 'in' ? '″' : ' mm');
	const seg =
		'rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-zinc-400';
	const segOn = 'bg-white text-zinc-900 shadow-sm';
	const segOff = 'text-zinc-500 hover:text-zinc-800';
	const PREVIEW_ROWS = 6;
	const PASTE_EXAMPLE = 'Label, Width, Height, Qty\nSide, 23.25, 30, 2\nShelf, 22 1/2, 11 3/4, 3';

	/** Rows as they'll appear after import, in the app's unit. */
	const previewRows = $derived.by(() => {
		if (!parts || !stock) return [];
		if (target === 'parts')
			return [
				...parts.panels.map((p) => ({
					name: p.label || '—',
					size: `${p.width} × ${p.height}${u}`,
					qty: String(p.quantity),
					detail: stockName({ id: '', ...p }, unit)
				})),
				...parts.pieces.map((p) => ({
					name: p.label || '—',
					size: `${p.length}${u}`,
					qty: String(p.quantity),
					detail: p.material ?? ''
				}))
			];
		return [
			...stock.sheetTypes.map((s) => ({
				name: stockName({ id: '', ...s }, unit) || 'Sheet',
				size: `${s.width} × ${s.height}${u}`,
				qty: s.quantity ? String(s.quantity) : '∞',
				detail: ''
			})),
			...stock.linearStocks.map((s) => ({
				name: s.material || 'Linear',
				size: `${s.length}${u}`,
				qty: s.quantity ? String(s.quantity) : '∞',
				detail: ''
			}))
		];
	});

	const summary = $derived.by(() => {
		if (!parts || !stock || !parsed) return '';
		const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
		const bits =
			target === 'parts'
				? [
						parts.panels.length && plural(parts.panels.length, 'panel'),
						parts.pieces.length && plural(parts.pieces.length, 'linear piece')
					]
				: [
						stock.sheetTypes.length && plural(stock.sheetTypes.length, 'sheet size'),
						stock.linearStocks.length && plural(stock.linearStocks.length, 'linear stock')
					];
		if (parsed.skipped) bits.push(`${plural(parsed.skipped, 'row')} skipped`);
		return bits.filter(Boolean).join(' · ');
	});
</script>

<svelte:window onkeydown={onKey} />

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
	aria-labelledby="csv-import-title"
>
	<div class="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
		<div class="min-w-0">
			<h2 id="csv-import-title" class="text-[15px] font-semibold tracking-tight text-zinc-900">
				Import CSV
			</h2>
			{#if source}
				<p class="truncate text-xs text-zinc-500">{source.name}</p>
			{/if}
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
		{#if !source}
			<input
				bind:this={fileInput}
				type="file"
				accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
				class="hidden"
				onchange={(e) => {
					const el = e.currentTarget;
					loadFile(el.files?.[0]);
					el.value = '';
				}}
			/>
			<button
				onclick={() => fileInput?.click()}
				ondragover={(e) => {
					e.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragging = false;
					loadFile(e.dataTransfer?.files[0]);
				}}
				class="press flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-7 text-center transition-colors {dragging
					? 'border-zinc-500 bg-zinc-50'
					: 'border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50'}"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-zinc-400"
					aria-hidden="true"
					><path d="M8 10V3M5 6l3-3 3 3" /><path
						d="M3 10v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"
					/></svg
				>
				<span class="text-sm font-medium text-zinc-800">Choose a CSV file</span>
				<span class="hidden text-xs text-zinc-500 sm:block">or drop it here</span>
			</button>

			<div class="my-4 flex items-center gap-3 text-[11px] font-medium text-zinc-400 uppercase">
				<span class="h-px flex-1 bg-zinc-100"></span>or paste rows<span
					class="h-px flex-1 bg-zinc-100"
				></span>
			</div>
			<textarea
				bind:value={pasted}
				rows="5"
				placeholder={PASTE_EXAMPLE}
				class="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none sm:text-[13px]"
			></textarea>
			<p class="mt-1.5 text-xs text-zinc-500">
				Copy cells straight from a spreadsheet. Columns are matched by name: label, width, height,
				length, qty, grain, material, thickness.
			</p>
			{#if error}
				<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
					{error}
				</p>
			{/if}
		{:else if parsed}
			<div class="space-y-3.5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-[13px] text-zinc-600">Import as</span>
					<div
						class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
					>
						<button
							class="{seg} {target === 'parts' ? segOn : segOff}"
							onclick={() => (target = 'parts')}>Plan parts</button
						>
						<button
							class="{seg} {target === 'stock' ? segOn : segOff}"
							onclick={() => (target = 'stock')}>{stockLabel}</button
						>
					</div>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-[13px] text-zinc-600">
						Values are in
						{#if unitSource === 'file'}<span class="text-zinc-400">(from the file)</span
							>{:else if unitSource === 'guess'}<span class="text-zinc-400">(guessed)</span>{/if}
					</span>
					<div
						class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
					>
						<button
							class="{seg} {fileUnit === 'in' ? segOn : segOff}"
							onclick={() => (fileUnit = 'in')}>inches</button
						>
						<button
							class="{seg} {fileUnit === 'mm' ? segOn : segOff}"
							onclick={() => (fileUnit = 'mm')}>mm</button
						>
					</div>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-[13px] text-zinc-600"
						>Existing {target === 'parts' ? 'parts' : 'stock'}</span
					>
					<div
						class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
					>
						<button class="{seg} {!replace ? segOn : segOff}" onclick={() => (replace = false)}
							>Keep, add these</button
						>
						<button class="{seg} {replace ? segOn : segOff}" onclick={() => (replace = true)}
							>Replace</button
						>
					</div>
				</div>

				<div class="rounded-xl border border-zinc-200">
					<div
						class="flex items-baseline justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-xs"
					>
						<span class="font-medium text-zinc-700">{summary}</span>
						{#if fileUnit !== unit}
							<span class="shrink-0 text-zinc-400"
								>converted to {unit === 'in' ? 'inches' : 'mm'}</span
							>
						{/if}
					</div>
					<ul class="text-[13px]">
						{#each previewRows.slice(0, PREVIEW_ROWS) as r, i (i)}
							<li
								class="flex items-baseline gap-3 border-b border-zinc-50 px-3 py-1.5 last:border-0"
							>
								<span class="min-w-0 flex-1 truncate text-zinc-900">
									{r.name}{#if r.detail}<span class="ml-1 text-zinc-400">· {r.detail}</span>{/if}
								</span>
								<span class="shrink-0 text-zinc-600 tabular-nums">{r.size}</span>
								<span class="w-9 shrink-0 text-right text-zinc-500 tabular-nums"
									>{r.qty === '∞' ? '∞' : `×${r.qty}`}</span
								>
							</li>
						{/each}
					</ul>
					{#if previewRows.length > PREVIEW_ROWS}
						<p class="border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-400">
							and {previewRows.length - PREVIEW_ROWS} more
						</p>
					{/if}
				</div>
				{#if parsed.headerless}
					<p class="text-xs text-zinc-500">
						No header row found, so columns were read as label, width, height, qty.
					</p>
				{/if}
			</div>
		{/if}
	</div>

	<div
		class="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3"
	>
		{#if source}
			<button
				onclick={() => (source = null)}
				class="press mr-auto rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
				>Back</button
			>
		{/if}
		<button
			onclick={onclose}
			class="press rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100"
			>Cancel</button
		>
		{#if source}
			<button
				onclick={submit}
				class="press rounded-lg bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zinc-800"
			>
				{replace ? 'Replace with' : 'Add'}
				{count} row{count === 1 ? '' : 's'}
			</button>
		{:else}
			<button
				onclick={() => load('Pasted rows', pasted)}
				disabled={!pasted.trim()}
				class="press rounded-lg bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400"
				>Continue</button
			>
		{/if}
	</div>
</div>
