import {
	allowedOrientations,
	type CutLine,
	type PackResult,
	type PanelInput,
	type PlacedPanel,
	type Sheet,
	type SheetType,
	type UnplacedPanel
} from './packer.js';

const EPS = 1e-6;

// Guillotine packing: staged strip breakdown so every part is freed by full straight
// cuts. Strips run along one axis (both axes are tried per sheet, best yield wins):
//   stage 1: rip the sheet into strips (strip height = its largest piece)
//   stage 2: crosscut each strip into columns
//   stage 3: cut stacked pieces apart within a column
//   stage 4: trim stacked pieces narrower than their column
// Cuts are numbered stage-by-stage, so each sheet needs at most 3 saw-direction changes.

interface Orientation {
	w: number;
	h: number;
	rotated: boolean;
}

// Cut in strip-local coordinates: u advances along a strip, v across strips.
interface RawCut {
	depth: 1 | 2 | 3 | 4;
	constant: 'u' | 'v';
	pos: number;
	start: number;
	end: number;
}

interface Layout {
	placements: PlacedPanel[];
	cuts: CutLine[];
	usedIndices: number[];
	placedArea: number;
}

function fillSheet(type: SheetType, pool: PanelInput[], kerf: number, axis: 'x' | 'y'): Layout {
	// axis = direction strips advance in: 'y' = horizontal strips, 'x' = vertical strips.
	const U = axis === 'y' ? type.width : type.height;
	const V = axis === 'y' ? type.height : type.width;
	const along = (o: Orientation) => (axis === 'y' ? o.w : o.h);
	const across = (o: Orientation) => (axis === 'y' ? o.h : o.w);

	const used: boolean[] = new Array(pool.length).fill(false);
	const placements: PlacedPanel[] = [];
	const raw: RawCut[] = [];
	const usedIndices: number[] = [];
	let placedArea = 0;

	function place(i: number, o: Orientation, u: number, v: number) {
		const panel = pool[i];
		used[i] = true;
		usedIndices.push(i);
		placements.push({
			panelId: panel.id,
			label: panel.label,
			grain: panel.grain,
			x: axis === 'y' ? u : v,
			y: axis === 'y' ? v : u,
			width: o.w,
			height: o.h,
			rotated: o.rotated
		});
		placedArea += o.w * o.h;
	}

	// First unused piece (largest-first order) with an orientation fitting maxAlong × maxAcross;
	// `pick` breaks ties among that piece's fitting orientations.
	function findPiece(
		maxAlong: number,
		maxAcross: number,
		pick: (a: Orientation, b: Orientation) => Orientation
	): { index: number; o: Orientation } | null {
		for (let i = 0; i < pool.length; i++) {
			if (used[i]) continue;
			let best: Orientation | null = null;
			for (const o of allowedOrientations(pool[i], type)) {
				if (along(o) <= maxAlong + EPS && across(o) <= maxAcross + EPS) {
					best = best ? pick(best, o) : o;
				}
			}
			if (best) return { index: i, o: best };
		}
		return null;
	}

	const minAcross = (a: Orientation, b: Orientation) =>
		across(b) < across(a) - EPS || (across(b) < across(a) + EPS && along(b) > along(a)) ? b : a;
	const maxAcross = (a: Orientation, b: Orientation) =>
		across(b) > across(a) + EPS || (across(b) > across(a) - EPS && along(b) < along(a)) ? b : a;
	const maxAlong = (a: Orientation, b: Orientation) =>
		along(b) > along(a) + EPS || (along(b) > along(a) - EPS && across(b) > across(a)) ? b : a;

	let v = 0;
	while (v < V - EPS) {
		// Stage 1: seed a strip — lay the long side along the strip to keep it shallow
		const seed = findPiece(U, V - v, minAcross);
		if (!seed) break;
		const stripV = across(seed.o);
		place(seed.index, seed.o, 0, v);
		if (along(seed.o) < U - EPS) {
			raw.push({ depth: 2, constant: 'u', pos: along(seed.o), start: v, end: v + stripV });
		}
		let u = along(seed.o) + kerf;

		// Stage 2: fill the strip with columns — tallest fit uses the strip height best
		for (;;) {
			const cand = findPiece(U - u, stripV, maxAcross);
			if (!cand) break;
			const colU = along(cand.o);
			place(cand.index, cand.o, u, v);
			let cv = v + across(cand.o);
			if (across(cand.o) < stripV - EPS) {
				raw.push({ depth: 3, constant: 'v', pos: cv, start: u, end: u + colU });
			}
			cv += kerf;

			// Stage 3: stack smaller pieces in the space under this column's first piece
			for (;;) {
				const st = findPiece(colU, v + stripV - cv, maxAlong);
				if (!st) break;
				place(st.index, st.o, u, cv);
				if (along(st.o) < colU - EPS) {
					raw.push({
						depth: 4,
						constant: 'u',
						pos: u + along(st.o),
						start: cv,
						end: cv + across(st.o)
					});
				}
				if (cv + across(st.o) < v + stripV - EPS) {
					raw.push({
						depth: 3,
						constant: 'v',
						pos: cv + across(st.o),
						start: u,
						end: u + colU
					});
				}
				cv += across(st.o) + kerf;
			}

			if (u + colU < U - EPS) {
				raw.push({ depth: 2, constant: 'u', pos: u + colU, start: v, end: v + stripV });
			}
			u += colU + kerf;
		}

		if (v + stripV < V - EPS) {
			raw.push({ depth: 1, constant: 'v', pos: v + stripV, start: 0, end: U });
		}
		v += stripV + kerf;
	}

	const cuts = raw
		.slice()
		.sort((a, b) => a.depth - b.depth)
		.map((c, i) => ({
			order: i + 1,
			direction: (axis === 'y') === (c.constant === 'v') ? 'horizontal' : 'vertical',
			pos: c.pos,
			start: c.start,
			end: c.end,
			depth: c.depth
		})) satisfies CutLine[];

	return { placements, cuts, usedIndices, placedArea };
}

export function packGuillotine(
	sheetTypes: SheetType[],
	panels: PanelInput[],
	kerf: number
): PackResult {
	const validTypes = sheetTypes.filter((t) => t.width > 0 && t.height > 0);
	if (!validTypes.length || !panels.length) return { sheets: [], unplaced: [] };

	let pool: PanelInput[] = [];
	for (const panel of panels) {
		if (panel.width > 0 && panel.height > 0 && panel.quantity > 0) {
			for (let q = 0; q < panel.quantity; q++) pool.push(panel);
		}
	}
	if (!pool.length) return { sheets: [], unplaced: [] };
	pool.sort((a, b) => {
		const longDiff = Math.max(b.width, b.height) - Math.max(a.width, a.height);
		return longDiff !== 0 ? longDiff : b.width * b.height - a.width * a.height;
	});

	const remaining = new Map<string, number>(
		validTypes.map((t) => [t.id, t.quantity === 0 ? Infinity : t.quantity])
	);

	function fitsInAnyType(panel: PanelInput): boolean {
		return validTypes.some((type) =>
			allowedOrientations(panel, type).some(({ w, h }) => type.width >= w && type.height >= h)
		);
	}

	function chooseBestType(panel: PanelInput): SheetType | null {
		let best: { type: SheetType; area: number } | null = null;
		for (const type of validTypes) {
			if ((remaining.get(type.id) ?? 0) <= 0) continue;
			const fits = allowedOrientations(panel, type).some(
				({ w, h }) => type.width >= w && type.height >= h
			);
			if (fits) {
				const area = type.width * type.height;
				if (!best || area < best.area) best = { type, area };
			}
		}
		return best?.type ?? null;
	}

	const sheets: Sheet[] = [];
	const unplaced: UnplacedPanel[] = [];

	while (pool.length) {
		const seed = pool[0];
		const type = chooseBestType(seed);
		if (!type) {
			unplaced.push({ panel: seed, reason: fitsInAnyType(seed) ? 'stock_exhausted' : 'too_large' });
			pool.shift();
			continue;
		}

		const layoutY = fillSheet(type, pool, kerf, 'y');
		const layoutX = fillSheet(type, pool, kerf, 'x');
		let layout = layoutY;
		if (
			layoutX.placedArea > layoutY.placedArea + EPS ||
			(layoutX.placedArea > layoutY.placedArea - EPS && layoutX.cuts.length < layoutY.cuts.length)
		) {
			layout = layoutX;
		}

		if (!layout.placements.length) {
			unplaced.push({ panel: seed, reason: 'too_large' });
			pool.shift();
			continue;
		}

		remaining.set(type.id, (remaining.get(type.id) ?? 0) - 1);
		const usedSet = new Set(layout.usedIndices);
		pool = pool.filter((_, i) => !usedSet.has(i));

		const sheetArea = type.width * type.height;
		sheets.push({
			index: sheets.length,
			sheetWidth: type.width,
			sheetHeight: type.height,
			grain: type.grain,
			placements: layout.placements,
			wastePercent: Math.round((1 - layout.placedArea / sheetArea) * 100),
			cuts: layout.cuts
		});
	}

	return { sheets, unplaced };
}

export function formatCut(cut: CutLine, unitLabel: string): string {
	const fmt = (n: number) => `${Math.round(n * 1000) / 1000}${unitLabel}`;
	return `#${cut.order} ${cut.direction} at ${fmt(cut.pos)} (${fmt(cut.start)} → ${fmt(cut.end)})`;
}
