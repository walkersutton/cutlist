<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut, quintOut } from 'svelte/easing';
	import type { PackMethod, PanelInput, SheetType } from '$lib/packer.js';
	import { formatCut } from '$lib/guillotine.js';
	import { formatThickness, parseMeasurement, stockName } from '$lib/stock.js';
	import { openPrintPreview } from '$lib/print-preview.js';
	import CsvImportDialog from '$lib/CsvImportDialog.svelte';
	import CsvExportDialog from '$lib/CsvExportDialog.svelte';
	import {
		csvFileName,
		panelsToCsv,
		piecesToCsv,
		stockToCsv,
		type CsvImport,
		type CsvKind
	} from '$lib/csv.js';
	import type { LinearPiece } from '$lib/linear-packer.js';
	import { materialKey, packByMaterial, packLinearByMaterial } from '$lib/material-pack.js';
	import { SHARE_PARAM, encodePlan, planFromHash, type PlanState } from '$lib/share.js';
	import {
		STORE_KEY,
		convertPlanUnits,
		convertShopStock,
		loadStore,
		newPlan,
		newPlanId,
		planHasContent,
		uniqueName,
		type Plan,
		type Stock,
		type Store,
		type Unit
	} from '$lib/plans.js';

	const store = loadStore((key) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	});

	// A shared link (#plan=...) never overwrites anything. On a device with no plans yet it simply
	// becomes the first plan; otherwise it opens as an unsaved preview the visitor can save as a
	// new plan or dismiss.
	const sharedPlan = typeof location !== 'undefined' ? planFromHash(location.hash) : null;
	const sharedName = sharedPlan?.name || 'Shared plan';
	const deviceIsBlank = !store.plans.some(planHasContent);
	if (sharedPlan && deviceIsBlank) {
		store.shop = {
			unit: sharedPlan.unit,
			sheetTypes: sharedPlan.sheetTypes,
			linearStocks: sharedPlan.linearStocks
		};
		store.plans = [{ ...store.plans[0], ...sharedPlanFields(sharedPlan), name: sharedName }];
		store.activeId = store.plans[0].id;
		clearShareHash();
	}
	const startInPreview = sharedPlan != null && !deviceIsBlank;
	let previewingShared = $state(startInPreview);
	// The device's unit, kept aside while a shared plan (possibly in the other unit) is previewed.
	const deviceUnit = store.shop.unit;

	function sharedPlanFields(p: PlanState) {
		return {
			mode: p.mode,
			kerf: p.kerf,
			cutMethod: p.cutMethod,
			panels: p.panels,
			linearPieces: p.linearPieces
		};
	}

	function clearShareHash() {
		history.replaceState(history.state, '', location.pathname + location.search);
	}

	const storedActive = store.plans.find((p) => p.id === store.activeId)!;
	// A previewed link brings its own stock, so it's shown as the plan's custom stock and the
	// device's shop stock is never touched.
	const initial: Plan & { unit: Unit } = startInPreview
		? {
				...storedActive,
				...sharedPlanFields(sharedPlan!),
				unit: sharedPlan!.unit,
				stock: { sheetTypes: sharedPlan!.sheetTypes, linearStocks: sharedPlan!.linearStocks },
				useCustomStock: true
			}
		: { ...structuredClone(storedActive), unit: store.shop.unit };

	// Every plan except the active one lives here as stored data; the active plan is edited through
	// the top-level state below and folded back in when persisting or switching.
	let plans = $state<Plan[]>(store.plans);
	let activeId = $state(store.activeId);
	let activeUpdatedAt = $state(storedActive.updatedAt);
	const activePlan = $derived(plans.find((p) => p.id === activeId)!);
	const currentName = $derived(previewingShared ? sharedName : (activePlan?.name ?? ''));

	let nextId = 1;
	function uid() {
		return String(nextId++);
	}

	function maxIdFrom(...arrays: Array<{ id: string }[]>) {
		let max = 0;
		for (const arr of arrays)
			for (const item of arr) {
				const n = parseInt(item.id, 10);
				if (!isNaN(n) && n > max) max = n;
			}
		return max;
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

	let mode = $state<'sheet' | 'linear'>(initial.mode);
	let unit = $state<Unit>(initial.unit);
	const unitLabel = $derived(unit === 'in' ? '"' : ' mm');
	const dimStep = $derived(unit === 'in' ? 0.125 : 1);
	const dimMin = $derived(unit === 'in' ? 0.125 : 1);

	function setUnit(to: Unit) {
		if (to === unit) return;
		const plan = convertPlanUnits(
			{
				kerf,
				panels: $state.snapshot(panels),
				linearPieces: $state.snapshot(linearPieces),
				stock: $state.snapshot(planStock)
			},
			to
		);
		kerf = plan.kerf;
		panels = plan.panels;
		linearPieces = plan.linearPieces;
		planStock = plan.stock;
		// Unit is device-wide, so shop stock and the other stored plans convert too — except while
		// previewing a link, which must leave the device untouched.
		if (!previewingShared) {
			shopStock = convertShopStock($state.snapshot(shopStock), to);
			plans = plans.map((p) => (p.id === activeId ? p : convertPlanUnits($state.snapshot(p), to)));
		}
		unit = to;
	}

	let kerf = $state<number>(initial.kerf);
	let cutMethod = $state<PackMethod>(initial.cutMethod);
	let settingsOpen = $state(false);
	let shareOpen = $state(false);
	let sheetZoom = $state(1.0);

	$effect(() => {
		if (settingsOpen || shareOpen || (stockOpen && !isDesktop)) {
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	});

	let panels = $state<PanelInput[]>(initial.panels);
	let linearPieces = $state<LinearPiece[]>(initial.linearPieces);

	// Stock: the device-wide shop stock, plus optional stock owned by the active plan.
	let shopStock = $state<Stock>({
		sheetTypes: store.shop.sheetTypes,
		linearStocks: store.shop.linearStocks
	});
	let planStock = $state<Stock | null>(initial.stock ?? null);
	let useCustomStock = $state(!!initial.useCustomStock && !!initial.stock);
	/** The stock the active plan is laid out on. */
	const packStock = $derived(useCustomStock && planStock ? planStock : shopStock);
	// Shop stock drawer: non-modal on desktop so the layout stays live beside it while stock
	// changes; a modal bottom sheet on phones.
	let stockOpen = $state(false);
	/** Set once the drawer finishes sliding in; only then does the page make room for it. */
	let stockSettled = $state(false);
	let isDesktop = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 1024px)');
		isDesktop = mq.matches;
		const onChange = () => (isDesktop = mq.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	/** The drawer sizes to its content (capped in CSS); measured so the page can make room. */
	let drawerHeight = $state(0);
	let stockDrawerEl = $state<HTMLElement>();

	/** Desktop keeps a slim bar docked at the bottom that expands into the drawer. */
	const STOCK_BAR = 40;
	const stockBar = $derived(isDesktop && !previewingShared);
	/** Room the page leaves at the bottom for the bar or the settled drawer. */
	const stockReserve = $derived(
		!stockBar ? 0 : stockOpen && stockSettled ? drawerHeight : STOCK_BAR
	);
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function openStock() {
		stockOpen = true;
		// A timer rather than transitionend, which never fires when reduced motion skips the slide.
		clearTimeout(settleTimer);
		settleTimer = setTimeout(() => (stockSettled = stockOpen), 300);
	}
	function closeStock() {
		clearTimeout(settleTimer);
		stockOpen = false;
		stockSettled = false;
	}

	// Phones: the sheet's handle swipes it away.
	let drag: { id: number; y: number; t: number } | null = null;
	let dragging = $state(false);
	/** Swipe offset; applied as the transform directly, not via a CSS variable. */
	let swipeY = $state(0);
	function onHandleDown(e: PointerEvent) {
		if (drag) return; // a second finger mid-drag would make the sheet jump
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { id: e.pointerId, y: e.clientY, t: performance.now() };
		dragging = true;
	}
	function onHandleMove(e: PointerEvent) {
		if (drag?.id !== e.pointerId) return;
		const dy = e.clientY - drag.y;
		// Past the top, friction instead of a hard stop.
		swipeY = dy > 0 ? dy : -Math.sqrt(-dy);
	}
	function onHandleUp(e: PointerEvent) {
		if (drag?.id !== e.pointerId) return;
		const dy = e.clientY - drag.y;
		const velocity = Math.abs(dy) / (performance.now() - drag.t);
		// A quick flick dismisses as well as a long drag.
		if (dy > 120 || (dy > 10 && velocity > 0.11)) closeStock();
		drag = null;
		dragging = false;
		swipeY = 0;
	}

	function stockIds(): Array<{ id: string }[]> {
		return [
			shopStock.sheetTypes,
			shopStock.linearStocks,
			planStock?.sheetTypes ?? [],
			planStock?.linearStocks ?? []
		];
	}

	nextId = untrack(() => maxIdFrom(...stockIds(), panels, linearPieces) + 1);

	function setCustomStock(on: boolean) {
		// First switch to custom starts from a copy of the shop stock; later toggles restore it.
		if (on && !planStock) planStock = structuredClone($state.snapshot(shopStock));
		useCustomStock = on;
	}

	function addSheetType(target: Stock) {
		const d = unit === 'mm' ? { w: 1220, h: 2440 } : { w: 48, h: 96 };
		target.sheetTypes = [
			...target.sheetTypes,
			{ id: uid(), width: d.w, height: d.h, quantity: 0, grain: 'vertical' }
		];
	}
	function removeSheetType(target: Stock, id: string) {
		target.sheetTypes = target.sheetTypes.filter((s) => s.id !== id);
	}
	function addPanel() {
		const d = unit === 'mm' ? { w: 300, h: 600 } : { w: 24, h: 24 };
		// Parts usually come in runs of one material, so a new panel starts with the previous one's.
		const prev = panels.at(-1);
		panels = [
			...panels,
			{
				id: uid(),
				label: '',
				width: d.w,
				height: d.h,
				quantity: 1,
				grain: 'any',
				...(prev?.material || prev?.thickness
					? { material: prev.material, thickness: prev.thickness }
					: {})
			}
		];
	}
	function removePanel(id: string) {
		panels = panels.filter((p) => p.id !== id);
	}
	function addLinearStock(target: Stock) {
		target.linearStocks = [
			...target.linearStocks,
			{ id: uid(), length: unit === 'mm' ? 2440 : 96, quantity: 0 }
		];
	}
	function removeLinearStock(target: Stock, id: string) {
		target.linearStocks = target.linearStocks.filter((s) => s.id !== id);
	}
	function addLinearPiece() {
		const prev = linearPieces.at(-1);
		linearPieces = [
			...linearPieces,
			{
				id: uid(),
				label: '',
				length: unit === 'mm' ? 300 : 24,
				quantity: 1,
				...(prev?.material ? { material: prev.material } : {})
			}
		];
	}

	// ----- Part → material -----

	interface MaterialOption {
		key: string;
		name: string;
		material?: string;
		thickness?: number;
	}
	function materialOptions(items: Array<{ material?: string; thickness?: number }>) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const seen = new Map<string, MaterialOption>();
		for (const it of items) {
			const key = materialKey(it.material, it.thickness);
			if (!key || seen.has(key)) continue;
			const name = stockName({ id: '', length: 0, quantity: 0, ...it }, unit);
			seen.set(key, { key, name, material: it.material?.trim(), thickness: it.thickness });
		}
		return [...seen.values()];
	}
	/** Named materials in the plan's stock; the picker only appears once there's at least one. */
	const sheetMaterials = $derived(materialOptions(packStock.sheetTypes));
	const linearMaterials = $derived(
		materialOptions(packStock.linearStocks.map((s) => ({ material: s.material })))
	);

	/** The picker only appears once stock has a named material (or the part already names one). */
	function showMaterialPicker(
		p: { material?: string; thickness?: number },
		options: MaterialOption[]
	) {
		return options.length > 0 || materialKey(p.material, p.thickness) !== '';
	}

	/** Display name for a part's material, e.g. "3/4″ Baltic birch". */
	function partMaterialName(p: { material?: string; thickness?: number }) {
		return stockName({ id: '', length: 0, quantity: 0, ...p }, unit);
	}

	function setPartMaterial(
		part: { material?: string; thickness?: number },
		key: string,
		options: MaterialOption[]
	) {
		const opt = options.find((o) => o.key === key);
		part.material = opt?.material || undefined;
		if ('thickness' in part || opt?.thickness) part.thickness = opt?.thickness;
	}
	function removeLinearPiece(id: string) {
		linearPieces = linearPieces.filter((p) => p.id !== id);
	}

	function panelColor(id: string): string {
		const idx = panels.findIndex((p) => p.id === id);
		return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
	}
	function pieceColor(id: string): string {
		const idx = linearPieces.findIndex((p) => p.id === id);
		return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
	}

	let packResult = $derived(packByMaterial(packStock.sheetTypes, panels, kerf, cutMethod));
	let sheets = $derived(packResult.sheets);
	let linearPackResult = $derived(packLinearByMaterial(packStock.linearStocks, linearPieces, kerf));
	let linearBoards = $derived(linearPackResult.boards);

	let hasResults = $derived(mode === 'sheet' ? sheets.length > 0 : linearBoards.length > 0);

	/** Display name ("3/4″ Baltic birch") of the stock item a packed sheet or length came from. */
	function sheetStockName(id: string) {
		const st = packStock.sheetTypes.find((s) => s.id === id);
		return st ? stockName(st, unit) : '';
	}
	function linearStockName(id: string) {
		const ls = packStock.linearStocks.find((s) => s.id === id);
		return ls ? stockName(ls, unit) : '';
	}

	function sheetCardDetail(sheet: (typeof sheets)[number]) {
		const size = `${sheet.sheetWidth}×${sheet.sheetHeight}${unitLabel}`;
		const name = sheetStockName(sheet.stockId);
		return name ? `${name} · ${size}` : size;
	}
	function boardCardDetail(board: (typeof linearBoards)[number]) {
		const size = `${board.stockLength}${unitLabel}`;
		const name = linearStockName(board.stockId);
		return name ? `${name} · ${size}` : size;
	}

	// Grouped by stock item (not just size) so two materials of the same size stay separate.
	let sheetSummary = $derived(
		(() => {
			const map: Record<string, { id: string; name: string; w: number; h: number; count: number }> =
				{};
			for (const s of sheets) {
				const e = map[s.stockId];
				if (e) e.count++;
				else
					map[s.stockId] = {
						id: s.stockId,
						name: sheetStockName(s.stockId),
						w: s.sheetWidth,
						h: s.sheetHeight,
						count: 1
					};
			}
			return Object.values(map);
		})()
	);

	let linearSummary = $derived(
		(() => {
			const map: Record<string, { id: string; name: string; length: number; count: number }> = {};
			for (const b of linearBoards) {
				const e = map[b.stockId];
				if (e) e.count++;
				else
					map[b.stockId] = {
						id: b.stockId,
						name: linearStockName(b.stockId),
						length: b.stockLength,
						count: 1
					};
			}
			return Object.values(map);
		})()
	);

	let sheetUnplaced = $derived(
		(() => {
			const map: Record<
				string,
				{ key: string; label: string; count: number; reason: string; material: string }
			> = {};
			for (const { panel, reason } of packResult.unplaced) {
				const key = `${panel.id}:${reason}`;
				const e = map[key];
				if (e) e.count++;
				else
					map[key] = {
						key,
						label: panel.label || `${panel.width}×${panel.height}`,
						count: 1,
						reason,
						material: partMaterialName(panel)
					};
			}
			return Object.values(map);
		})()
	);

	let linearUnplaced = $derived(
		(() => {
			const map: Record<
				string,
				{ key: string; label: string; count: number; reason: string; material: string }
			> = {};
			for (const { piece, reason } of linearPackResult.unplaced) {
				const key = `${piece.id}:${reason}`;
				const e = map[key];
				if (e) e.count++;
				else
					map[key] = {
						key,
						label: piece.label || piece.length + unitLabel,
						count: 1,
						reason,
						material: partMaterialName(piece)
					};
			}
			return Object.values(map);
		})()
	);

	let wastePctTotal = $derived(
		(() => {
			if (mode === 'sheet') {
				if (!sheets.length) return null;
				const totalArea = sheets.reduce((s, sh) => s + sh.sheetWidth * sh.sheetHeight, 0);
				const used = sheets.reduce(
					(s, sh) =>
						s +
						sh.placements.reduce(
							(a: number, p: { width: number; height: number }) => a + p.width * p.height,
							0
						),
					0
				);
				return Math.round((1 - used / totalArea) * 100);
			}
			if (!linearBoards.length) return null;
			const total = linearBoards.reduce((s, b) => s + b.stockLength, 0);
			const used = linearBoards.reduce(
				(s, b) => s + b.placements.reduce((a: number, p: { length: number }) => a + p.length, 0),
				0
			);
			return Math.round((1 - used / total) * 100);
		})()
	);

	const SVG_MAX = 400;
	function svgScale(w: number, h: number) {
		return Math.min(SVG_MAX / w, SVG_MAX / h);
	}
	const LINEAR_BAR_W = 560;

	// Shop inventory view: every sheet and stock length drawn at one shared scale so sizes compare truthfully.
	const INV_SHEET_MAX = 180;
	const invSheetScale = $derived(
		INV_SHEET_MAX /
			Math.max(1, ...shopStock.sheetTypes.flatMap((st) => [st.width || 0, st.height || 0]))
	);
	const invBoardMax = $derived(Math.max(1, ...shopStock.linearStocks.map((ls) => ls.length || 0)));
	function boardPct(length: number) {
		return Math.max(2, ((length || 0) / invBoardMax) * 100);
	}
	/** Layers drawn behind a stock item to suggest a stack; unlimited stock shows a full stack. */
	function stackDepth(qty: number) {
		return qty === 0 ? 3 : Math.min(qty, 3);
	}
	function sheetArea(w: number, h: number) {
		return unit === 'in'
			? `${Math.round(((w * h) / 144) * 10) / 10} ft²`
			: `${Math.round(((w * h) / 1e6) * 100) / 100} m²`;
	}
	let linearScale = $derived(
		linearBoards.length > 0 ? LINEAR_BAR_W / Math.max(...linearBoards.map((b) => b.stockLength)) : 1
	);

	// Last-persisted snapshot of the active plan, used to bump its updatedAt only on real edits.
	// Reset to '' whenever a different plan is loaded so switching doesn't count as an edit.
	let lastActiveJson = '';

	$effect(() => {
		if (previewingShared) return;
		const active = {
			mode,
			kerf,
			cutMethod,
			panels,
			linearPieces,
			stock: planStock ?? undefined,
			useCustomStock
		};
		const json = JSON.stringify(active);
		if (lastActiveJson && json !== lastActiveJson) activeUpdatedAt = Date.now();
		lastActiveJson = json;
		const out: Store = {
			v: 2,
			shop: { unit, ...shopStock },
			plans: plans.map((p) =>
				p.id === activeId ? { ...p, ...active, updatedAt: activeUpdatedAt } : p
			),
			activeId
		};
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(out));
		} catch {
			/* ignore */
		}
	});

	/** Thickness as typed into its input: a fraction in inches ("3/4"), a number in mm. */
	function thicknessInputValue(t: number | undefined) {
		return t ? formatThickness(t, unit).replace(/″| mm$/, '') : '';
	}

	function applyThickness(st: SheetType, e: Event) {
		const el = e.target as HTMLInputElement;
		if (!el.value.trim()) st.thickness = undefined;
		else {
			const v = parseMeasurement(el.value);
			if (v !== null && v > 0) st.thickness = v;
		}
		el.value = thicknessInputValue(st.thickness);
	}

	function applyKerf(e: Event) {
		const el = e.target as HTMLInputElement;
		const v = parseMeasurement(el.value);
		if (v !== null && v >= 0) kerf = v;
		el.value = String(kerf);
	}

	function clearPlan() {
		if (!confirm(`Clear all panels and pieces from “${currentName}”? Your stock is kept.`)) return;
		panels = [];
		linearPieces = [];
		settingsOpen = false;
	}

	// ----- CSV import / export -----

	/** Where the importer was opened from; null while it's closed. */
	let importFrom = $state<'parts' | 'stock' | null>(null);
	/** The stock an import changes: the shop's from its drawer, otherwise whatever the plan uses. */
	const importStockTarget = $derived(
		!stockOpen && useCustomStock && planStock ? planStock : shopStock
	);

	function applyImport(r: CsvImport) {
		// "Replace" only replaces the kinds of rows the file has, so a sheet-only file never
		// wipes linear parts (or linear stock), and vice versa.
		function merge<T>(existing: T[], incoming: Omit<T, 'id'>[]): T[] {
			const added = incoming.map((x) => ({ ...x, id: uid() }) as T);
			if (!added.length) return existing;
			return r.replace ? added : [...existing, ...added];
		}
		if (r.kind === 'parts') {
			panels = merge(panels, r.data.panels);
			linearPieces = merge(linearPieces, r.data.pieces);
			// Show what was just imported.
			if (!r.data.pieces.length) mode = 'sheet';
			else if (!r.data.panels.length) mode = 'linear';
		} else {
			const t = importStockTarget;
			t.sheetTypes = merge(t.sheetTypes, r.data.sheetTypes);
			t.linearStocks = merge(t.linearStocks, r.data.linearStocks);
		}
		importFrom = null;
	}

	async function downloadCsv(csv: string, name: string) {
		const file = new File([csv], name, { type: 'text/csv' });
		// Phones (and installed PWAs) handle downloads poorly; the share sheet can save to Files.
		if (usePrintPreview() && navigator.canShare?.({ files: [file] })) {
			try {
				await navigator.share({ files: [file] });
				return;
			} catch (e) {
				if ((e as DOMException).name === 'AbortError') return;
			}
		}
		const a = document.createElement('a');
		a.href = URL.createObjectURL(file);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	/** Parts export follows the mode on screen, so sheet and linear rows never share a table. */
	const partsCount = $derived(mode === 'sheet' ? panels.length : linearPieces.length);
	const shopStockCount = $derived(shopStock.sheetTypes.length + shopStock.linearStocks.length);

	/** What the export dialog is showing; null while it's closed. */
	let exportFrom = $state<CsvKind | null>(null);
	const exportData = $derived.by(() => {
		if (!exportFrom) return null;
		const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
		const units = unit === 'in' ? 'inches' : 'mm';
		if (exportFrom === 'stock')
			return {
				title: 'Export my shop stock',
				summary: `${plural(shopStockCount, 'stock size')} · ${units}`,
				csv: stockToCsv(shopStock, unit),
				fileName: 'shop-stock.csv'
			};
		const sheet = mode === 'sheet';
		return {
			title: sheet ? 'Export panels' : 'Export linear pieces',
			summary: `${plural(partsCount, sheet ? 'panel' : 'piece')} · ${units}`,
			csv: sheet ? panelsToCsv(panels, unit) : piecesToCsv(linearPieces, unit),
			fileName: csvFileName(currentName, sheet ? 'panels' : 'pieces')
		};
	});

	// ----- Plans -----

	/** Folds the edited active plan back into `plans`. */
	function commitActive() {
		plans = plans.map((p) =>
			p.id === activeId
				? {
						...p,
						mode,
						kerf,
						cutMethod,
						panels: $state.snapshot(panels),
						linearPieces: $state.snapshot(linearPieces),
						stock: $state.snapshot(planStock) ?? undefined,
						useCustomStock,
						updatedAt: activeUpdatedAt
					}
				: p
		);
	}

	function loadPlan(p: Plan) {
		const data = structuredClone($state.snapshot(p));
		mode = data.mode;
		kerf = data.kerf;
		cutMethod = data.cutMethod;
		panels = data.panels;
		linearPieces = data.linearPieces;
		planStock = data.stock ?? null;
		useCustomStock = !!data.useCustomStock && !!data.stock;
		activeId = data.id;
		activeUpdatedAt = data.updatedAt;
		lastActiveJson = '';
		nextId = maxIdFrom(...stockIds(), panels, linearPieces) + 1;
	}

	function switchPlan(id: string) {
		if (id === activeId) return;
		commitActive();
		loadPlan(plans.find((p) => p.id === id)!);
	}

	function createPlan() {
		commitActive();
		const p = newPlan(uniqueName('Untitled plan', plans), unit);
		plans = [...plans, p];
		loadPlan(p);
		renamingId = p.id;
	}

	function duplicatePlan(id: string) {
		commitActive();
		const src = $state.snapshot(plans.find((p) => p.id === id)!);
		const p: Plan = {
			...structuredClone(src),
			id: newPlanId(),
			name: uniqueName(`${src.name} copy`, plans),
			updatedAt: Date.now()
		};
		plans = [...plans, p];
		loadPlan(p);
	}

	function deletePlan(id: string) {
		const target = plans.find((p) => p.id === id);
		if (!target || !confirm(`Delete “${target.name}”? This can't be undone.`)) return;
		plans = plans.filter((p) => p.id !== id);
		if (plans.length === 0) plans = [newPlan('Untitled plan', unit)];
		if (id === activeId) loadPlan(sortedPlans[0] ?? plans[0]);
	}

	function renamePlan(id: string, name: string) {
		const p = plans.find((p) => p.id === id);
		if (p && name.trim()) p.name = name.trim().slice(0, 80);
		renamingId = null;
	}

	// ----- Shared-link preview -----

	/** Saves the previewed link as a new plan that keeps the link's stock as its own. */
	function saveSharedPlan() {
		let plan = {
			mode,
			kerf,
			cutMethod,
			panels: $state.snapshot(panels),
			linearPieces: $state.snapshot(linearPieces),
			stock: $state.snapshot(packStock)
		};
		if (unit !== deviceUnit) plan = convertPlanUnits(plan, deviceUnit);
		const saved: Plan = {
			...plan,
			useCustomStock: true,
			id: newPlanId(),
			name: uniqueName(sharedName, plans),
			updatedAt: Date.now()
		};
		unit = deviceUnit;
		plans = [...plans, saved];
		loadPlan(saved);
		previewingShared = false;
		clearShareHash();
	}

	function discardSharedPlan() {
		unit = deviceUnit;
		loadPlan(plans.find((p) => p.id === activeId)!);
		previewingShared = false;
		clearShareHash();
	}

	// ----- Plan switcher menu -----

	let planMenuOpen = $state(false);
	let planMenuEl = $state<HTMLDivElement>();
	let planTriggerEl = $state<HTMLButtonElement>();
	let renamingId = $state<string | null>(null);

	/** Plans with the active one reflecting live edits, most recently edited first. */
	const sortedPlans = $derived(
		plans
			.map((p) =>
				p.id === activeId ? { ...p, mode, panels, linearPieces, updatedAt: activeUpdatedAt } : p
			)
			.sort((a, b) => b.updatedAt - a.updatedAt)
	);

	function closePlanMenu(refocus = false) {
		planMenuOpen = false;
		renamingId = null;
		if (refocus) planTriggerEl?.focus();
	}

	function onPlanMenuKeydown(e: KeyboardEvent) {
		if (renamingId) return;
		if (e.key === 'Escape') return closePlanMenu(true);
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const items = [...(planMenuEl?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
		const i = items.indexOf(document.activeElement as HTMLElement);
		const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
		items[(next + items.length) % items.length]?.focus();
	}

	function focusSelect(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function planSummary(p: Pick<Plan, 'mode' | 'panels' | 'linearPieces'>) {
		const n = p.mode === 'sheet' ? p.panels.length : p.linearPieces.length;
		const noun = p.mode === 'sheet' ? 'panel' : 'piece';
		return n === 0 ? 'Empty' : `${n} ${noun}${n === 1 ? '' : 's'}`;
	}

	const relTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	function timeAgo(t: number) {
		const s = (Date.now() - t) / 1000;
		if (s < 60) return 'just now';
		if (s < 3600) return relTime.format(-Math.round(s / 60), 'minute');
		if (s < 86400) return relTime.format(-Math.round(s / 3600), 'hour');
		if (s < 86400 * 30) return relTime.format(-Math.round(s / 86400), 'day');
		return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function shareUrl() {
		const hash = `${SHARE_PARAM}=${encodePlan({
			name: currentName,
			mode,
			unit,
			kerf,
			cutMethod,
			sheetTypes: packStock.sheetTypes,
			panels,
			linearStocks: packStock.linearStocks,
			linearPieces
		})}`;
		return `${location.origin}${location.pathname}#${hash}`;
	}

	// Desktop share menu. Feedback shows on the trigger itself, so the menu can close immediately.
	let shareMenuOpen = $state(false);
	let shareMenuEl = $state<HTMLDivElement>();
	let shareTriggerEl = $state<HTMLButtonElement>();
	let shareFeedback = $state<string | null>(null);
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

	function flashFeedback(msg: string) {
		shareFeedback = msg;
		clearTimeout(feedbackTimer);
		feedbackTimer = setTimeout(() => (shareFeedback = null), 1800);
	}

	function closeShareMenu(refocus = false) {
		shareMenuOpen = false;
		if (refocus) shareTriggerEl?.focus();
	}

	function onShareMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') return closeShareMenu(true);
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const items = [...(shareMenuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
		const i = items.indexOf(document.activeElement as HTMLElement);
		const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
		items[(next + items.length) % items.length]?.focus();
	}

	// Popover: scales from its trigger (top-right), fast ease-out in, faster out.
	function pop(_node: Element, { duration }: { duration: number }) {
		return {
			duration,
			easing: quintOut,
			css: (t: number) => `opacity:${t};transform:scale(${0.96 + 0.04 * t})`
		};
	}

	async function copyLink() {
		await navigator.clipboard.writeText(shareUrl());
		flashFeedback('Link copied');
	}

	async function shareLink() {
		const url = shareUrl();
		if (navigator.share) {
			try {
				await navigator.share({ title: 'Cut plan', url });
				return;
			} catch (e) {
				if ((e as DOMException).name === 'AbortError') return;
			}
		}
		await copyLink();
	}

	/** Phones (and installed PWAs, which have no tabs) get the in-app preview instead of a hidden print frame. */
	function usePrintPreview() {
		const ua = navigator.userAgent;
		const isIOS =
			/iPad|iPhone|iPod/.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		return isIOS || /Android|Mobile/.test(ua);
	}

	function printPlan() {
		const ule = unit === 'in' ? '&quot;' : ' mm';
		function esc(s: string) {
			return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
		function buildSheetSvg(sheet: (typeof sheets)[0]): string {
			const PMAX = 280;
			const sc = Math.min(PMAX / sheet.sheetWidth, PMAX / sheet.sheetHeight);
			const w = sheet.sheetWidth * sc,
				h = sheet.sheetHeight * sc;
			let s = `<svg width="${w.toFixed(1)}" height="${h.toFixed(1)}" style="display:block;border-radius:4px;overflow:hidden">`;
			s += `<rect width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#f4f4f5"/>`;
			const sheetIsHoriz = sheet.grain === 'horizontal';
			const grainSpan = sheetIsHoriz ? h : w;
			const grainCount = Math.max(1, Math.floor(grainSpan / 14) - 1);
			for (let i = 0; i < grainCount; i++) {
				const off = ((i + 1) * grainSpan) / (grainCount + 1);
				if (sheetIsHoriz)
					s += `<line x1="3" y1="${off.toFixed(1)}" x2="${(w - 3).toFixed(1)}" y2="${off.toFixed(1)}" stroke="#a1a1aa" stroke-width="0.6" opacity="0.5"/>`;
				else
					s += `<line x1="${off.toFixed(1)}" y1="3" x2="${off.toFixed(1)}" y2="${(h - 3).toFixed(1)}" stroke="#a1a1aa" stroke-width="0.6" opacity="0.5"/>`;
			}
			for (const p of sheet.placements) {
				const px = p.x * sc,
					py = p.y * sc,
					pw = p.width * sc,
					ph = p.height * sc;
				s += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="${panelColor(p.panelId)}" rx="2"/>`;
				if (p.grain !== 'any' && pw > 8 && ph > 8) {
					const eg = p.rotated ? (p.grain === 'horizontal' ? 'vertical' : 'horizontal') : p.grain;
					const isH = eg === 'horizontal';
					const span = isH ? ph : pw;
					const cnt = Math.max(1, Math.floor(span / 10) - 1);
					for (let i = 0; i < cnt; i++) {
						const off = ((i + 1) * span) / (cnt + 1);
						if (isH)
							s += `<line x1="${(px + 4).toFixed(1)}" y1="${(py + off).toFixed(1)}" x2="${(px + pw - 4).toFixed(1)}" y2="${(py + off).toFixed(1)}" stroke="#1e3a5f" stroke-width="0.75" opacity="0.2"/>`;
						else
							s += `<line x1="${(px + off).toFixed(1)}" y1="${(py + 4).toFixed(1)}" x2="${(px + off).toFixed(1)}" y2="${(py + ph - 4).toFixed(1)}" stroke="#1e3a5f" stroke-width="0.75" opacity="0.2"/>`;
					}
				}
				if (pw > 16) {
					const wfs = Math.max(6, Math.min(9, pw / 6));
					s += `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + 3).toFixed(1)}" text-anchor="middle" dominant-baseline="hanging" font-size="${wfs.toFixed(1)}" fill="#18181b" font-family="system-ui,sans-serif" opacity="0.75">${p.width}${ule}</text>`;
				}
				if (ph > 20) {
					const hfs = Math.max(6, Math.min(9, ph / 6));
					const hx = px + Math.ceil(hfs / 2) + 2;
					s += `<text x="${hx.toFixed(1)}" y="${(py + ph / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${hfs.toFixed(1)}" fill="#18181b" font-family="system-ui,sans-serif" opacity="0.75" transform="rotate(-90 ${hx.toFixed(1)} ${(py + ph / 2).toFixed(1)})">${p.height}${ule}</text>`;
				}
				if (pw > 30 && ph > 18 && p.label) {
					const fs = Math.min(11, pw / 5, ph / 3);
					s += `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + ph / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${fs.toFixed(1)}" fill="#18181b" font-family="system-ui,sans-serif" font-weight="500">${esc(p.label)}${p.rotated ? ' ↺' : ''}</text>`;
				}
			}
			for (const c of sheet.cuts ?? []) {
				const cpos = (c.pos + kerf / 2) * sc;
				const c1 = c.start * sc,
					c2 = c.end * sc;
				const horiz = c.direction === 'horizontal';
				const br = 6;
				const bx = Math.min(Math.max(horiz ? c1 + br + 2 : cpos, br + 1), w - br - 1);
				const by = Math.min(Math.max(horiz ? cpos : c1 + br + 2, br + 1), h - br - 1);
				s += horiz
					? `<line x1="${c1.toFixed(1)}" y1="${cpos.toFixed(1)}" x2="${c2.toFixed(1)}" y2="${cpos.toFixed(1)}" stroke="#dc2626" stroke-width="1" stroke-dasharray="4 3" opacity="0.85"/>`
					: `<line x1="${cpos.toFixed(1)}" y1="${c1.toFixed(1)}" x2="${cpos.toFixed(1)}" y2="${c2.toFixed(1)}" stroke="#dc2626" stroke-width="1" stroke-dasharray="4 3" opacity="0.85"/>`;
				s += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${br}" fill="#dc2626"/>`;
				s += `<text x="${bx.toFixed(1)}" y="${by.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="7" fill="white" font-family="system-ui,sans-serif" font-weight="600">${c.order}</text>`;
			}
			return s + '</svg>';
		}
		const cutList = panels.filter((p) => p.width > 0 && p.height > 0 && p.quantity > 0);
		const dateStr = new Date().toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const materialsRows = sheetSummary
			.map(
				(r) =>
					`<tr><td>${esc(r.name) || '—'}</td><td>${r.w}×${r.h}${ule}</td><td class="num">${r.count}</td></tr>`
			)
			.join('');
		const cutRows = cutList
			.map(
				(p) =>
					`<tr><td><span class="sw" style="background:${panelColor(p.id)}"></span>${esc(p.label || '—')}</td><td>${p.width}${ule}</td><td>${p.height}${ule}</td><td class="num">${p.quantity}</td><td>${p.grain}</td></tr>`
			)
			.join('');
		const sheetCards = sheets
			.map((sheet) => {
				const placements = sheet.placements
					.map((p) => {
						const name = p.label ? esc(p.label) : `${p.width}×${p.height}${ule}`;
						const rot = p.rotated ? ' <span class="rot">↺</span>' : '';
						return `<li><span class="sw" style="background:${panelColor(p.panelId)}"></span>${name} — ${p.width}×${p.height}${ule}${rot}</li>`;
					})
					.join('');
				const cutSeq = sheet.cuts?.length
					? `<p class="cuts-label">Cut sequence</p><ol class="cutseq">${sheet.cuts.map((c) => `<li>${formatCut(c, ule)}</li>`).join('')}</ol>`
					: '';
				return `<div class="card"><p class="clabel">Sheet ${sheet.index + 1}${sheetStockName(sheet.stockId) ? ` &nbsp;·&nbsp; ${esc(sheetStockName(sheet.stockId))}` : ''} &nbsp;·&nbsp; ${sheet.sheetWidth}×${sheet.sheetHeight}${ule} &nbsp;·&nbsp; ${sheet.wastePercent}% waste${sheet.cuts?.length ? ` &nbsp;·&nbsp; ${sheet.cuts.length} cuts` : ''}</p><div class="card-body">${buildSheetSvg(sheet)}<div><ul class="plist">${placements}</ul>${cutSeq}</div></div></div>`;
			})
			.join('');
		const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(currentName)} — Cut Plan</title><style>*{box-sizing:border-box;margin:0;padding:0}@page{size:letter;margin:.75in}body{font-family:system-ui,-apple-system,sans-serif;font-size:10pt;color:#18181b}.screen-actions{display:none}h1{font-size:16pt;font-weight:700;margin-bottom:2pt}.meta{font-size:8.5pt;color:#71717a;margin-bottom:14pt}h2{font-size:11pt;font-weight:600;margin:14pt 0 5pt;padding-bottom:3pt;border-bottom:1px solid #e4e4e7}table{width:100%;border-collapse:collapse;font-size:9pt}thead th{text-align:left;padding:3pt 8pt;background:#f4f4f5;font-weight:600}tbody td{padding:3pt 8pt;border-bottom:1px solid #f4f4f5;vertical-align:middle}tbody tr:last-child td{border-bottom:none}.num{text-align:right}.sw{display:inline-block;width:8pt;height:8pt;border-radius:2pt;vertical-align:middle;margin-right:3pt}.sheets{display:flex;flex-wrap:wrap;gap:14pt;margin-top:6pt}.card{break-inside:avoid;page-break-inside:avoid}.clabel{font-size:8pt;color:#71717a;margin-bottom:3pt}.card-body{display:flex;flex-direction:row;align-items:flex-start;gap:10pt}.plist{margin-top:0;font-size:8pt;color:#3f3f46;list-style:none}.plist li{padding:1pt 0}.cuts-label{font-size:8pt;font-weight:600;color:#71717a;margin-top:6pt}.cutseq{margin:2pt 0 0 12pt;font-size:8pt;color:#3f3f46}.cutseq li{padding:1pt 0}.rot{font-style:normal}@media screen{body{padding:18px;font-size:12px;background:white}.screen-actions{display:flex;position:sticky;top:0;z-index:1;align-items:center;gap:10px;margin:-18px -18px 18px;padding:12px 18px;border-bottom:1px solid #e4e4e7;background:rgba(255,255,255,.96);backdrop-filter:blur(8px)}.screen-actions button{border:1px solid #d4d4d8;border-radius:8px;background:#18181b;color:white;padding:9px 12px;font:600 14px system-ui,-apple-system,sans-serif}.screen-actions p{font-size:12px;color:#71717a}}@media print{.screen-actions{display:none!important}}</style></head><body><div class="screen-actions"><button type="button" onclick="window.print()">Print / PDF</button><p>If the preview did not open automatically, tap Print / PDF.</p></div><h1>${esc(currentName)}</h1><p class="meta">Cut plan &nbsp;·&nbsp; ${dateStr} &nbsp;·&nbsp; Kerf: ${kerf}${ule}${cutMethod === 'guillotine' ? ' &nbsp;·&nbsp; Layout: Track saw (straight cuts)' : ''}</p><h2>Materials Needed</h2><table><thead><tr><th>Material</th><th>Sheet Size</th><th class="num">Qty</th></tr></thead><tbody>${materialsRows}</tbody></table><h2>Cut List</h2><table><thead><tr><th>Label</th><th>Width</th><th>Height</th><th class="num">Qty</th><th>Grain</th></tr></thead><tbody>${cutRows}</tbody></table><h2>Sheet Layouts</h2><div class="sheets">${sheetCards}</div><script>window.addEventListener('load',()=>{window.print();});<\/script></body></html>`; // eslint-disable-line no-useless-escape
		if (usePrintPreview()) {
			openPrintPreview(html);
			return;
		}
		const iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
		document.body.appendChild(iframe);
		iframe.contentDocument!.write(html);
		iframe.contentDocument!.close();
		iframe.contentWindow!.addEventListener('afterprint', () => iframe.remove());
		iframe.contentWindow!.print();
	}

	async function copyPlan() {
		const ul = unit === 'in' ? '"' : ' mm';
		const lines: string[] = [];
		lines.push(
			`${currentName} — Cut Plan — ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`
		);
		lines.push(`Kerf: ${kerf}${ul}`);
		if (cutMethod === 'guillotine') lines.push('Layout: Track saw (straight cuts)');
		lines.push('');
		lines.push('MATERIALS');
		for (const row of sheetSummary)
			lines.push(`  ${row.count}× ${row.name ? `${row.name} ` : ''}${row.w}×${row.h}${ul}`);
		function grainArrow(grain: string) {
			if (grain === 'horizontal') return 'grain →';
			if (grain === 'vertical') return 'grain ↑';
			return '';
		}
		function asciiSheetDiagram(sheet: (typeof sheets)[0]): string[] {
			const CW = 36;
			const scX = CW / sheet.sheetWidth;
			const scY = scX * 0.5;
			const CH = Math.min(40, Math.max(4, Math.ceil(sheet.sheetHeight * scY)));
			const grid: string[][] = Array.from({ length: CH }, () => Array(CW).fill(' '));
			function put(r: number, c: number, ch: string) {
				if (r >= 0 && r < CH && c >= 0 && c < CW) grid[r][c] = ch;
			}
			function putH(r: number, c: number) {
				const e = grid[r]?.[c];
				put(r, c, e === '|' || e === '+' ? '+' : '-');
			}
			function putV(r: number, c: number) {
				const e = grid[r]?.[c];
				put(r, c, e === '-' || e === '+' ? '+' : '|');
			}
			for (const p of sheet.placements) {
				const x1 = Math.floor(p.x * scX),
					y1 = Math.floor(p.y * scY);
				const x2 = Math.min(CW - 1, Math.ceil((p.x + p.width) * scX));
				const y2 = Math.min(CH - 1, Math.ceil((p.y + p.height) * scY));
				for (let c = x1; c <= x2 && c < CW; c++) {
					putH(y1, c);
					putH(y2, c);
				}
				for (let r = y1 + 1; r < y2; r++) {
					putV(r, x1);
					putV(r, x2);
				}
				put(y1, x1, '+');
				put(y1, x2, '+');
				put(y2, x1, '+');
				put(y2, x2, '+');
				const innerW = x2 - x1 - 2;
				if (innerW > 0) {
					const lbl = (p.label || `${p.width}×${p.height}${ul}`).slice(0, innerW);
					const midR = Math.round((y1 + y2) / 2);
					if (midR > y1 && midR < y2) {
						const startC = x1 + 1 + Math.floor((innerW - lbl.length) / 2);
						for (let i = 0; i < lbl.length; i++) {
							const c = startC + i;
							if (c > x1 && c < x2 && c < CW) grid[midR][c] = lbl[i];
						}
					}
				}
			}
			return [
				'+' + '-'.repeat(CW) + '+',
				...grid.map((row) => '|' + row.join('') + '|'),
				'+' + '-'.repeat(CW) + '+'
			].map((l) => '  ' + l);
		}
		lines.push('');
		lines.push('CUT LIST');
		for (const p of panels.filter((p) => p.width > 0 && p.height > 0 && p.quantity > 0)) {
			const name = p.label ? `${p.label}  ` : '';
			const g = grainArrow(p.grain);
			lines.push(`  ${name}${p.width}×${p.height}${ul}  ×${p.quantity}${g ? `  ${g}` : ''}`);
		}
		lines.push('');
		lines.push('SHEET LAYOUTS');
		lines.push('  (| = vertical grain  - = horizontal grain)');
		for (const sheet of sheets) {
			lines.push('');
			lines.push(
				`  Sheet ${sheet.index + 1} — ${sheetStockName(sheet.stockId) ? `${sheetStockName(sheet.stockId)} ` : ''}${sheet.sheetWidth}×${sheet.sheetHeight}${ul}  ${grainArrow(sheet.grain) || 'any grain'}`
			);
			for (const p of sheet.placements) {
				const name = p.label ? `${p.label}  ` : '';
				const rot = p.rotated ? ' ↺' : '';
				const eg =
					p.grain === 'any'
						? 'any'
						: p.rotated
							? p.grain === 'horizontal'
								? 'vertical'
								: 'horizontal'
							: p.grain;
				const g = grainArrow(eg);
				lines.push(`    ${name}${p.width}×${p.height}${ul}${rot}${g ? `  ${g}` : ''}`);
			}
			if (sheet.cuts?.length) {
				lines.push('    CUT SEQUENCE');
				for (const c of sheet.cuts) lines.push(`      ${formatCut(c, ul)}`);
			}
			for (const dl of asciiSheetDiagram(sheet)) lines.push(dl);
		}
		await navigator.clipboard.writeText(lines.join('\n'));
		flashFeedback('Plan copied');
	}

	// CSS helpers
	const inputBase =
		'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-base text-zinc-900 placeholder:text-zinc-400 sm:text-[13.5px] sm:py-1.5';
	const numBase = inputBase + ' text-right tabular-nums';
	const cardCls = 'row mb-2 rounded-xl border border-zinc-300 bg-zinc-50 p-3';
	const delCls =
		'del flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-500';
	const addBtnCls =
		'mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900';
	const stepBtnCls =
		'flex h-9 w-8 shrink-0 items-center justify-center border border-zinc-200 text-base leading-none text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 active:bg-zinc-100';
	const rowInputCls =
		'rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] text-zinc-900 placeholder:text-zinc-400';
	const rowHeadCls =
		'flex items-center border-b border-zinc-200 pb-1 text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase';
	const rowStepBtnCls =
		'flex h-7 w-6 shrink-0 items-center justify-center border border-zinc-200 text-sm leading-none text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 active:bg-zinc-100';
	const rowDelCls =
		'del flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500';
	const rowAddCls =
		'press mt-2 -ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900';
	const stepInputCls =
		'w-11 border-y border-zinc-200 bg-white text-center text-base tabular-nums text-zinc-900 placeholder:text-zinc-400 focus:relative sm:text-sm';
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape' || !stockOpen || e.defaultPrevented) return;
		if (planMenuOpen || shareMenuOpen || importFrom || exportFrom) return;
		closeStock();
	}}
	onpointerdown={(e) => {
		if (shareMenuOpen && !shareMenuEl?.contains(e.target as Node)) closeShareMenu();
		if (planMenuOpen && !planMenuEl?.contains(e.target as Node)) closePlanMenu();
		// Desktop has no scrim, so a press anywhere outside the drawer dismisses it — unless a
		// dialog is up on top of it.
		if (
			stockOpen &&
			isDesktop &&
			e.button === 0 &&
			!stockDrawerEl?.contains(e.target as Node) &&
			!(e.target as Element).closest?.('[aria-controls="stock-drawer"]') &&
			!(settingsOpen || shareOpen || importFrom || exportFrom)
		)
			closeStock();
	}}
/>

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
	<meta property="og:title" content="Cut List Tool — Free 1D & 2D Cut List Optimizer" />
	<meta
		property="og:description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D)."
	/>
	<meta property="og:url" content="https://cutlist.walkersutton.com" />
	<meta name="twitter:title" content="Cut List Tool — Free 1D & 2D Cut List Optimizer" />
	<meta
		name="twitter:description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D)."
	/>
</svelte:head>

{#snippet materialPicker(
	part: { material?: string; thickness?: number },
	options: MaterialOption[],
	cls = ''
)}
	{@const key = materialKey(part.material, part.thickness)}
	{#if showMaterialPicker(part, options)}
		<label class="flex min-w-0 flex-col gap-1 {cls}">
			<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
				>Material</span
			>
			<select
				class={inputBase}
				value={key}
				onchange={(e) => setPartMaterial(part, e.currentTarget.value, options)}
			>
				<option value="">Any stock</option>
				{#each options as o (o.key)}
					<option value={o.key}>{o.name}</option>
				{/each}
				{#if key && !options.some((o) => o.key === key)}
					<option value={key}>{partMaterialName(part)} (not in stock)</option>
				{/if}
			</select>
		</label>
	{/if}
{/snippet}

{#snippet csvActions(from: CsvKind, canExport: boolean)}
	<!-- Sits in a section header: quiet, and pulled into the padding so it doesn't grow the row -->
	<div class="-my-1 -mr-1.5 flex shrink-0 items-center text-[11px]">
		<button
			onclick={() => (importFrom = from)}
			title="Import CSV"
			class="press inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M8 3v7M5 7l3 3 3-3" /><path d="M3 11v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" /></svg
			>
			Import
		</button>
		<button
			onclick={() => (exportFrom = from)}
			title="Export CSV"
			disabled={!canExport}
			class="press inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:pointer-events-none disabled:text-zinc-300"
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M8 10V3M5 6l3-3 3 3" /><path d="M3 11v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" /></svg
			>
			Export
		</button>
	</div>
{/snippet}

{#snippet stockSourceToggle()}
	{#if previewingShared}
		<span
			class="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200"
			>From link</span
		>
	{:else}
		<div
			class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			role="radiogroup"
			aria-label="Stock source"
		>
			<button
				role="radio"
				aria-checked={!useCustomStock}
				onclick={() => setCustomStock(false)}
				title="Use my shop stock, shared by all plans"
				class="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap transition-colors {!useCustomStock
					? 'bg-white text-zinc-900 shadow-sm'
					: 'text-zinc-500 hover:text-zinc-800'}">My shop</button
			>
			<button
				role="radio"
				aria-checked={useCustomStock}
				onclick={() => setCustomStock(true)}
				title="Give this plan its own stock"
				class="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap transition-colors {useCustomStock
					? 'bg-white text-zinc-900 shadow-sm'
					: 'text-zinc-500 hover:text-zinc-800'}">This plan</button
			>
		</div>
	{/if}
{/snippet}

{#snippet stockSummary(kind: 'sheet' | 'linear')}
	{@const items =
		kind === 'sheet'
			? shopStock.sheetTypes.map((st) => ({
					id: st.id,
					name: stockName(st, unit),
					size: `${st.width}×${st.height}${unitLabel}`,
					grain: st.grain === 'horizontal' ? '→' : st.grain === 'vertical' ? '↑' : '',
					qty: st.quantity
				}))
			: shopStock.linearStocks.map((ls) => ({
					id: ls.id,
					name: stockName(ls, unit),
					size: `${ls.length}${unitLabel}`,
					grain: '',
					qty: ls.quantity
				}))}
	<button
		onclick={() => openStock()}
		aria-controls="stock-drawer"
		class="press group flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50"
	>
		<span class="flex min-w-0 flex-1 flex-wrap gap-1.5">
			{#each items as it (it.id)}
				<span
					class="inline-flex items-baseline gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 tabular-nums"
				>
					{#if it.name}<span class="font-medium text-zinc-900">{it.name}</span>{/if}
					{it.size}{#if it.grain}<span class="text-zinc-400">{it.grain}</span>{/if}
					<span class="text-zinc-400">{it.qty ? `×${it.qty}` : '∞'}</span>
				</span>
			{:else}
				<span class="text-xs text-zinc-400"
					>No {kind === 'sheet' ? 'sheet sizes' : 'stock lengths'} yet</span
				>
			{/each}
		</span>
		<span
			class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500 group-hover:text-zinc-900"
			>Edit my shop stock
			<svg
				width="12"
				height="12"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg
			>
		</span>
	</button>
{/snippet}

{#snippet sheetStockList(target: Stock)}
	{#each target.sheetTypes as st (st.id)}
		<div class={cardCls}>
			<div class="mb-2.5 flex items-center gap-2">
				<input
					type="text"
					class="{inputBase} min-w-0 flex-1"
					placeholder="Material (optional)"
					aria-label="Material"
					maxlength="60"
					bind:value={st.material}
				/>
				<label class="flex shrink-0 items-center gap-1.5">
					<input
						type="text"
						inputmode="decimal"
						class="{inputBase} w-24 text-right tabular-nums"
						placeholder="Thickness"
						aria-label="Thickness ({unit})"
						value={thicknessInputValue(st.thickness)}
						onblur={(e) => applyThickness(st, e)}
						onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
					/>
					<span class="text-xs text-zinc-400">{unit}</span>
				</label>
			</div>
			<div class="flex items-end gap-2">
				<label class="flex min-w-0 flex-1 flex-col gap-1">
					<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
						>Width ({unit})</span
					>
					<input
						type="number"
						inputmode="decimal"
						class={numBase}
						min={dimMin}
						step={dimStep}
						bind:value={st.width}
					/>
				</label>
				<span class="pb-2 text-zinc-300">×</span>
				<label class="flex min-w-0 flex-1 flex-col gap-1">
					<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
						>Height ({unit})</span
					>
					<input
						type="number"
						inputmode="decimal"
						class={numBase}
						min={dimMin}
						step={dimStep}
						bind:value={st.height}
					/>
				</label>
			</div>
			<div class="mt-3 flex items-center gap-2">
				<div
					class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
				>
					<button
						type="button"
						onclick={() => (st.grain = 'horizontal')}
						class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {st.grain ===
						'horizontal'
							? 'bg-white text-zinc-900 shadow-sm'
							: 'text-zinc-500 hover:text-zinc-800'}">Horiz →</button
					>
					<button
						type="button"
						onclick={() => (st.grain = 'vertical')}
						class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {st.grain ===
						'vertical'
							? 'bg-white text-zinc-900 shadow-sm'
							: 'text-zinc-500 hover:text-zinc-800'}">Vert ↑</button
					>
				</div>
				<div class="ml-auto flex items-center gap-2">
					<span class="text-[11px] text-zinc-400">qty</span>
					<div class="flex items-stretch">
						<button
							type="button"
							class="{stepBtnCls} rounded-l-lg"
							onclick={() => {
								if (st.quantity > 0) st.quantity -= 1;
							}}>−</button
						>
						<input
							type="number"
							inputmode="numeric"
							min="0"
							value={st.quantity || ''}
							placeholder="∞"
							oninput={(e) => {
								st.quantity = Number((e.target as HTMLInputElement).value) || 0;
							}}
							class={stepInputCls}
						/>
						<button
							type="button"
							class="{stepBtnCls} rounded-r-lg"
							onclick={() => {
								st.quantity += 1;
							}}>+</button
						>
					</div>
					<button onclick={() => removeSheetType(target, st.id)} class={delCls} aria-label="Remove">
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
							/></svg
						>
					</button>
				</div>
			</div>
		</div>
	{/each}
	<button onclick={() => addSheetType(target)} class={addBtnCls}>
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
		>
		Add sheet size
	</button>
{/snippet}

{#snippet boardStockList(target: Stock)}
	{#each target.linearStocks as ls (ls.id)}
		<div class={cardCls}>
			<input
				type="text"
				class="{inputBase} mb-2.5"
				placeholder="Material (optional)"
				aria-label="Material"
				maxlength="60"
				bind:value={ls.material}
			/>
			<div class="flex items-end gap-3">
				<label class="flex min-w-0 flex-1 flex-col gap-1">
					<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
						>Length ({unit})</span
					>
					<input
						type="number"
						inputmode="decimal"
						class={numBase}
						min={dimMin}
						step={dimStep}
						bind:value={ls.length}
					/>
				</label>
				<div class="flex items-center gap-2 pb-0.5">
					<span class="text-[11px] text-zinc-400">qty</span>
					<div class="flex items-stretch">
						<button
							type="button"
							class="{stepBtnCls} rounded-l-lg"
							onclick={() => {
								if (ls.quantity > 0) ls.quantity -= 1;
							}}>−</button
						>
						<input
							type="number"
							inputmode="numeric"
							min="0"
							value={ls.quantity || ''}
							placeholder="∞"
							oninput={(e) => {
								ls.quantity = Number((e.target as HTMLInputElement).value) || 0;
							}}
							class={stepInputCls}
						/>
						<button
							type="button"
							class="{stepBtnCls} rounded-r-lg"
							onclick={() => {
								ls.quantity += 1;
							}}>+</button
						>
					</div>
					<button
						onclick={() => removeLinearStock(target, ls.id)}
						class={delCls}
						aria-label="Remove"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
							/></svg
						>
					</button>
				</div>
			</div>
		</div>
	{/each}
	<button onclick={() => addLinearStock(target)} class={addBtnCls}>
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
		>
		Add stock length
	</button>
{/snippet}

{#snippet qtyStepper(item: { quantity: number })}
	<div class="flex items-stretch">
		<button
			type="button"
			class="{rowStepBtnCls} rounded-l-md"
			aria-label="Fewer"
			onclick={() => {
				if (item.quantity > 0) item.quantity -= 1;
			}}>−</button
		>
		<input
			type="number"
			inputmode="numeric"
			min="0"
			value={item.quantity || ''}
			placeholder="∞"
			aria-label="Quantity"
			oninput={(e) => {
				item.quantity = Number((e.target as HTMLInputElement).value) || 0;
			}}
			class="w-9 border-y border-zinc-200 bg-white text-center text-[13px] text-zinc-900 tabular-nums placeholder:text-zinc-400 focus:relative"
		/>
		<button
			type="button"
			class="{rowStepBtnCls} rounded-r-md"
			aria-label="More"
			onclick={() => {
				item.quantity += 1;
			}}>+</button
		>
	</div>
{/snippet}

<!-- Drawer editors: one compact row per stock item, under a shared column header -->
{#snippet sheetStockRows(target: Stock)}
	{#if target.sheetTypes.length}
		<div class="{rowHeadCls} gap-2">
			<span class="min-w-0 flex-1">Material</span>
			<span class="w-16 text-right">Thick.</span>
			<span class="w-[4.5rem] text-right">W</span>
			<span class="w-3"></span>
			<span class="w-[4.5rem] text-right">H</span>
			<span class="w-[3.75rem] text-center">Grain</span>
			<span class="w-[6.5rem] text-center">Qty</span>
			<span class="w-7"></span>
		</div>
	{/if}
	{#each target.sheetTypes as st (st.id)}
		<div class="row flex items-center gap-2 border-b border-zinc-100 py-1.5">
			<input
				type="text"
				class="{rowInputCls} min-w-0 flex-1"
				placeholder="Optional"
				aria-label="Material"
				maxlength="60"
				bind:value={st.material}
			/>
			<input
				type="text"
				inputmode="decimal"
				class="{rowInputCls} w-16 text-right tabular-nums"
				placeholder={unit}
				aria-label="Thickness ({unit})"
				value={thicknessInputValue(st.thickness)}
				onblur={(e) => applyThickness(st, e)}
				onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
			/>
			<input
				type="number"
				inputmode="decimal"
				class="{rowInputCls} w-[4.5rem] text-right tabular-nums"
				aria-label="Width ({unit})"
				min={dimMin}
				step={dimStep}
				bind:value={st.width}
			/>
			<span class="w-3 text-center text-zinc-300">×</span>
			<input
				type="number"
				inputmode="decimal"
				class="{rowInputCls} w-[4.5rem] text-right tabular-nums"
				aria-label="Height ({unit})"
				min={dimMin}
				step={dimStep}
				bind:value={st.height}
			/>
			<div
				class="inline-flex w-[3.75rem] shrink-0 items-center gap-0.5 rounded-md bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
				role="radiogroup"
				aria-label="Grain"
			>
				{#each [['horizontal', '→', 'Horizontal grain'], ['vertical', '↑', 'Vertical grain']] as const as [g, glyph, label] (g)}
					<button
						type="button"
						role="radio"
						aria-checked={st.grain === g}
						aria-label={label}
						title={label}
						onclick={() => (st.grain = g)}
						class="flex-1 rounded px-1 py-0.5 text-xs font-medium transition-colors {st.grain === g
							? 'bg-white text-zinc-900 shadow-sm'
							: 'text-zinc-500 hover:text-zinc-800'}">{glyph}</button
					>
				{/each}
			</div>
			<div class="flex w-[6.5rem] justify-center">{@render qtyStepper(st)}</div>
			<button onclick={() => removeSheetType(target, st.id)} class={rowDelCls} aria-label="Remove">
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path
						d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
					/></svg
				>
			</button>
		</div>
	{/each}
	<button onclick={() => addSheetType(target)} class={rowAddCls}>
		<svg
			width="12"
			height="12"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg
		>
		Add sheet size
	</button>
{/snippet}

{#snippet boardStockRows(target: Stock)}
	{#if target.linearStocks.length}
		<div class="{rowHeadCls} gap-2">
			<span class="min-w-0 flex-1">Material</span>
			<span class="w-20 text-right">Length</span>
			<span class="w-[6.5rem] text-center">Qty</span>
			<span class="w-7"></span>
		</div>
	{/if}
	{#each target.linearStocks as ls (ls.id)}
		<div class="row flex items-center gap-2 border-b border-zinc-100 py-1.5">
			<input
				type="text"
				class="{rowInputCls} min-w-0 flex-1"
				placeholder="Optional"
				aria-label="Material"
				maxlength="60"
				bind:value={ls.material}
			/>
			<input
				type="number"
				inputmode="decimal"
				class="{rowInputCls} w-20 text-right tabular-nums"
				aria-label="Length ({unit})"
				min={dimMin}
				step={dimStep}
				bind:value={ls.length}
			/>
			<div class="flex w-[6.5rem] justify-center">{@render qtyStepper(ls)}</div>
			<button
				onclick={() => removeLinearStock(target, ls.id)}
				class={rowDelCls}
				aria-label="Remove"
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path
						d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
					/></svg
				>
			</button>
		</div>
	{/each}
	<button onclick={() => addLinearStock(target)} class={rowAddCls}>
		<svg
			width="12"
			height="12"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg
		>
		Add stock length
	</button>
{/snippet}

{#snippet stockSectionHead(title: string, count: number)}
	<div class="mb-1.5 flex items-baseline justify-between gap-2">
		<div class="flex items-baseline gap-2">
			<h3 class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900">
				{title}
			</h3>
			<span class="text-xs text-zinc-400 tabular-nums">{count}</span>
		</div>
		<span class="shrink-0 text-[11px] whitespace-nowrap text-zinc-400">blank qty = ∞</span>
	</div>
{/snippet}

<!-- Shop inventory: every sheet and length drawn at one shared scale so sizes compare truthfully -->
{#snippet stockInventory(kind: 'sheet' | 'linear')}
	{#if kind === 'sheet'}
		{#if shopStock.sheetTypes.length}
			<div class="flex flex-wrap items-end gap-4">
				{#each shopStock.sheetTypes as st (st.id)}
					{@const sc = invSheetScale}
					{@const w = Math.max(4, (st.width || 0) * sc)}
					{@const h = Math.max(4, (st.height || 0) * sc)}
					{@const depth = stackDepth(st.quantity)}
					{@const off = 5}
					{@const isHoriz = st.grain === 'horizontal'}
					{@const span = isHoriz ? h : w}
					{@const lines = st.grain === 'any' ? 0 : Math.max(1, Math.floor(span / 12) - 1)}
					<div class="rounded-2xl border border-zinc-300 bg-white p-3.5 shadow-sm">
						<div class="mb-2 flex items-center justify-between gap-3">
							<p class="min-w-0 text-xs tabular-nums">
								{#if stockName(st, unit)}
									<span class="block truncate font-medium text-zinc-900">{stockName(st, unit)}</span
									>
								{/if}
								<span class="font-medium text-zinc-700">{st.width}×{st.height}{unitLabel}</span>
								<span class="text-zinc-400">· {sheetArea(st.width, st.height)}</span>
							</p>
							<span
								class="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums {st.quantity
									? 'bg-zinc-900 text-white'
									: 'bg-zinc-100 text-zinc-500'}"
								>{st.quantity ? `×${st.quantity}` : '∞ unlimited'}</span
							>
						</div>
						<svg
							width={w + off * (depth - 1)}
							height={h + off * (depth - 1)}
							style="display:block;overflow:visible"
							role="img"
							aria-label="{st.width} by {st.height} sheet, {st.quantity
								? `${st.quantity} on hand`
								: 'unlimited'}"
						>
							<!-- stack: back layers first, offset down-right -->
							{#each Array.from({ length: depth - 1 }, (_, i) => depth - 1 - i) as layer (layer)}
								<rect
									x={layer * off}
									y={layer * off}
									width={w}
									height={h}
									rx="3"
									fill="white"
									stroke="#d4d4d8"
									stroke-dasharray={st.quantity ? undefined : '3 2'}
								/>
							{/each}
							<rect width={w} height={h} rx="3" fill="#f4f4f5" stroke="#a1a1aa" />
							{#each Array.from({ length: lines }, (_, i) => i) as i (i)}
								{@const o = ((i + 1) * span) / (lines + 1)}
								{#if isHoriz}
									<line
										x1={3}
										y1={o}
										x2={w - 3}
										y2={o}
										stroke="#a1a1aa"
										stroke-width="0.6"
										opacity="0.5"
									/>
								{:else}
									<line
										x1={o}
										y1={3}
										x2={o}
										y2={h - 3}
										stroke="#a1a1aa"
										stroke-width="0.6"
										opacity="0.5"
									/>
								{/if}
							{/each}
							{#if w > 30}
								<text
									x={w / 2}
									y={5}
									text-anchor="middle"
									dominant-baseline="hanging"
									font-size="10"
									fill="#52525b"
									font-family="Inter, system-ui, sans-serif">{st.width}{unitLabel}</text
								>
							{/if}
							{#if h > 40}
								<text
									x={9}
									y={h / 2}
									text-anchor="middle"
									dominant-baseline="middle"
									font-size="10"
									fill="#52525b"
									font-family="Inter, system-ui, sans-serif"
									transform="rotate(-90 9 {h / 2})">{st.height}{unitLabel}</text
								>
							{/if}
							{#if st.grain !== 'any' && w > 36 && h > 36}
								<text
									x={w / 2}
									y={h / 2}
									text-anchor="middle"
									dominant-baseline="middle"
									font-size="10"
									fill="#71717a"
									font-family="Inter, system-ui, sans-serif">grain {isHoriz ? '→' : '↑'}</text
								>
							{/if}
						</svg>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-[13px] text-zinc-400">No sheet stock yet.</p>
		{/if}
	{:else if shopStock.linearStocks.length}
		<div
			class="divide-y divide-zinc-100 rounded-2xl border border-zinc-300 bg-white px-3.5 shadow-sm"
		>
			{#each shopStock.linearStocks as ls (ls.id)}
				{@const depth = stackDepth(ls.quantity)}
				{@const off = 4}
				<div class="flex items-center gap-3 py-3">
					<p class="w-20 shrink-0 text-xs tabular-nums sm:w-28">
						<span class="block font-medium text-zinc-700">{ls.length}{unitLabel}</span>
						{#if stockName(ls, unit)}
							<span class="block truncate text-zinc-500">{stockName(ls, unit)}</span>
						{/if}
					</p>
					<!-- Width is a share of the longest length, so bars stay to scale at any width -->
					<div class="min-w-0 flex-1">
						<div
							class="relative"
							style="width:{boardPct(ls.length)}%;height:{20 + off * (depth - 1)}px"
							role="img"
							aria-label="{ls.length} length of stock, {ls.quantity
								? `${ls.quantity} on hand`
								: 'unlimited'}"
						>
							{#each Array.from({ length: depth - 1 }, (_, i) => depth - 1 - i) as layer (layer)}
								<div
									class="absolute inset-x-0 h-5 rounded border bg-white {ls.quantity
										? 'border-zinc-300'
										: 'border-dashed border-zinc-300'}"
									style="top:{layer * off}px"
								></div>
							{/each}
							<div
								class="absolute inset-x-0 top-0 h-5 overflow-hidden rounded border border-zinc-400 bg-zinc-100"
							>
								<div class="absolute inset-x-1.5 top-[6px] h-px bg-zinc-400/45"></div>
								<div class="absolute inset-x-1.5 top-[12px] h-px bg-zinc-400/45"></div>
							</div>
						</div>
					</div>
					<span
						class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums {ls.quantity
							? 'bg-zinc-900 text-white'
							: 'bg-zinc-100 text-zinc-500'}"
						>{ls.quantity ? `×${ls.quantity}` : '∞ unlimited'}</span
					>
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-[13px] text-zinc-400">No linear stock yet.</p>
	{/if}
{/snippet}

<div
	class="flex min-h-screen flex-col bg-white text-zinc-900 lg:h-screen lg:min-h-0 lg:overflow-hidden"
	style:padding-bottom={stockReserve ? `${stockReserve}px` : undefined}
>
	<!-- ===== Header ===== -->
	<header
		class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200/80 bg-white/95 px-4 backdrop-blur lg:h-16 lg:px-6"
	>
		<!-- Logo + plan switcher -->
		<div class="flex min-w-0 items-center">
			<img src="/logo.jpg" alt="" class="mr-2 h-7 w-7 shrink-0 lg:h-8 lg:w-8" />
			<span
				class="hidden text-base font-semibold tracking-tight text-zinc-900 sm:inline lg:hidden xl:inline"
				>cutlist</span
			>
			<!-- ml-2 matches the plan button's px-2, so the slash sits visually centred -->
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				class="ml-2 hidden shrink-0 text-zinc-300 sm:block lg:hidden xl:block"
				aria-hidden="true"
				><path
					d="M10.5 2.5L5.5 13.5"
					stroke="currentColor"
					stroke-width="1.25"
					stroke-linecap="round"
				/></svg
			>
			<div
				class="relative min-w-0"
				bind:this={planMenuEl}
				onkeydown={onPlanMenuKeydown}
				role="none"
			>
				<button
					bind:this={planTriggerEl}
					onclick={() => (planMenuOpen = !planMenuOpen)}
					disabled={previewingShared}
					aria-haspopup="menu"
					aria-expanded={planMenuOpen}
					title={previewingShared
						? 'Save or dismiss the shared plan to switch plans'
						: 'Switch plan'}
					class="press flex max-w-[11rem] min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-base font-medium tracking-tight text-zinc-900 transition-colors hover:bg-zinc-100 disabled:hover:bg-transparent sm:max-w-[18rem] lg:max-w-[14rem] xl:max-w-[18rem]"
				>
					<span class="truncate">{currentName}</span>
					{#if previewingShared}
						<span
							class="shrink-0 rounded bg-sky-100 px-1.5 py-px text-[10px] font-semibold tracking-wide text-sky-700 uppercase"
							>Preview</span
						>
					{:else}
						<svg
							width="12"
							height="12"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="shrink-0 text-zinc-400 transition-transform duration-150 {planMenuOpen
								? 'rotate-180'
								: ''}"
							aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg
						>
					{/if}
				</button>
				{#if planMenuOpen}
					<div
						role="menu"
						aria-label="Plans"
						class="absolute top-full left-0 z-30 mt-1.5 w-80 max-w-[calc(100vw-2rem)] origin-top-left rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/10"
						in:pop={{ duration: 160 }}
						out:pop={{ duration: 100 }}
					>
						<p
							class="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
						>
							Plans
						</p>
						<div class="max-h-[min(60vh,24rem)] overflow-y-auto">
							{#each sortedPlans as p (p.id)}
								{#if renamingId === p.id}
									<div class="px-1 py-1">
										<input
											use:focusSelect
											value={p.name}
											aria-label="Plan name"
											maxlength="80"
											class={inputBase}
											onkeydown={(e) => {
												if (e.key === 'Enter') renamePlan(p.id, e.currentTarget.value);
												if (e.key === 'Escape') {
													e.stopPropagation();
													renamingId = null;
												}
											}}
											onblur={(e) => renamePlan(p.id, e.currentTarget.value)}
										/>
									</div>
								{:else}
									<div
										class="plan-row flex items-center rounded-lg transition-colors hover:bg-zinc-100 {p.id ===
										activeId
											? 'bg-zinc-50'
											: ''}"
									>
										<button
											role="menuitemradio"
											aria-checked={p.id === activeId}
											onclick={() => {
												switchPlan(p.id);
												closePlanMenu();
											}}
											class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:bg-zinc-100"
										>
											<svg
												width="14"
												height="14"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												class="shrink-0 text-zinc-900 {p.id === activeId ? '' : 'invisible'}"
												aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg
											>
											<span class="min-w-0 flex-1">
												<span class="block truncate text-[13px] font-medium text-zinc-900"
													>{p.name}</span
												>
												<span class="block text-xs text-zinc-500"
													>{planSummary(p)} · {timeAgo(p.updatedAt)}</span
												>
											</span>
										</button>
										<div class="plan-actions flex shrink-0 items-center pr-1">
											<button
												onclick={() => (renamingId = p.id)}
												class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700"
												aria-label="Rename {p.name}"
												title="Rename"
											>
												<svg
													width="14"
													height="14"
													viewBox="0 0 16 16"
													fill="none"
													stroke="currentColor"
													stroke-width="1.6"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"><path d="M11.2 2.8l2 2L6 12l-2.8.8L4 10z" /></svg
												>
											</button>
											<button
												onclick={() => {
													duplicatePlan(p.id);
													closePlanMenu();
												}}
												class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700"
												aria-label="Duplicate {p.name}"
												title="Duplicate"
											>
												<svg
													width="14"
													height="14"
													viewBox="0 0 16 16"
													fill="none"
													stroke="currentColor"
													stroke-width="1.6"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><rect x="5.5" y="5.5" width="8" height="8" rx="1.3" /><path
														d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"
													/></svg
												>
											</button>
											<button
												onclick={() => deletePlan(p.id)}
												class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500"
												aria-label="Delete {p.name}"
												title="Delete"
											>
												<svg
													width="14"
													height="14"
													viewBox="0 0 16 16"
													fill="none"
													stroke="currentColor"
													stroke-width="1.6"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path
														d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
													/></svg
												>
											</button>
										</div>
									</div>
								{/if}
							{/each}
						</div>
						<div class="mx-2.5 my-1 h-px bg-zinc-100"></div>
						<button
							role="menuitem"
							onclick={createPlan}
							class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-zinc-700 outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg
							>
							New plan
						</button>
						<button
							role="menuitem"
							onclick={() => {
								closePlanMenu();
								clearPlan();
							}}
							class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-zinc-700 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path
									d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
								/></svg
							>
							Clear this plan
						</button>
						<!-- Credits close the menu, as they close the phone's settings sheet -->
						<div
							class="mt-1 flex items-center justify-center gap-2.5 border-t border-zinc-100 px-2.5 pt-2 pb-1 text-[11px] text-zinc-400"
						>
							<a
								href="https://walkersutton.com"
								target="_blank"
								rel="noopener noreferrer"
								role="menuitem"
								class="footer-link rounded outline-none focus-visible:text-zinc-900"
								>built by Walker</a
							>
							<span
								class="h-[2px] w-[2px] shrink-0 translate-y-[1px] rounded-full bg-zinc-300"
								aria-hidden="true"
							></span>
							<a
								href="https://github.com/walkersutton/cutlist"
								target="_blank"
								rel="noopener noreferrer"
								role="menuitem"
								class="footer-link inline-flex items-center gap-1 rounded outline-none focus-visible:text-zinc-900"
							>
								<svg
									width="11"
									height="11"
									class="shrink-0"
									viewBox="0 0 16 16"
									fill="currentColor"
									aria-hidden="true"
									><path
										d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
									/></svg
								>
								Source
							</a>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Desktop toolbar -->
		<div class="ml-1 hidden shrink-0 items-center gap-2 lg:flex">
			<div
				class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			>
				<button
					onclick={() => (mode = 'sheet')}
					class="rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors {mode ===
					'sheet'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Sheet</button
				>
				<button
					onclick={() => (mode = 'linear')}
					class="rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors {mode ===
					'linear'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Linear</button
				>
			</div>
			<div
				class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			>
				<button
					onclick={() => setUnit('in')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {unit ===
					'in'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">in</button
				>
				<button
					onclick={() => setUnit('mm')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {unit ===
					'mm'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">mm</button
				>
			</div>
			{#if mode === 'sheet'}
				<div
					class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
				>
					<button
						onclick={() => (cutMethod = 'nested')}
						title="Nested layout — parts packed freely, any cut path (CNC)"
						class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {cutMethod ===
						'nested'
							? 'bg-white text-zinc-900 shadow-sm'
							: 'text-zinc-500 hover:text-zinc-800'}">CNC</button
					>
					<button
						onclick={() => (cutMethod = 'guillotine')}
						title="Straight full cuts only, with a numbered cut order (track saw / table saw)"
						class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {cutMethod ===
						'guillotine'
							? 'bg-white text-zinc-900 shadow-sm'
							: 'text-zinc-500 hover:text-zinc-800'}">Track saw</button
					>
				</div>
			{/if}
			<div class="mx-1 h-5 w-px bg-zinc-200"></div>
			<label class="flex items-center gap-1.5 text-[13px] text-zinc-500">
				kerf
				<input
					type="text"
					inputmode="decimal"
					value={kerf}
					onblur={applyKerf}
					onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
					class="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-right text-[13px] text-zinc-900 tabular-nums"
				/>
				<span class="text-zinc-400">{unit}</span>
			</label>
		</div>

		<!-- Mobile mode toggle -->
		<div class="ml-auto lg:hidden">
			<div
				class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			>
				<button
					onclick={() => (mode = 'sheet')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {mode ===
					'sheet'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Sheet</button
				>
				<button
					onclick={() => (mode = 'linear')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {mode ===
					'linear'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Linear</button
				>
			</div>
		</div>

		<!-- Desktop right actions -->
		<div class="ml-auto hidden shrink-0 items-center gap-1 lg:flex">
			{#if hasResults}
				<div class="relative" bind:this={shareMenuEl} onkeydown={onShareMenuKeydown} role="none">
					<button
						bind:this={shareTriggerEl}
						onclick={() => (shareMenuOpen = !shareMenuOpen)}
						aria-haspopup="menu"
						aria-expanded={shareMenuOpen}
						class="press inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 py-1.5 pr-2 pl-3 text-[13px] font-medium whitespace-nowrap text-white transition-colors hover:bg-zinc-700"
					>
						<!-- Both labels share one grid cell so the button never changes width -->
						<span class="grid justify-items-center">
							<span class="swap col-start-1 row-start-1" class:out={shareFeedback}>Share plan</span>
							<span
								class="swap col-start-1 row-start-1 inline-flex items-center gap-1"
								class:out={!shareFeedback}
								aria-hidden="true"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg
								>
								Copied
							</span>
						</span>
						<svg
							width="12"
							height="12"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="opacity-60 transition-transform duration-150 {shareMenuOpen
								? 'rotate-180'
								: ''}"
							aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg
						>
					</button>
					<span class="sr-only" aria-live="polite">{shareFeedback ?? ''}</span>
					{#if shareMenuOpen}
						<div
							role="menu"
							aria-label="Share"
							class="absolute top-full right-0 z-30 mt-1.5 w-64 origin-top-right rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/10"
							in:pop={{ duration: 160 }}
							out:pop={{ duration: 100 }}
						>
							<button
								role="menuitem"
								class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100 active:bg-zinc-200/70"
								onclick={() => {
									closeShareMenu();
									copyLink();
								}}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="shrink-0 text-zinc-500"
									aria-hidden="true"
									><path
										d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.8.8"
									/><path
										d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.1 9.2a2.6 2.6 0 0 0 3.7 3.7l.8-.8"
									/></svg
								>
								<span>
									<span class="block text-[13px] font-medium text-zinc-900">Copy link</span>
									<span class="block text-xs text-zinc-500">Opens this plan in their browser</span>
								</span>
							</button>
							<button
								role="menuitem"
								class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100 active:bg-zinc-200/70"
								onclick={() => {
									closeShareMenu();
									copyPlan();
								}}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="shrink-0 text-zinc-500"
									aria-hidden="true"
									><rect x="5.5" y="5.5" width="8" height="9" rx="1.3" /><path
										d="M10 5.5V3.2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h2.5"
									/></svg
								>
								<span>
									<span class="block text-[13px] font-medium text-zinc-900">Copy as text</span>
									<span class="block text-xs text-zinc-500">Paste into any app</span>
								</span>
							</button>
							<div class="mx-2.5 my-1 h-px bg-zinc-100"></div>
							<button
								role="menuitem"
								class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100 active:bg-zinc-200/70"
								onclick={() => {
									closeShareMenu();
									printPlan();
								}}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="shrink-0 text-zinc-500"
									aria-hidden="true"
									><path d="M4.5 5.5V2.5h7v3" /><rect
										x="2"
										y="5.5"
										width="12"
										height="5.5"
										rx="1"
									/><path d="M4.5 8.5h7v4.5h-7z" /></svg
								>
								<span class="block text-[13px] font-medium text-zinc-900">Print / PDF</span>
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	{#if previewingShared}
		<div
			class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sky-200 bg-sky-50 px-4 py-2.5 lg:px-6"
			role="status"
		>
			<p class="min-w-0 flex-1 text-[13px] text-sky-900">
				<span class="font-semibold">Viewing a shared plan.</span>
				<span class="text-sky-800/80">Nothing on this device changes unless you save it.</span>
			</p>
			<div class="flex items-center gap-2">
				<button
					onclick={discardSharedPlan}
					class="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sky-800 hover:bg-sky-100"
					>Dismiss</button
				>
				<button
					onclick={saveSharedPlan}
					class="rounded-lg bg-sky-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-sky-800"
					>Save to my plans</button
				>
			</div>
		</div>
	{/if}

	<!-- ===== Body: two-pane on lg ===== -->
	<div
		class="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(400px,460px)_1fr] xl:grid-cols-[480px_1fr]"
	>
		<!-- Left pane: inputs -->
		<div class="flex flex-col border-zinc-200/80 lg:min-h-0 lg:overflow-hidden lg:border-r">
			<div class="px-4 pt-5 pb-28 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-6 lg:pb-8">
				{#if mode === 'sheet'}
					<div class="space-y-7">
						<!-- Sheet stock -->
						<section>
							<div class="mb-2.5 flex items-center justify-between gap-2">
								<div class="flex items-baseline gap-2">
									<h2
										class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
									>
										Sheet stock
									</h2>
									<span class="text-xs text-zinc-400 tabular-nums"
										>{packStock.sheetTypes.length}</span
									>
								</div>
								{@render stockSourceToggle()}
							</div>
							{#if useCustomStock && planStock}
								<p class="mb-2 text-[11px] text-zinc-400">
									{previewingShared ? 'From the shared link' : 'Only this plan uses these'} · blank qty
									= ∞
								</p>
								{@render sheetStockList(planStock)}
							{:else}
								{@render stockSummary('sheet')}
							{/if}
						</section>

						<!-- Panels -->
						<section>
							<div class="mb-2.5 flex items-baseline justify-between gap-2">
								<div class="flex items-baseline gap-2">
									<h2
										class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
									>
										Panels
									</h2>
									<span class="text-xs text-zinc-400 tabular-nums">{panels.length}</span>
								</div>
								{@render csvActions('parts', partsCount > 0)}
							</div>
							{#each panels as panel (panel.id)}
								<div class={cardCls}>
									<div class="flex items-center gap-2">
										<span
											class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
											style="background:{panelColor(panel.id)}"
										></span>
										<input
											type="text"
											class="{inputBase} flex-1"
											placeholder="Label (optional)"
											bind:value={panel.label}
										/>
										<button
											onclick={() => removePanel(panel.id)}
											class={delCls}
											aria-label="Remove"
										>
											<svg
												width="14"
												height="14"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												stroke-width="1.6"
												stroke-linecap="round"
												stroke-linejoin="round"
												><path
													d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
												/></svg
											>
										</button>
									</div>
									<div class="mt-2.5 flex items-end gap-2">
										<label class="flex min-w-0 flex-1 flex-col gap-1">
											<span
												class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
												>Width ({unit})</span
											>
											<input
												type="number"
												inputmode="decimal"
												class={numBase}
												min={dimMin}
												step={dimStep}
												bind:value={panel.width}
											/>
										</label>
										<span class="pb-2 text-zinc-300">×</span>
										<label class="flex min-w-0 flex-1 flex-col gap-1">
											<span
												class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
												>Height ({unit})</span
											>
											<input
												type="number"
												inputmode="decimal"
												class={numBase}
												min={dimMin}
												step={dimStep}
												bind:value={panel.height}
											/>
										</label>
										<div class="flex flex-col gap-1">
											<span
												class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
												>Qty</span
											>
											<div class="flex items-stretch">
												<button
													type="button"
													class="{stepBtnCls} rounded-l-lg"
													onclick={() => {
														if (panel.quantity > 1) panel.quantity -= 1;
													}}>−</button
												>
												<input
													type="number"
													inputmode="numeric"
													min="1"
													bind:value={panel.quantity}
													class={stepInputCls}
												/>
												<button
													type="button"
													class="{stepBtnCls} rounded-r-lg"
													onclick={() => {
														panel.quantity += 1;
													}}>+</button
												>
											</div>
										</div>
									</div>
									<div class="mt-2.5 flex items-end gap-2">
										{@render materialPicker(panel, sheetMaterials, 'flex-1')}
										<label
											class="flex min-w-0 flex-col gap-1 {showMaterialPicker(panel, sheetMaterials)
												? 'w-[7.5rem] shrink-0'
												: 'flex-1'}"
										>
											<span
												class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
												>Grain</span
											>
											<select class={inputBase} bind:value={panel.grain}>
												<option value="any">Any ↕↔</option>
												<option value="horizontal">Horiz →</option>
												<option value="vertical">Vert ↑</option>
											</select>
										</label>
									</div>
								</div>
							{/each}
							<button onclick={addPanel} class={addBtnCls}>
								<svg
									width="14"
									height="14"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
								>
								Add panel
							</button>
						</section>

						{#if sheetUnplaced.length > 0}
							<div class="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
								<p class="mb-1.5 text-xs font-semibold text-amber-800">
									Could not place all panels
								</p>
								<ul class="space-y-1">
									{#each sheetUnplaced as item (item.key)}
										<li class="text-xs text-amber-700">
											{item.count > 1 ? `${item.count}× ` : ''}"{item.label}" — {item.reason ===
											'too_large'
												? 'too large to fit in any sheet'
												: item.reason === 'no_matching_stock'
													? `no “${item.material}” in stock`
													: 'not enough stock sheets available'}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{:else}
					<!-- Linear mode -->
					<div class="space-y-7">
						<!-- Stock -->
						<section>
							<div class="mb-2.5 flex items-center justify-between gap-2">
								<div class="flex items-baseline gap-2">
									<h2
										class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
									>
										Linear stock
									</h2>
									<span class="text-xs text-zinc-400 tabular-nums"
										>{packStock.linearStocks.length}</span
									>
								</div>
								{@render stockSourceToggle()}
							</div>
							{#if useCustomStock && planStock}
								<p class="mb-2 text-[11px] text-zinc-400">
									{previewingShared ? 'From the shared link' : 'Only this plan uses these'} · blank qty
									= ∞
								</p>
								{@render boardStockList(planStock)}
							{:else}
								{@render stockSummary('linear')}
							{/if}
						</section>

						<!-- Cut list -->
						<section>
							<div class="mb-2.5 flex items-baseline justify-between gap-2">
								<div class="flex items-baseline gap-2">
									<h2
										class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
									>
										Cut list
									</h2>
									<span class="text-xs text-zinc-400 tabular-nums">{linearPieces.length}</span>
								</div>
								{@render csvActions('parts', partsCount > 0)}
							</div>
							{#each linearPieces as lp (lp.id)}
								<div class={cardCls}>
									<div class="flex items-center gap-2">
										<span
											class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
											style="background:{pieceColor(lp.id)}"
										></span>
										<input
											type="text"
											class="{inputBase} flex-1"
											placeholder="Label (optional)"
											bind:value={lp.label}
										/>
										<button
											onclick={() => removeLinearPiece(lp.id)}
											class={delCls}
											aria-label="Remove"
										>
											<svg
												width="14"
												height="14"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												stroke-width="1.6"
												stroke-linecap="round"
												stroke-linejoin="round"
												><path
													d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
												/></svg
											>
										</button>
									</div>
									{#if showMaterialPicker(lp, linearMaterials)}
										<div class="mt-2.5">{@render materialPicker(lp, linearMaterials)}</div>
									{/if}
									<div class="mt-2.5 flex items-end gap-3">
										<label class="flex min-w-0 flex-1 flex-col gap-1">
											<span
												class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
												>Length ({unit})</span
											>
											<input
												type="number"
												inputmode="decimal"
												class={numBase}
												min={dimMin}
												step={dimStep}
												bind:value={lp.length}
											/>
										</label>
										<div class="flex flex-col gap-1">
											<span
												class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
												>Qty</span
											>
											<div class="flex items-stretch">
												<button
													type="button"
													class="{stepBtnCls} rounded-l-lg"
													onclick={() => {
														if (lp.quantity > 1) lp.quantity -= 1;
													}}>−</button
												>
												<input
													type="number"
													inputmode="numeric"
													min="1"
													bind:value={lp.quantity}
													class={stepInputCls}
												/>
												<button
													type="button"
													class="{stepBtnCls} rounded-r-lg"
													onclick={() => {
														lp.quantity += 1;
													}}>+</button
												>
											</div>
										</div>
									</div>
								</div>
							{/each}
							<button onclick={addLinearPiece} class={addBtnCls}>
								<svg
									width="14"
									height="14"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
								>
								Add piece
							</button>
						</section>

						{#if linearUnplaced.length > 0}
							<div class="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
								<p class="mb-1.5 text-xs font-semibold text-amber-800">
									Could not place all pieces
								</p>
								<ul class="space-y-1">
									{#each linearUnplaced as item (item.key)}
										<li class="text-xs text-amber-700">
											{item.count > 1 ? `${item.count}× ` : ''}"{item.label}" — {item.reason ===
											'too_large'
												? 'too long to fit in any stock'
												: item.reason === 'no_matching_stock'
													? `no “${item.material}” in stock`
													: 'not enough stock available'}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Right pane: results -->
		<div class="flex flex-col bg-zinc-50/70 lg:min-h-0 lg:overflow-hidden">
			{#if hasResults}
				<!-- Sticky results sub-header -->
				<div
					class="sticky top-14 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200/70 bg-zinc-50/90 px-4 py-3 backdrop-blur lg:top-0 lg:px-6"
				>
					<div class="flex flex-wrap items-center gap-1.5">
						{#if mode === 'sheet'}
							{#each sheetSummary as row (row.id)}
								<div
									class="flex items-baseline gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 whitespace-nowrap shadow-sm"
								>
									<span class="text-base font-semibold text-zinc-900 tabular-nums">{row.count}</span
									>
									<span class="inline-flex items-baseline gap-1 text-xs text-zinc-500">
										<span>×</span>
										{#if row.name}<span class="font-medium text-zinc-700">{row.name}</span>{/if}
										<span>{row.w}×{row.h}{unitLabel}</span>
									</span>
								</div>
							{/each}
						{:else}
							{#each linearSummary as row (row.id)}
								<div
									class="flex items-baseline gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 whitespace-nowrap shadow-sm"
								>
									<span class="text-base font-semibold text-zinc-900 tabular-nums">{row.count}</span
									>
									<span class="inline-flex items-baseline gap-1 text-xs text-zinc-500">
										<span>×</span>
										{#if row.name}<span class="font-medium text-zinc-700">{row.name}</span>{/if}
										<span>{row.length}{unitLabel}</span>
									</span>
								</div>
							{/each}
						{/if}
						{#if wastePctTotal != null}
							<div class="flex items-baseline gap-1.5 rounded-lg px-1 py-1.5">
								<span class="text-base font-semibold text-zinc-900 tabular-nums"
									>{wastePctTotal}%</span
								>
								<span class="text-xs text-zinc-500">waste</span>
							</div>
						{/if}
					</div>
					<div class="ml-auto flex items-center gap-1.5">
						{#if mode === 'sheet'}
							<div class="hidden items-center gap-1 sm:flex">
								<button
									onclick={() => (sheetZoom = Math.max(0.25, sheetZoom - 0.25))}
									class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-base leading-none text-zinc-600 hover:bg-zinc-50"
									aria-label="Zoom out">−</button
								>
								<span class="w-9 text-center text-xs text-zinc-500 tabular-nums"
									>{Math.round(sheetZoom * 100)}%</span
								>
								<button
									onclick={() => (sheetZoom = Math.min(4, sheetZoom + 0.25))}
									class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-base leading-none text-zinc-600 hover:bg-zinc-50"
									aria-label="Zoom in">+</button
								>
							</div>
						{/if}
					</div>
				</div>

				<!-- Diagrams -->
				<div class="px-4 pt-5 pb-28 lg:flex-1 lg:overflow-y-auto lg:px-6 lg:pb-5">
					{#if mode === 'sheet'}
						<div class="flex flex-wrap gap-4">
							{#each sheets as sheet (sheet.index)}
								{@const sc = svgScale(sheet.sheetWidth, sheet.sheetHeight) * sheetZoom}
								{@const svgW = sheet.sheetWidth * sc}
								{@const svgH = sheet.sheetHeight * sc}
								{@const sheetIsHoriz = sheet.grain === 'horizontal'}
								{@const grainSpan = sheetIsHoriz ? svgH : svgW}
								{@const grainCount = Math.max(1, Math.floor(grainSpan / 14) - 1)}
								<div class="rounded-2xl border border-zinc-300 bg-white p-3.5 shadow-sm">
									<div class="mb-2 flex items-center justify-between gap-3">
										<p class="text-xs font-medium text-zinc-700">
											Sheet {sheet.index + 1}
											<span class="text-zinc-400">· {sheetCardDetail(sheet)}</span>
										</p>
										<div class="flex items-center gap-1.5">
											{#if sheet.cuts}
												<span
													class="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500 tabular-nums"
													>{sheet.cuts.length} cuts</span
												>
											{/if}
											<span
												class="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 tabular-nums"
												>{sheet.wastePercent}% waste</span
											>
										</div>
									</div>
									<svg
										viewBox="0 0 {svgW} {svgH}"
										width={svgW}
										height={svgH}
										style="display:block;overflow:hidden;max-width:100%;height:auto"
									>
										<rect width={svgW} height={svgH} fill="#f4f4f5" rx="3" />
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
											{#if pw > 16}
												{@const wfs = Math.max(6, Math.min(9 * sheetZoom, pw / 6))}
												<text
													x={px + pw / 2}
													y={py + 3}
													text-anchor="middle"
													dominant-baseline="hanging"
													font-size={wfs}
													fill="#18181b"
													font-family="Inter, system-ui, sans-serif"
													opacity="0.7">{p.width}{unitLabel}</text
												>
											{/if}
											{#if ph > 20}
												{@const hfs = Math.max(6, Math.min(9 * sheetZoom, ph / 6))}
												{@const hx = px + Math.ceil(hfs / 2) + 2}
												<text
													x={hx}
													y={py + ph / 2}
													text-anchor="middle"
													dominant-baseline="middle"
													font-size={hfs}
													fill="#18181b"
													font-family="Inter, system-ui, sans-serif"
													opacity="0.7"
													transform="rotate(-90 {hx} {py + ph / 2})">{p.height}{unitLabel}</text
												>
											{/if}
											{#if pw > 30 && ph > 18 && p.label}
												{@const fs = Math.min(11 * sheetZoom, pw / 5, ph / 3)}
												<text
													x={px + pw / 2}
													y={py + ph / 2}
													text-anchor="middle"
													dominant-baseline="middle"
													font-size={fs}
													fill="#18181b"
													font-family="Inter, system-ui, sans-serif"
													font-weight="600">{p.label}{p.rotated ? ' ↺' : ''}</text
												>
											{/if}
										{/each}
										{#if sheet.cuts}
											{#each sheet.cuts as c (c.order)}
												{@const cpos = (c.pos + kerf / 2) * sc}
												{@const c1 = c.start * sc}
												{@const c2 = c.end * sc}
												{@const br = Math.max(6.5, Math.min(9, 6.5 * sheetZoom))}
												{@const bx = c.direction === 'horizontal' ? c1 + br + 2 : cpos}
												{@const by = c.direction === 'horizontal' ? cpos : c1 + br + 2}
												{@const bcx = Math.min(Math.max(bx, br + 1), svgW - br - 1)}
												{@const bcy = Math.min(Math.max(by, br + 1), svgH - br - 1)}
												<line
													x1={c.direction === 'horizontal' ? c1 : cpos}
													y1={c.direction === 'horizontal' ? cpos : c1}
													x2={c.direction === 'horizontal' ? c2 : cpos}
													y2={c.direction === 'horizontal' ? cpos : c2}
													stroke="#dc2626"
													stroke-width="1"
													stroke-dasharray="4 3"
													opacity="0.85"
												/>
												<circle cx={bcx} cy={bcy} r={br} fill="#dc2626" />
												<text
													x={bcx}
													y={bcy}
													text-anchor="middle"
													dominant-baseline="central"
													font-size={br * 1.15}
													fill="white"
													font-family="Inter, system-ui, sans-serif"
													font-weight="600">{c.order}</text
												>
											{/each}
										{/if}
									</svg>
								</div>
							{/each}
						</div>
					{:else}
						<div class="space-y-3">
							{#each linearBoards as board (board.index)}
								{@const sc = linearScale}
								{@const svgW = board.stockLength * sc}
								<div class="rounded-2xl border border-zinc-300 bg-white p-3.5 shadow-sm">
									<p class="mb-2 text-xs font-medium text-zinc-700">
										Stock {board.index + 1}
										<span class="text-zinc-400">· {boardCardDetail(board)}</span>
										{#if board.stockLength - board.usedLength > 0}
											<span class="ml-2 text-zinc-400"
												>{Math.round((board.stockLength - board.usedLength) * 100) / 100}{unitLabel} remaining</span
											>
										{/if}
									</p>
									<div class="overflow-x-auto">
										<svg
											width={svgW}
											height={40}
											style="display:block;border-radius:6px;overflow:hidden;min-width:100%"
										>
											<rect x={0} y={0} width={svgW} height={40} fill="#f4f4f5" />
											{#each board.placements as p (`${p.pieceId}-${p.start}`)}
												{@const px = p.start * sc}
												{@const pw = p.length * sc}
												<rect
													x={px + 0.5}
													y={0.5}
													width={Math.max(0, pw - 1)}
													height={39}
													fill={pieceColor(p.pieceId)}
													rx="3"
												/>
												{#if pw > 20}
													<text
														x={px + pw / 2}
														y={20}
														text-anchor="middle"
														dominant-baseline="middle"
														font-size={Math.min(10, pw / 3)}
														fill="#18181b"
														font-family="Inter, system-ui, sans-serif"
														font-weight="600">{p.label || '?'}</text
													>
												{/if}
											{/each}
										</svg>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<!-- Empty state -->
				<div class="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
					<div
						class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-zinc-300 shadow-sm ring-1 ring-zinc-200/70"
					>
						<svg
							width="28"
							height="28"
							viewBox="0 0 22 22"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="11" cy="11" r="7.5" />
							<circle cx="11" cy="11" r="2" />
						</svg>
					</div>
					<p class="text-sm font-medium text-zinc-500">No layout yet</p>
					<p class="mt-1 max-w-[15rem] text-[13px] text-zinc-400">
						{mode === 'sheet'
							? 'Add at least one sheet size and a panel to see your cut layout.'
							: 'Add a stock length and a piece to see your cut layout.'}
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Shop stock drawer -->
	<div
		class="stock-scrim fixed inset-0 z-40 bg-black/40 lg:hidden"
		class:open={stockOpen}
		onclick={closeStock}
		role="presentation"
	></div>
	<div
		id="stock-drawer"
		class="stock-drawer fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] lg:z-20 lg:max-h-[min(70vh,640px)] lg:min-h-[200px] lg:rounded-none lg:border-t lg:border-zinc-200 lg:shadow-[0_-6px_20px_rgba(0,0,0,0.05)]"
		class:open={stockOpen}
		class:peek={stockBar}
		class:dragging
		bind:this={stockDrawerEl}
		bind:offsetHeight={drawerHeight}
		style:transform={swipeY ? `translateY(${swipeY}px)` : undefined}
		inert={!stockOpen && !stockBar}
		role={isDesktop ? 'region' : 'dialog'}
		aria-modal={isDesktop ? undefined : true}
		aria-label="My shop stock"
	>
		{#if stockBar && !stockOpen}
			<!-- Collapsed: the bar is the drawer's own top edge, so it opens right where you click -->
			<button
				onclick={() => openStock()}
				aria-expanded="false"
				aria-controls="stock-drawer"
				class="group flex h-[39px] w-full shrink-0 items-center gap-3 px-6 text-left transition-colors hover:bg-zinc-50"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linejoin="round"
					class="shrink-0 text-zinc-400"
					aria-hidden="true"
					><rect x="2" y="3" width="12" height="3" rx="0.8" /><rect
						x="2"
						y="7.5"
						width="12"
						height="3"
						rx="0.8"
					/><path d="M2.8 12h10.4" stroke-linecap="round" /></svg
				>
				<span class="shrink-0 text-[13px] font-semibold tracking-tight text-zinc-900"
					>My shop stock</span
				>
				<span class="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
					{#each mode === 'sheet' ? shopStock.sheetTypes : shopStock.linearStocks as it (it.id)}
						<span
							class="inline-flex shrink-0 items-baseline gap-1 rounded-md bg-zinc-100 px-1.5 py-px text-[11.5px] whitespace-nowrap text-zinc-600 tabular-nums"
						>
							{#if stockName(it, unit)}<span class="font-medium text-zinc-800"
									>{stockName(it, unit)}</span
								>{/if}
							{'length' in it ? `${it.length}` : `${it.width}×${it.height}`}{unitLabel}
							<span class="text-zinc-400">{it.quantity ? `×${it.quantity}` : '∞'}</span>
						</span>
					{:else}
						<span class="text-xs text-zinc-400"
							>No {mode === 'sheet' ? 'sheet sizes' : 'stock lengths'} yet</span
						>
					{/each}
				</span>
				{#if useCustomStock}
					<span
						class="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200"
						>This plan uses its own stock</span
					>
				{/if}
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="shrink-0 text-zinc-400 group-hover:text-zinc-800"
					aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg
				>
			</button>
		{:else}
			<!-- Handle (phones): swipe down to dismiss. Close button and Escape cover keyboards. -->
			<div
				class="flex shrink-0 touch-none justify-center pt-2.5 pb-1.5 lg:hidden"
				aria-hidden="true"
				onpointerdown={onHandleDown}
				onpointermove={onHandleMove}
				onpointerup={onHandleUp}
				onpointercancel={onHandleUp}
			>
				<div class="h-1.5 w-10 rounded-full bg-zinc-200"></div>
			</div>
			<div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-3 lg:px-6 lg:pt-2.5">
				<h2 class="text-sm font-semibold tracking-tight text-zinc-900">My shop stock</h2>
				{#if useCustomStock}
					<span
						class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200"
						title="Changes here won't affect the layout you're looking at"
						>“{currentName}” uses its own stock</span
					>
				{:else}
					<span class="hidden text-xs text-zinc-400 xl:inline"
						>What you keep on hand. Every plan uses this unless it has its own stock.</span
					>
				{/if}
				<div class="ml-auto flex items-center gap-1">
					{@render csvActions('stock', shopStockCount > 0)}
					<button
						onclick={closeStock}
						aria-label="Collapse my shop stock"
						class="press -mr-1.5 ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg
						>
					</button>
				</div>
			</div>
		{/if}
		<div
			inert={!stockOpen}
			class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-zinc-100 px-4 pt-4 pb-8 lg:px-6"
			style="padding-bottom: max(2rem, env(safe-area-inset-bottom))"
		>
			<!-- Only the stock the current mode packs from: editor, then the same items drawn to scale -->
			<div class="grid gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<section>
					{#if mode === 'sheet'}
						{@render stockSectionHead('Sheet stock', shopStock.sheetTypes.length)}
						{#if isDesktop}
							{@render sheetStockRows(shopStock)}
						{:else}
							{@render sheetStockList(shopStock)}
						{/if}
					{:else}
						{@render stockSectionHead('Linear stock', shopStock.linearStocks.length)}
						{#if isDesktop}
							{@render boardStockRows(shopStock)}
						{:else}
							{@render boardStockList(shopStock)}
						{/if}
					{/if}
				</section>
				<section>
					<h3
						class="mb-2 text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase xl:mb-3"
					>
						Drawn to scale
					</h3>
					{@render stockInventory(mode)}
				</section>
			</div>
		</div>
	</div>

	<!-- Mobile bottom bar -->
	<nav
		class="fixed right-0 bottom-0 left-0 z-30 flex border-t border-zinc-200 bg-white/95 backdrop-blur lg:hidden"
		style="padding-bottom: env(safe-area-inset-bottom)"
	>
		<button
			onclick={() => hasResults && (shareOpen = true)}
			disabled={!hasResults}
			class="flex flex-1 flex-col items-center gap-0.5 py-2.5 {hasResults
				? 'text-zinc-500'
				: 'text-zinc-300'}"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 22 22"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M11 3v12M7 7l4-4 4 4" /><path
					d="M5 13v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5"
				/></svg
			>
			<span class="text-[11px] font-medium">Share</span>
		</button>
		<button
			onclick={() => openStock()}
			disabled={previewingShared}
			title={previewingShared ? 'A shared plan brings its own stock' : undefined}
			class="flex flex-1 flex-col items-center gap-0.5 py-2.5 {previewingShared
				? 'text-zinc-300'
				: 'text-zinc-500'}"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.1"
				stroke-linejoin="round"
				aria-hidden="true"
				><rect x="2" y="3" width="12" height="3" rx="0.8" /><rect
					x="2"
					y="7.5"
					width="12"
					height="3"
					rx="0.8"
				/><path d="M2.8 12h10.4" stroke-linecap="round" /></svg
			>
			<span class="text-[11px] font-medium">Stock</span>
		</button>
		<button
			onclick={() => (settingsOpen = true)}
			class="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-zinc-500"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 22 22"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				aria-hidden="true"
				><line x1="3" y1="6" x2="19" y2="6" /><line x1="3" y1="11" x2="19" y2="11" /><line
					x1="3"
					y1="16"
					x2="19"
					y2="16"
				/><circle cx="8" cy="6" r="2.2" fill="white" /><circle cx="8" cy="6" r="2.2" /><circle
					cx="14"
					cy="11"
					r="2.2"
					fill="white"
				/><circle cx="14" cy="11" r="2.2" /><circle cx="9" cy="16" r="2.2" fill="white" /><circle
					cx="9"
					cy="16"
					r="2.2"
				/></svg
			>
			<span class="text-[11px] font-medium">Settings</span>
		</button>
	</nav>

	<!-- Settings drawer -->
	{#if settingsOpen}
		<div
			class="fixed inset-0 z-40 bg-black/40 lg:hidden"
			transition:fade={{ duration: 200 }}
			onclick={() => (settingsOpen = false)}
			role="presentation"
		></div>
		<div
			class="fixed right-0 bottom-0 left-0 z-50 rounded-t-2xl bg-white px-6 pt-4 pb-10 lg:hidden"
			transition:fly={{ y: 380, duration: 320, easing: cubicOut }}
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
		>
			<div class="mx-auto mb-6 h-1.5 w-10 rounded-full bg-zinc-200"></div>
			<div class="space-y-6">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-zinc-700">Mode</span>
					<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
						<button
							onclick={() => {
								mode = 'sheet';
								settingsOpen = false;
							}}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {mode ===
							'sheet'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">Sheet</button
						>
						<button
							onclick={() => {
								mode = 'linear';
								settingsOpen = false;
							}}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {mode ===
							'linear'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">Linear</button
						>
					</div>
				</div>
				{#if mode === 'sheet'}
					<div class="flex items-center justify-between">
						<span class="text-sm font-medium text-zinc-700">Saw</span>
						<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
							<button
								onclick={() => (cutMethod = 'nested')}
								class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {cutMethod ===
								'nested'
									? 'bg-white text-zinc-900 shadow-sm'
									: 'text-zinc-500'}">CNC</button
							>
							<button
								onclick={() => (cutMethod = 'guillotine')}
								class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {cutMethod ===
								'guillotine'
									? 'bg-white text-zinc-900 shadow-sm'
									: 'text-zinc-500'}">Track saw</button
							>
						</div>
					</div>
				{/if}
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-zinc-700">Unit</span>
					<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
						<button
							onclick={() => setUnit('in')}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {unit === 'in'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">Inches</button
						>
						<button
							onclick={() => setUnit('mm')}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {unit === 'mm'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">mm</button
						>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-zinc-700">Kerf width</span>
					<label class="flex items-center gap-2 text-sm text-zinc-600">
						<input
							type="text"
							inputmode="decimal"
							value={kerf}
							onblur={applyKerf}
							class="w-24 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-right text-base text-zinc-900 tabular-nums"
						/>
						<span class="text-zinc-400">{unit}</span>
					</label>
				</div>
				<div class="border-t border-zinc-100 pt-4">
					<button
						onclick={() => {
							settingsOpen = false;
							clearPlan();
						}}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
							/></svg
						>
						Clear this plan
					</button>
					<div class="mt-5 flex items-center justify-center gap-2.5 text-xs text-zinc-400">
						<a
							href="https://walkersutton.com"
							target="_blank"
							rel="noopener noreferrer"
							class="footer-link">built by Walker</a
						>
						<span
							class="h-[2px] w-[2px] shrink-0 translate-y-[1px] rounded-full bg-zinc-300"
							aria-hidden="true"
						></span>
						<a
							href="https://github.com/walkersutton/cutlist"
							target="_blank"
							rel="noopener noreferrer"
							class="footer-link inline-flex items-center gap-1.5"
						>
							<svg
								width="11"
								height="11"
								class="shrink-0"
								viewBox="0 0 16 16"
								fill="currentColor"
								aria-hidden="true"
								><path
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
								/></svg
							>
							Source
						</a>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Share sheet -->
	{#if importFrom}
		<CsvImportDialog
			{unit}
			target={importFrom}
			stockLabel={!stockOpen && useCustomStock ? "This plan's stock" : 'My shop stock'}
			onimport={applyImport}
			onclose={() => (importFrom = null)}
		/>
	{/if}
	{#if exportData}
		<CsvExportDialog
			{...exportData}
			ondownload={() => downloadCsv(exportData.csv, exportData.fileName)}
			onclose={() => (exportFrom = null)}
		/>
	{/if}

	{#if shareOpen}
		<div
			class="fixed inset-0 z-40 bg-black/40 lg:hidden"
			transition:fade={{ duration: 200 }}
			onclick={() => (shareOpen = false)}
			role="presentation"
		></div>
		<div
			class="fixed right-0 bottom-0 left-0 z-50 rounded-t-2xl bg-white px-6 pt-4 pb-10 lg:hidden"
			transition:fly={{ y: 200, duration: 280, easing: cubicOut }}
			role="dialog"
			aria-modal="true"
			aria-label="Share"
		>
			<div class="mx-auto mb-6 h-1.5 w-10 rounded-full bg-zinc-200"></div>
			<div class="space-y-1">
				<button
					onclick={() => {
						printPlan();
						shareOpen = false;
					}}
					class="flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 22 22"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 text-zinc-500"
						aria-hidden="true"
						><path d="M6 7V3h10v4" /><rect x="2" y="7" width="18" height="8" rx="1.5" /><path
							d="M6 15h10v4H6z"
						/></svg
					>
					<div>
						<p class="text-sm font-medium">Print / PDF</p>
						<p class="text-xs text-zinc-400">Preview, then print or save as PDF</p>
					</div>
				</button>
				<button
					onclick={async () => {
						await shareLink();
						shareOpen = false;
					}}
					class="flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 text-zinc-500"
						aria-hidden="true"
						><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.8.8" /><path
							d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.1 9.2a2.6 2.6 0 0 0 3.7 3.7l.8-.8"
						/></svg
					>
					<div>
						<p class="text-sm font-medium">Share link</p>
						<p class="text-xs text-zinc-400">Opens this plan in their browser</p>
					</div>
				</button>
				<button
					onclick={async () => {
						await copyPlan();
						shareOpen = false;
					}}
					class="flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 22 22"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 text-zinc-500"
						aria-hidden="true"
						><rect x="8" y="8" width="11" height="13" rx="1.5" /><path
							d="M14 8V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h4"
						/></svg
					>
					<div>
						<p class="text-sm font-medium">Copy as text</p>
						<p class="text-xs text-zinc-400">Paste into any app</p>
					</div>
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	@media (hover: hover) and (pointer: fine) {
		.del {
			opacity: 0;
		}
		.row:hover .del,
		.row:focus-within .del {
			opacity: 1;
		}
	}
	.del {
		transition:
			opacity 120ms ease,
			color 120ms ease,
			background-color 120ms ease;
	}
	.footer-link {
		transition: color 150ms ease;
	}
	/* Shop stock drawer. Transitions rather than keyframes, so a quick re-toggle retargets
	   mid-slide. Opens on an iOS-style drawer curve; closes faster than it opens. */
	.stock-drawer {
		transform: translateY(calc(100% + 24px));
		visibility: hidden;
		transition:
			transform 200ms cubic-bezier(0.23, 1, 0.32, 1),
			visibility 0s linear 200ms;
	}
	/* Desktop: collapsed to the 40px bar instead of hidden */
	.stock-drawer.peek {
		transform: translateY(calc(100% - 40px));
		visibility: visible;
		transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.stock-drawer.open {
		transform: translateY(0);
		visibility: visible;
		transition:
			transform 300ms cubic-bezier(0.32, 0.72, 0, 1),
			visibility 0s;
	}
	.stock-drawer.dragging {
		transition: none;
	}
	.stock-scrim {
		opacity: 0;
		pointer-events: none;
		transition: opacity 200ms ease;
	}
	.stock-scrim.open {
		opacity: 1;
		pointer-events: auto;
	}
	@media (prefers-reduced-motion: reduce) {
		/* The phone sheet fades instead of sliding; the desktop bar just snaps open. */
		.stock-drawer:not(.peek) {
			transform: none;
			opacity: 0;
			transition:
				opacity 150ms ease,
				visibility 0s linear 150ms;
		}
		.stock-drawer.open:not(.peek) {
			opacity: 1;
			transition:
				opacity 150ms ease,
				visibility 0s;
		}
		.stock-drawer.peek {
			transition: none;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.plan-actions {
			opacity: 0;
			transition: opacity 120ms ease;
		}
		.plan-row:hover .plan-actions,
		.plan-row:focus-within .plan-actions {
			opacity: 1;
		}
	}
	.press {
		transition:
			transform 140ms cubic-bezier(0.23, 1, 0.32, 1),
			color 150ms ease,
			background-color 150ms ease;
	}
	.press:active {
		transform: scale(0.97);
	}
	.swap {
		transition:
			opacity 180ms ease,
			filter 180ms ease,
			transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.swap.out {
		opacity: 0;
		filter: blur(2px);
		transform: translateY(2px);
	}
	@media (prefers-reduced-motion: reduce) {
		.swap.out {
			transform: none;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.footer-link:hover {
			color: #18181b;
		}
	}
</style>
