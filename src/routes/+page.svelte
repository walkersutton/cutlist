<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { pack, type PanelInput, type SheetType } from '$lib/packer.js';
	import { packLinear, type LinearStock, type LinearPiece } from '$lib/linear-packer.js';

	const STORAGE_KEY = 'cutlist_v1';

	function load<T>(key: string, fallback: T): T {
		try {
			const raw = localStorage.getItem(key);
			if (raw) return JSON.parse(raw) as T;
		} catch {
			/* ignore */
		}
		return fallback;
	}

	// Restore persisted state (falls back to defaults if nothing saved yet)
	const saved = load<Record<string, unknown>>(STORAGE_KEY, {});

	let nextId = 1;
	function uid() {
		return String(nextId++);
	}

	// Re-seed nextId so new items never collide with restored IDs
	function maxIdFrom(...arrays: Array<{ id: string }[]>) {
		let max = 0;
		for (const arr of arrays) {
			for (const item of arr) {
				const n = parseInt(item.id, 10);
				if (!isNaN(n) && n > max) max = n;
			}
		}
		return max;
	}

	let mode = $state<'sheet' | 'linear'>((saved.mode as 'sheet' | 'linear') ?? 'sheet');
	let unit = $state<'in' | 'mm'>((saved.unit as 'in' | 'mm') ?? 'in');
	const unitLabel = $derived(unit === 'in' ? '"' : ' mm');
	const dimStep = $derived(unit === 'in' ? 0.125 : 1);
	const dimMin = $derived(unit === 'in' ? 0.125 : 1);

	function setUnit(to: 'in' | 'mm') {
		if (to === unit) return;
		const factor = to === 'mm' ? 25.4 : 1 / 25.4;
		for (const st of sheetTypes) {
			st.width =
				to === 'mm' ? Math.round(st.width * factor) : Math.round(st.width * factor * 8) / 8;
			st.height =
				to === 'mm' ? Math.round(st.height * factor) : Math.round(st.height * factor * 8) / 8;
		}
		for (const p of panels) {
			p.width = to === 'mm' ? Math.round(p.width * factor) : Math.round(p.width * factor * 8) / 8;
			p.height =
				to === 'mm' ? Math.round(p.height * factor) : Math.round(p.height * factor * 8) / 8;
		}
		for (const ls of linearStocks) {
			ls.length =
				to === 'mm' ? Math.round(ls.length * factor) : Math.round(ls.length * factor * 8) / 8;
		}
		for (const lp of linearPieces) {
			lp.length =
				to === 'mm' ? Math.round(lp.length * factor) : Math.round(lp.length * factor * 8) / 8;
		}
		kerf = to === 'mm' ? Math.round(kerf * factor * 10) / 10 : Math.round(kerf * factor * 8) / 8;
		unit = to;
	}

	let kerf = $state<number>((saved.kerf as number) ?? 0.125);
	let settingsOpen = $state(false);

	$effect(() => {
		if (settingsOpen) {
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	});

	let linearStocks = $state<LinearStock[]>(
		(saved.linearStocks as LinearStock[]) ?? [{ id: uid(), length: 96, quantity: 0 }]
	);
	let linearPieces = $state<LinearPiece[]>((saved.linearPieces as LinearPiece[]) ?? []);

	function addLinearStock() {
		linearStocks = [...linearStocks, { id: uid(), length: unit === 'mm' ? 2440 : 96, quantity: 0 }];
	}
	function removeLinearStock(id: string) {
		linearStocks = linearStocks.filter((s) => s.id !== id);
	}
	function addLinearPiece() {
		linearPieces = [
			...linearPieces,
			{ id: uid(), label: '', length: unit === 'mm' ? 300 : 24, quantity: 1 }
		];
	}
	function removeLinearPiece(id: string) {
		linearPieces = linearPieces.filter((p) => p.id !== id);
	}

	let linearPackResult = $derived(packLinear(linearStocks, linearPieces, kerf));
	let linearBoards = $derived(linearPackResult.boards);
	let linearUnplaced = $derived(
		(() => {
			const map: Record<string, { label: string; count: number; reason: string }> = {};
			for (const { piece, reason } of linearPackResult.unplaced) {
				const key = `${piece.id}:${reason}`;
				const e = map[key];
				if (e) e.count++;
				else
					map[key] = {
						label: piece.label || piece.length + (unit === 'mm' ? ' mm' : '"'),
						count: 1,
						reason
					};
			}
			return Object.values(map);
		})()
	);

	let linearSummary = $derived(
		(() => {
			const map: Record<number, { length: number; count: number }> = {};
			for (const b of linearBoards) {
				const e = map[b.stockLength];
				if (e) e.count++;
				else map[b.stockLength] = { length: b.stockLength, count: 1 };
			}
			return Object.values(map);
		})()
	);

	const LINEAR_BAR_W = 560;
	let linearScale = $derived(
		linearBoards.length > 0 ? LINEAR_BAR_W / Math.max(...linearBoards.map((b) => b.stockLength)) : 1
	);

	function pieceColor(id: string): string {
		const idx = linearPieces.findIndex((p) => p.id === id);
		return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
	}

	let sheetTypes = $state<SheetType[]>(
		(saved.sheetTypes as SheetType[]) ?? [
			{ id: uid(), width: 48, height: 96, quantity: 0, grain: 'vertical' }
		]
	);
	let panels = $state<PanelInput[]>((saved.panels as PanelInput[]) ?? []);

	// Seed nextId past all restored IDs so new items never collide
	nextId = maxIdFrom(sheetTypes, panels, linearStocks, linearPieces) + 1;

	function addSheetType() {
		const d = unit === 'mm' ? { w: 1220, h: 2440 } : { w: 48, h: 96 };
		sheetTypes = [
			...sheetTypes,
			{ id: uid(), width: d.w, height: d.h, quantity: 0, grain: 'vertical' }
		];
	}
	function removeSheetType(id: string) {
		sheetTypes = sheetTypes.filter((s) => s.id !== id);
	}

	function addPanel() {
		const d = unit === 'mm' ? { w: 300, h: 600 } : { w: 24, h: 24 };
		panels = [
			...panels,
			{ id: uid(), label: '', width: d.w, height: d.h, quantity: 1, grain: 'any' }
		];
	}
	function removePanel(id: string) {
		panels = panels.filter((p) => p.id !== id);
	}

	let packResult = $derived(pack(sheetTypes, panels, kerf));
	let sheets = $derived(packResult.sheets);
	let sheetUnplaced = $derived(
		(() => {
			const map: Record<string, { label: string; count: number; reason: string }> = {};
			for (const { panel, reason } of packResult.unplaced) {
				const key = `${panel.id}:${reason}`;
				const e = map[key];
				if (e) e.count++;
				else
					map[key] = { label: panel.label || `${panel.width}×${panel.height}`, count: 1, reason };
			}
			return Object.values(map);
		})()
	);

	let sheetSummary = $derived(
		(() => {
			const map: Record<string, { w: number; h: number; count: number }> = {};
			for (const s of sheets) {
				const key = `${s.sheetWidth}×${s.sheetHeight}`;
				const e = map[key];
				if (e) e.count++;
				else map[key] = { w: s.sheetWidth, h: s.sheetHeight, count: 1 };
			}
			return Object.values(map);
		})()
	);

	const SVG_MAX = 400;
	function svgScale(w: number, h: number) {
		return Math.min(SVG_MAX / w, SVG_MAX / h);
	}

	const PALETTE = [
		'#93c5fd',
		'#86efac',
		'#fcd34d',
		'#f9a8d4',
		'#a5b4fc',
		'#6ee7b7',
		'#fca5a5',
		'#fdba74',
		'#c4b5fd',
		'#67e8f9'
	];
	function panelColor(id: string): string {
		const idx = panels.findIndex((p) => p.id === id);
		return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
	}

	const inputCls =
		'w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg bg-white text-zinc-900 placeholder:text-zinc-400';
	const numCls =
		'w-full px-2.5 py-1.5 text-sm text-right border border-zinc-200 rounded-lg bg-white text-zinc-900';
	const smNumCls =
		'w-24 px-2 py-1.5 text-sm text-right border border-zinc-200 rounded-lg bg-white text-zinc-900';
	const addBtnCls =
		'mt-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-900';
	const delCls =
		'del flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 sm:h-7 sm:w-7';

	// Persist all state to localStorage whenever anything changes
	$effect(() => {
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ mode, unit, kerf, sheetTypes, panels, linearStocks, linearPieces })
			);
		} catch {
			/* ignore */
		}
	});

	function parseMeasurement(s: string): number | null {
		s = s.trim();
		const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
		if (frac) {
			const den = parseInt(frac[2], 10);
			return den === 0 ? null : parseInt(frac[1], 10) / den;
		}
		const n = parseFloat(s);
		return isNaN(n) ? null : n;
	}

	function applyKerf(e: Event) {
		const el = e.target as HTMLInputElement;
		const v = parseMeasurement(el.value);
		if (v !== null && v >= 0) kerf = v;
		el.value = String(kerf);
	}

	function reset() {
		if (!confirm('Reset everything? This will clear all sheets, panels, and cuts.')) return;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* ignore */
		}
		sheetTypes = [{ id: uid(), width: 48, height: 96, quantity: 0, grain: 'vertical' }];
		panels = [];
		linearStocks = [{ id: uid(), length: 96, quantity: 0 }];
		linearPieces = [];
		kerf = 0.125;
		mode = 'sheet';
		unit = 'in';
	}
</script>

<svelte:head>
	<title>Cut List Tool — Free 1D & 2D Cut List Optimizer</title>
	<meta
		name="description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D). Supports kerf, grain direction, inches, and millimeters."
	/>
	<meta
		name="keywords"
		content="cut list, cut list optimizer, plywood cut list, lumber cut list, woodworking tool, 2d packing, linear packing"
	/>
	<link rel="canonical" href="https://cutlist.walkersutton.com" />

	<!-- Structured Data -->
	<script type="application/ld+json">
		{
			"@context": "https://schema.org",
			"@type": "WebApplication",
			"name": "Cut List Tool",
			"url": "https://cutlist.walkersutton.com",
			"description": "Free online cut list optimizer for sheet goods (2D) and linear stock (1D).",
			"applicationCategory": "Tool",
			"operatingSystem": "All"
		}
	</script>

	<!-- Open Graph -->
	<meta property="og:title" content="Cut List Tool — Free 1D & 2D Cut List Optimizer" />
	<meta
		property="og:description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D). Supports kerf, grain direction, inches, and millimeters."
	/>
	<meta property="og:url" content="https://cutlist.walkersutton.com" />

	<!-- Twitter Card -->
	<meta name="twitter:title" content="Cut List Tool — Free 1D & 2D Cut List Optimizer" />
	<meta
		name="twitter:description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D). Supports kerf, grain direction, inches, and millimeters."
	/>
</svelte:head>

<div class="flex min-h-screen flex-col bg-white">
	<div class="mx-auto w-full max-w-3xl flex-1 px-6 lg:px-8">
		<!-- Header -->
		<header class="flex h-14 items-center justify-between border-b border-zinc-100">
			<div class="flex items-center gap-1">
				<img src="/logo.jpg" alt="cutlist logo" class="h-8 w-8" />
				<h1 class="shrink-0 text-xl font-semibold tracking-tight text-zinc-900">cutlist</h1>
			</div>
			<div class="flex items-center gap-3">
				<!-- Mobile settings button -->
				<button
					onclick={() => (settingsOpen = true)}
					class="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 sm:hidden"
					aria-label="Open settings"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 14 14"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<line x1="1" y1="3.5" x2="13" y2="3.5" />
						<line x1="1" y1="7" x2="13" y2="7" />
						<line x1="1" y1="10.5" x2="13" y2="10.5" />
						<circle cx="4.5" cy="3.5" r="1.5" fill="white" />
						<circle cx="9.5" cy="7" r="1.5" fill="white" />
						<circle cx="6" cy="10.5" r="1.5" fill="white" />
					</svg>
					{mode === 'sheet' ? 'Sheet' : 'Linear'} · {unit}
				</button>
			</div>
		</header>

		<!-- Desktop toolbar -->
		<div class="hidden items-center gap-2 border-b border-zinc-100 py-2 sm:flex">
			<!-- Toggle groups -->
			<div
				class="flex items-center gap-0.5 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-zinc-200/60"
			>
				<button
					onclick={() => (mode = 'sheet')}
					class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${mode === 'sheet' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-700'}`}
					>Sheet</button
				>
				<button
					onclick={() => (mode = 'linear')}
					class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${mode === 'linear' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-700'}`}
					>Linear</button
				>
			</div>
			<div
				class="flex items-center gap-0.5 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-zinc-200/60"
			>
				<button
					onclick={() => setUnit('in')}
					class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${unit === 'in' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-700'}`}
					>in</button
				>
				<button
					onclick={() => setUnit('mm')}
					class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${unit === 'mm' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-700'}`}
					>mm</button
				>
			</div>

			<!-- Divider -->
			<div class="mx-1 h-4 w-px bg-zinc-200"></div>

			<!-- Kerf -->
			<label class="flex items-center gap-1.5 text-xs text-zinc-500">
				kerf
				<input type="text" inputmode="decimal" class={smNumCls} value={kerf} onchange={applyKerf} />
				<span>{unit}</span>
			</label>

			<!-- Reset (pushed right) -->
			<button
				onclick={reset}
				class="ml-auto flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-red-500"
				aria-label="Reset all data"
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 11 11"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path
						d="M1.5 3h8M3.5 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M4.5 5.5v3M6.5 5.5v3M2 3l.6 6.1A1 1 0 0 0 3.6 10h3.8a1 1 0 0 0 1-.9L9 3"
					/>
				</svg>
				Reset
			</button>
		</div>

		{#if mode === 'sheet'}
			<div class="space-y-8 py-8">
				<!-- Sheet Stock -->
				<section>
					<p class="mb-3 text-sm font-semibold text-zinc-800">Sheet Stock</p>
					<div class="mb-2 grid grid-cols-[1fr_1fr_1fr_1fr_2.5rem] gap-2 text-xs text-zinc-500">
						<span>Width ({unit})</span>
						<span>Height ({unit})</span>
						<span>Qty (blank = ∞)</span>
						<span>Grain</span>
						<span></span>
					</div>
					{#each sheetTypes as st (st.id)}
						<div class="row mb-1 grid grid-cols-[1fr_1fr_1fr_1fr_2.5rem] items-center gap-2">
							<input
								type="number"
								class={numCls}
								min={dimMin}
								step={dimStep}
								bind:value={st.width}
							/>
							<input
								type="number"
								class={numCls}
								min={dimMin}
								step={dimStep}
								bind:value={st.height}
							/>
							<input
								type="number"
								class={numCls}
								min="0"
								placeholder="∞"
								value={st.quantity || ''}
								oninput={(e) => {
									st.quantity = Number((e.target as HTMLInputElement).value) || 0;
								}}
							/>
							<select class={inputCls} bind:value={st.grain}>
								<option value="horizontal">Horiz →</option>
								<option value="vertical">Vert ↑</option>
							</select>
							<button onclick={() => removeSheetType(st.id)} class={delCls}>×</button>
						</div>
					{/each}
					<button onclick={addSheetType} class={addBtnCls}>+ Add sheet size</button>
				</section>

				<!-- Panels -->
				<section>
					<p class="mb-3 text-sm font-semibold text-zinc-800">Panels</p>
					{#if panels.length > 0}
						<!-- Column headers: desktop only -->
						<div
							class="mb-2 hidden gap-2 text-xs text-zinc-500 sm:grid sm:grid-cols-[minmax(0,1.5fr)_1fr_1fr_3.5rem_1fr_2.5rem]"
						>
							<span>Label</span>
							<span>Width ({unit})</span>
							<span>Height ({unit})</span>
							<span>Qty</span>
							<span>Grain</span>
							<span></span>
						</div>
						{#each panels as panel (panel.id)}
							<!--
							Mobile:  [● label ..................... ×]
							         [width] [height] [qty] [grain]
							Desktop: [● label] [width] [height] [qty] [grain] [×]  (6-col grid)
						-->
							<div
								class="row mb-3 sm:mb-1 sm:grid sm:grid-cols-[minmax(0,1.5fr)_1fr_1fr_3.5rem_1fr_2.5rem] sm:items-center sm:gap-2"
							>
								<!-- Label row (flex on mobile, first grid cell on desktop) -->
								<div class="mb-1.5 flex items-center gap-2 sm:mb-0">
									<span
										class="h-2 w-2 shrink-0 rounded-full"
										style="background:{panelColor(panel.id)}"
									></span>
									<input
										type="text"
										class="{inputCls} flex-1"
										placeholder="Label"
										bind:value={panel.label}
									/>
									<!-- Delete: mobile only (inline with label) -->
									<button onclick={() => removePanel(panel.id)} class="{delCls} sm:hidden">×</button
									>
								</div>
								<!-- Dimensions: 4-col grid on mobile, sm:contents makes them grid cells on desktop -->
								<div class="grid grid-cols-4 gap-1.5 sm:contents">
									<input
										type="number"
										class={numCls}
										min={dimMin}
										step={dimStep}
										bind:value={panel.width}
									/>
									<input
										type="number"
										class={numCls}
										min={dimMin}
										step={dimStep}
										bind:value={panel.height}
									/>
									<input type="number" class={numCls} min="1" bind:value={panel.quantity} />
									<select class={inputCls} bind:value={panel.grain}>
										<option value="any">Any</option>
										<option value="horizontal">Horiz →</option>
										<option value="vertical">Vert ↑</option>
									</select>
								</div>
								<!-- Delete: desktop only (last grid column) -->
								<button onclick={() => removePanel(panel.id)} class="{delCls} hidden sm:flex"
									>×</button
								>
							</div>
						{/each}
					{/if}
					<button onclick={addPanel} class={addBtnCls}>+ Add panel</button>
				</section>

				<!-- Unplaced panels warning -->
				{#if sheetUnplaced.length > 0}
					<section>
						<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
							<p class="mb-2 text-xs font-semibold text-amber-800">Could not place all panels</p>
							<ul class="space-y-1">
								{#each sheetUnplaced as item (item.label + item.reason)}
									<li class="text-xs text-amber-700">
										{item.count > 1 ? `${item.count}×` : ''} "{item.label}" —
										{item.reason === 'too_large'
											? 'too large to fit in any sheet'
											: 'not enough stock sheets available'}
									</li>
								{/each}
							</ul>
						</div>
					</section>
				{/if}

				<!-- Results -->
				{#if sheets.length > 0}
					<section>
						<p class="mb-3 text-sm font-semibold text-zinc-800">Results</p>
						<div class="mb-8 flex flex-wrap gap-2">
							{#each sheetSummary as row (`${row.w}×${row.h}`)}
								<div
									class="flex items-baseline gap-1.5 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2"
								>
									<span class="text-xl font-semibold text-zinc-900 tabular-nums">{row.count}</span>
									<span class="text-xs text-zinc-600">× {row.w}×{row.h}{unitLabel}</span>
								</div>
							{/each}
						</div>
						<div class="flex flex-wrap gap-4">
							{#each sheets as sheet (sheet.index)}
								{@const sc = svgScale(sheet.sheetWidth, sheet.sheetHeight)}
								{@const svgW = sheet.sheetWidth * sc}
								{@const svgH = sheet.sheetHeight * sc}
								{@const sheetIsHoriz = sheet.grain === 'horizontal'}
								{@const grainSpan = sheetIsHoriz ? svgH : svgW}
								{@const grainCount = Math.max(1, Math.floor(grainSpan / 14) - 1)}
								<div class="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
									<p class="mb-2 text-xs text-zinc-600">
										Sheet {sheet.index + 1} · {sheet.sheetWidth}×{sheet.sheetHeight}{unitLabel}
									</p>
									<svg
										width={svgW}
										height={svgH}
										style="display:block;border-radius:8px;overflow:hidden"
									>
										<rect width={svgW} height={svgH} fill="#f4f4f5" />
										{#each [...Array(grainCount).keys()] as i (i)}
											{@const offset = (i + 1) * (grainSpan / (grainCount + 1))}
											{#if sheetIsHoriz}
												<line
													x1={3}
													y1={offset}
													x2={svgW - 3}
													y2={offset}
													stroke="#a1a1aa"
													stroke-width="0.6"
													opacity="0.5"
												/>
											{:else}
												<line
													x1={offset}
													y1={3}
													x2={offset}
													y2={svgH - 3}
													stroke="#a1a1aa"
													stroke-width="0.6"
													opacity="0.5"
												/>
											{/if}
										{/each}
										{#each sheet.placements as p (`${p.panelId}-${p.x}-${p.y}`)}
											{@const px = p.x * sc}
											{@const py = p.y * sc}
											{@const pw = p.width * sc}
											{@const ph = p.height * sc}
											<rect
												x={px}
												y={py}
												width={pw}
												height={ph}
												fill={panelColor(p.panelId)}
												rx="2"
											/>
											{#if p.grain !== 'any' && pw > 8 && ph > 8}
												{@const effectiveGrain = p.rotated
													? p.grain === 'horizontal'
														? 'vertical'
														: 'horizontal'
													: p.grain}
												{@const isHoriz = effectiveGrain === 'horizontal'}
												{@const span = isHoriz ? ph : pw}
												{@const count = Math.max(1, Math.floor(span / 10) - 1)}
												{#each [...Array(count).keys()] as i (i)}
													{@const offset = (i + 1) * (span / (count + 1))}
													{#if isHoriz}
														<line
															x1={px + 4}
															y1={py + offset}
															x2={px + pw - 4}
															y2={py + offset}
															stroke="#1e3a5f"
															stroke-width="0.75"
															opacity="0.2"
														/>
													{:else}
														<line
															x1={px + offset}
															y1={py + 4}
															x2={px + offset}
															y2={py + ph - 4}
															stroke="#1e3a5f"
															stroke-width="0.75"
															opacity="0.2"
														/>
													{/if}
												{/each}
											{/if}
											{#if pw > 24 && ph > 12}
												<text
													x={px + pw / 2}
													y={py + ph / 2}
													text-anchor="middle"
													dominant-baseline="middle"
													font-size={Math.min(11, pw / 4, ph / 2)}
													fill="#18181b"
													font-family="system-ui,sans-serif"
													font-weight="500">{p.label || '?'}{p.rotated ? ' ↺' : ''}</text
												>
											{/if}
										{/each}
									</svg>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		{/if}

		{#if mode === 'linear'}
			<div class="space-y-8 py-8">
				<!-- Linear Stock -->
				<section>
					<p class="mb-3 text-sm font-semibold text-zinc-800">Stock</p>
					<div class="mb-2 grid grid-cols-[1fr_1fr_2.5rem] gap-2 text-xs text-zinc-500">
						<span>Length ({unit})</span>
						<span>Qty (blank = ∞)</span>
						<span></span>
					</div>
					{#each linearStocks as ls (ls.id)}
						<div class="row mb-1 grid grid-cols-[1fr_1fr_2.5rem] items-center gap-2">
							<input
								type="number"
								class={numCls}
								min={dimMin}
								step={dimStep}
								bind:value={ls.length}
							/>
							<input
								type="number"
								class={numCls}
								min="0"
								placeholder="∞"
								value={ls.quantity || ''}
								oninput={(e) => {
									ls.quantity = Number((e.target as HTMLInputElement).value) || 0;
								}}
							/>
							<button onclick={() => removeLinearStock(ls.id)} class={delCls}>×</button>
						</div>
					{/each}
					<button onclick={addLinearStock} class={addBtnCls}>+ Add stock length</button>
				</section>

				<!-- Linear Pieces -->
				<section>
					<p class="mb-3 text-sm font-semibold text-zinc-800">Cut List</p>
					{#if linearPieces.length > 0}
						<div
							class="mb-2 grid grid-cols-[minmax(0,1.5fr)_1fr_3.5rem_2.5rem] gap-2 text-xs text-zinc-500"
						>
							<span>Label</span>
							<span>Length ({unit})</span>
							<span>Qty</span>
							<span></span>
						</div>
						{#each linearPieces as lp (lp.id)}
							<div
								class="row mb-1 grid grid-cols-[minmax(0,1.5fr)_1fr_3.5rem_2.5rem] items-center gap-2"
							>
								<div class="flex min-w-0 items-center gap-2">
									<span class="h-2 w-2 shrink-0 rounded-full" style="background:{pieceColor(lp.id)}"
									></span>
									<input type="text" class={inputCls} placeholder="Label" bind:value={lp.label} />
								</div>
								<input
									type="number"
									class={numCls}
									min={dimMin}
									step={dimStep}
									bind:value={lp.length}
								/>
								<input type="number" class={numCls} min="1" bind:value={lp.quantity} />
								<button onclick={() => removeLinearPiece(lp.id)} class={delCls}>×</button>
							</div>
						{/each}
					{/if}
					<button onclick={addLinearPiece} class={addBtnCls}>+ Add piece</button>
				</section>

				<!-- Unplaced pieces warning -->
				{#if linearUnplaced.length > 0}
					<section>
						<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
							<p class="mb-2 text-xs font-semibold text-amber-800">Could not place all pieces</p>
							<ul class="space-y-1">
								{#each linearUnplaced as item (item.label + item.reason)}
									<li class="text-xs text-amber-700">
										{item.count > 1 ? `${item.count}×` : ''} "{item.label}" —
										{item.reason === 'too_large'
											? 'too long to fit in any stock'
											: 'not enough stock available'}
									</li>
								{/each}
							</ul>
						</div>
					</section>
				{/if}

				<!-- Linear Results -->
				{#if linearBoards.length > 0}
					<section>
						<p class="mb-3 text-sm font-semibold text-zinc-800">Results</p>
						<div class="mb-8 flex flex-wrap gap-2">
							{#each linearSummary as row (row.length)}
								<div
									class="flex items-baseline gap-1.5 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2"
								>
									<span class="text-xl font-semibold text-zinc-900 tabular-nums">{row.count}</span>
									<span class="text-xs text-zinc-600">× {row.length}{unitLabel}</span>
								</div>
							{/each}
						</div>
						<div class="space-y-3">
							{#each linearBoards as board (board.index)}
								{@const sc = linearScale}
								{@const svgW = board.stockLength * sc}
								<div class="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
									<p class="mb-2 text-xs text-zinc-600">
										Board {board.index + 1} · {board.stockLength}{unitLabel}
										{#if board.stockLength - board.usedLength > 0}
											<span class="ml-2"
												>{Math.round((board.stockLength - board.usedLength) * 100) / 100}{unitLabel} remaining</span
											>
										{/if}
									</p>
									<!-- overflow-x-auto so long boards scroll on mobile -->
									<div class="overflow-x-auto">
										<svg
											width={svgW}
											height={36}
											style="display:block;border-radius:6px;overflow:hidden;min-width:100%"
										>
											<rect x={0} y={0} width={svgW} height={36} fill="#f4f4f5" />
											{#each board.placements as p (`${p.pieceId}-${p.start}`)}
												{@const px = p.start * sc}
												{@const pw = p.length * sc}
												<rect
													x={px + 0.5}
													y={0.5}
													width={Math.max(0, pw - 1)}
													height={35}
													fill={pieceColor(p.pieceId)}
													rx="3"
												/>
												{#if pw > 20}
													<text
														x={px + pw / 2}
														y={18}
														text-anchor="middle"
														dominant-baseline="middle"
														font-size={Math.min(10, pw / 3)}
														fill="#18181b"
														font-family="system-ui,sans-serif"
														font-weight="500">{p.label || '?'}</text
													>
												{/if}
											{/each}
										</svg>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<footer class="py-5 text-center text-xs text-zinc-400">
		<a
			href="https://github.com/walkersutton/cutlist"
			target="_blank"
			rel="noopener noreferrer"
			class="footer-link inline-flex items-center gap-1.5"
		>
			<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
				<path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/>
			</svg>
			GitHub
		</a>
	</footer>
</div>

<!-- Settings drawer (mobile only) -->
{#if settingsOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40 bg-black/40 sm:hidden"
		transition:fade={{ duration: 200 }}
		onclick={() => (settingsOpen = false)}
		role="presentation"
	></div>

	<!-- Sheet -->
	<div
		class="fixed right-0 bottom-0 left-0 z-50 rounded-t-2xl bg-white px-6 pt-4 pb-10 sm:hidden"
		transition:fly={{ y: 380, duration: 320, easing: cubicOut }}
		role="dialog"
		aria-modal="true"
		aria-label="Settings"
	>
		<!-- Drag handle (visual only — backdrop tap dismisses) -->
		<div class="mx-auto mb-6 h-1.5 w-10 rounded-full bg-zinc-200"></div>

		<div class="space-y-6">
			<!-- Mode -->
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-zinc-700">Mode</span>
				<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
					<button
						onclick={() => (mode = 'sheet')}
						class={`drawer-toggle rounded-full px-4 py-1.5 text-sm font-medium ${mode === 'sheet' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
						>Sheet</button
					>
					<button
						onclick={() => (mode = 'linear')}
						class={`drawer-toggle rounded-full px-4 py-1.5 text-sm font-medium ${mode === 'linear' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
						>Linear</button
					>
				</div>
			</div>

			<!-- Unit -->
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-zinc-700">Unit</span>
				<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
					<button
						onclick={() => setUnit('in')}
						class={`drawer-toggle rounded-full px-4 py-1.5 text-sm font-medium ${unit === 'in' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
						>Inches</button
					>
					<button
						onclick={() => setUnit('mm')}
						class={`drawer-toggle rounded-full px-4 py-1.5 text-sm font-medium ${unit === 'mm' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
						>mm</button
					>
				</div>
			</div>

			<!-- Kerf -->
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-zinc-700">Kerf width</span>
				<label class="flex items-center gap-2 text-sm text-zinc-600">
					<input
						type="text"
						inputmode="decimal"
						class={smNumCls}
						value={kerf}
						onchange={applyKerf}
					/>
					<span class="text-zinc-400">{unit}</span>
				</label>
			</div>

			<!-- Reset -->
			<div class="border-t border-zinc-100 pt-4">
				<button
					onclick={() => {
						settingsOpen = false;
						reset();
					}}
					class="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 11 11"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M1.5 3h8M3.5 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M4.5 5.5v3M6.5 5.5v3M2 3l.6 6.1A1 1 0 0 0 3.6 10h3.8a1 1 0 0 0 1-.9L9 3"
						/>
					</svg>
					Reset everything
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@media (hover: hover) and (pointer: fine) {
		.del {
			opacity: 0;
		}
		.row:hover .del {
			opacity: 1;
		}
	}
	.del {
		transition:
			opacity 120ms ease,
			color 120ms ease,
			background-color 120ms ease;
	}

	.drawer-toggle {
		transition:
			background-color 150ms ease,
			color 150ms ease,
			box-shadow 150ms ease;
	}

	.footer-link {
		transition:
			color 150ms ease,
			transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
	}

	@media (hover: hover) and (pointer: fine) {
		.footer-link:hover {
			color: #18181b;
			transform: translateY(-1px);
		}
	}
</style>
