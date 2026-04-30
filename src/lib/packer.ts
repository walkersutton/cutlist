export type GrainDirection = 'horizontal' | 'vertical' | 'any';

export interface SheetType {
	id: string;
	width: number;
	height: number;
	quantity: number; // 0 = unlimited
	grain: GrainDirection;
}

export interface PanelInput {
	id: string;
	width: number;
	height: number;
	quantity: number;
	grain: GrainDirection;
	label: string;
}

export interface PlacedPanel {
	panelId: string;
	label: string;
	grain: GrainDirection;
	x: number;
	y: number;
	width: number;
	height: number;
	rotated: boolean;
}

export interface Sheet {
	index: number;
	sheetWidth: number;
	sheetHeight: number;
	grain: GrainDirection;
	placements: PlacedPanel[];
	wastePercent: number;
}

export interface UnplacedPanel {
	panel: PanelInput;
	reason: 'too_large' | 'stock_exhausted';
}

export interface PackResult {
	sheets: Sheet[];
	unplaced: UnplacedPanel[];
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function splitRect(free: Rect, placed: Rect): Rect[] {
	const result: Rect[] = [];
	if (placed.x > free.x)
		result.push({ x: free.x, y: free.y, width: placed.x - free.x, height: free.height });
	if (placed.x + placed.width < free.x + free.width)
		result.push({
			x: placed.x + placed.width,
			y: free.y,
			width: free.x + free.width - placed.x - placed.width,
			height: free.height
		});
	if (placed.y > free.y)
		result.push({ x: free.x, y: free.y, width: free.width, height: placed.y - free.y });
	if (placed.y + placed.height < free.y + free.height)
		result.push({
			x: free.x,
			y: placed.y + placed.height,
			width: free.width,
			height: free.y + free.height - placed.y - placed.height
		});
	return result;
}

function isContained(inner: Rect, outer: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function pruneContained(rects: Rect[]): Rect[] {
	return rects.filter((r, i) => !rects.some((other, j) => j !== i && isContained(r, other)));
}

function scoreShortSide(free: Rect, w: number, h: number): number {
	const shortSide = Math.min(free.width - w, free.height - h);
	const longSide = Math.max(free.width - w, free.height - h);
	return shortSide * 1000 + longSide;
}

function tryPlace(freeRects: Rect[], w: number, h: number): { rect: Rect; score: number } | null {
	let best: { rect: Rect; score: number } | null = null;
	for (const f of freeRects) {
		if (f.width >= w && f.height >= h) {
			const score = scoreShortSide(f, w, h);
			if (!best || score < best.score) {
				best = { rect: { x: f.x, y: f.y, width: w, height: h }, score };
			}
		}
	}
	return best;
}

function allowedOrientations(
	panel: PanelInput,
	sheetType: SheetType
): Array<{ w: number; h: number; rotated: boolean }> {
	const orientations: Array<{ w: number; h: number; rotated: boolean }> = [];

	if (panel.grain === 'any' || sheetType.grain === 'any') {
		orientations.push({ w: panel.width, h: panel.height, rotated: false });
		if (panel.width !== panel.height) {
			orientations.push({ w: panel.height, h: panel.width, rotated: true });
		}
	} else {
		if (panel.grain === sheetType.grain) {
			orientations.push({ w: panel.width, h: panel.height, rotated: false });
		} else {
			orientations.push({ w: panel.height, h: panel.width, rotated: true });
		}
	}
	return orientations;
}

interface OpenSheet {
	type: SheetType;
	freeRects: Rect[];
	placements: PlacedPanel[];
}

// kerf: placed panel records actual size; free-rect splitting uses size+kerf so blade width is reserved
function applyPlacement(
	sheet: OpenSheet,
	rect: Rect,
	panel: PanelInput,
	rotated: boolean,
	kerf: number
) {
	sheet.placements.push({
		panelId: panel.id,
		label: panel.label,
		grain: panel.grain,
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
		rotated
	});
	const occupied: Rect = {
		x: rect.x,
		y: rect.y,
		width: rect.width + kerf,
		height: rect.height + kerf
	};
	const newFree: Rect[] = [];
	for (const free of sheet.freeRects) {
		if (rectsOverlap(free, occupied)) {
			newFree.push(...splitRect(free, occupied));
		} else {
			newFree.push(free);
		}
	}
	sheet.freeRects.length = 0;
	sheet.freeRects.push(...pruneContained(newFree));
}

export function pack(sheetTypes: SheetType[], panels: PanelInput[], kerf = 0): PackResult {
	const validTypes = sheetTypes.filter((t) => t.width > 0 && t.height > 0);
	if (!validTypes.length || !panels.length) return { sheets: [], unplaced: [] };

	const pieces: Array<{ panel: PanelInput }> = [];
	for (const panel of panels) {
		if (panel.width > 0 && panel.height > 0 && panel.quantity > 0) {
			for (let q = 0; q < panel.quantity; q++) pieces.push({ panel });
		}
	}
	if (!pieces.length) return { sheets: [], unplaced: [] };
	pieces.sort((a, b) => b.panel.width * b.panel.height - a.panel.width * a.panel.height);

	const remaining = new Map<string, number>(
		validTypes.map((t) => [t.id, t.quantity === 0 ? Infinity : t.quantity])
	);

	const openSheets: OpenSheet[] = [];
	const unplaced: UnplacedPanel[] = [];

	function fitsInAnyType(panel: PanelInput): boolean {
		return validTypes.some((type) => {
			const orientations = allowedOrientations(panel, type);
			return orientations.some(({ w, h }) => type.width >= w && type.height >= h);
		});
	}

	function chooseBestType(panel: PanelInput): SheetType | null {
		let best: { type: SheetType; area: number } | null = null;
		for (const type of validTypes) {
			if ((remaining.get(type.id) ?? 0) <= 0) continue;
			const orientations = allowedOrientations(panel, type);
			for (const { w, h } of orientations) {
				if (type.width >= w && type.height >= h) {
					const area = type.width * type.height;
					if (!best || area < best.area) best = { type, area };
					break;
				}
			}
		}
		return best?.type ?? null;
	}

	for (const { panel } of pieces) {
		let best: { sheet: OpenSheet; rect: Rect; rotated: boolean; score: number } | null = null;
		for (const sheet of openSheets) {
			const orientations = allowedOrientations(panel, sheet.type);
			for (const { w, h, rotated } of orientations) {
				const candidate = tryPlace(sheet.freeRects, w, h);
				if (candidate && (!best || candidate.score < best.score)) {
					best = {
						sheet,
						rect: { x: candidate.rect.x, y: candidate.rect.y, width: w, height: h },
						rotated,
						score: candidate.score
					};
				}
			}
		}

		if (best) {
			applyPlacement(best.sheet, best.rect, panel, best.rotated, kerf);
			continue;
		}

		// No open sheet fits — open a new one
		const type = chooseBestType(panel);
		if (!type) {
			unplaced.push({ panel, reason: fitsInAnyType(panel) ? 'stock_exhausted' : 'too_large' });
			continue;
		}

		remaining.set(type.id, (remaining.get(type.id) ?? 0) - 1);
		const newSheet: OpenSheet = {
			type,
			freeRects: [{ x: 0, y: 0, width: type.width, height: type.height }],
			placements: []
		};
		openSheets.push(newSheet);

		const orientations = allowedOrientations(panel, type);
		for (const { w, h, rotated } of orientations) {
			const candidate = tryPlace(newSheet.freeRects, w, h);
			if (candidate) {
				applyPlacement(
					newSheet,
					{ x: candidate.rect.x, y: candidate.rect.y, width: w, height: h },
					panel,
					rotated,
					kerf
				);
				break;
			}
		}
	}

	const sheets = openSheets.map((sheet, index) => {
		const sheetArea = sheet.type.width * sheet.type.height;
		const usedArea = sheet.placements.reduce((s, p) => s + p.width * p.height, 0);
		return {
			index,
			sheetWidth: sheet.type.width,
			sheetHeight: sheet.type.height,
			grain: sheet.type.grain,
			placements: sheet.placements,
			wastePercent: Math.round((1 - usedArea / sheetArea) * 100)
		};
	});
	return { sheets, unplaced };
}
