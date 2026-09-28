import {
	pack,
	type PackMethod,
	type PackResult,
	type PanelInput,
	type SheetType
} from './packer.js';
import {
	packLinear,
	type LinearPackResult,
	type LinearPiece,
	type LinearStock
} from './linear-packer.js';

/**
 * Identity of a material for matching parts to stock: case/whitespace-insensitive name plus
 * thickness. Returns '' for "no material" (any stock).
 */
export function materialKey(material?: string, thickness?: number): string {
	const name = (material ?? '').trim().toLowerCase();
	const t = thickness ? String(Math.round(thickness * 1000) / 1000) : '';
	return name || t ? `${name}|${t}` : '';
}

/**
 * Stock left after `used` counts are taken out. Unlimited stock (quantity 0) stays unlimited;
 * finite stock that's fully used is dropped (a remaining quantity of 0 would mean unlimited).
 */
function remainingStock<T extends { id: string; quantity: number }>(
	stock: T[],
	used: Map<string, number>
): T[] {
	return stock.flatMap((s) => {
		if (s.quantity === 0) return [s];
		const left = s.quantity - (used.get(s.id) ?? 0);
		return left > 0 ? [{ ...s, quantity: left }] : [];
	});
}

function countBy<T>(items: T[], key: (t: T) => string) {
	const m = new Map<string, number>();
	for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
	return m;
}

/**
 * Packs parts onto stock of their material. Parts with a material only go on stock with the
 * same materialKey; parts without one ("any stock") go on whatever is left afterwards, so
 * limited stock is never used twice. Simple setups (no materials) pack exactly as before.
 */
export function packByMaterial(
	sheetTypes: SheetType[],
	panels: PanelInput[],
	kerf = 0,
	method: PackMethod = 'nested'
): PackResult {
	const groups = new Map<string, PanelInput[]>();
	for (const p of panels) {
		const k = materialKey(p.material, p.thickness);
		groups.set(k, [...(groups.get(k) ?? []), p]);
	}
	const anyPanels = groups.get('') ?? [];
	groups.delete('');
	if (groups.size === 0) return pack(sheetTypes, panels, kerf, method);

	const result: PackResult = { sheets: [], unplaced: [] };
	const used = new Map<string, number>();
	const add = (r: PackResult) => {
		for (const s of r.sheets) result.sheets.push({ ...s, index: result.sheets.length });
		result.unplaced.push(...r.unplaced);
		for (const [id, n] of countBy(r.sheets, (s) => s.stockId))
			used.set(id, (used.get(id) ?? 0) + n);
	};

	for (const [k, group] of groups) {
		const matching = sheetTypes.filter((s) => materialKey(s.material, s.thickness) === k);
		if (!matching.length) {
			for (const panel of group) {
				if (!(panel.width > 0 && panel.height > 0)) continue;
				for (let q = 0; q < panel.quantity; q++)
					result.unplaced.push({ panel, reason: 'no_matching_stock' });
			}
			continue;
		}
		add(pack(matching, group, kerf, method));
	}
	if (anyPanels.length) {
		const stock = remainingStock(sheetTypes, used);
		// The packer returns nothing at all for empty stock; report the parts instead of dropping them.
		if (stock.some((s) => s.width > 0 && s.height > 0)) {
			add(pack(stock, anyPanels, kerf, method));
		} else {
			for (const panel of anyPanels) {
				if (!(panel.width > 0 && panel.height > 0)) continue;
				for (let q = 0; q < panel.quantity; q++)
					result.unplaced.push({ panel, reason: 'stock_exhausted' });
			}
		}
	}
	return result;
}

/** Linear counterpart of packByMaterial (linear stock has a material but no thickness). */
export function packLinearByMaterial(
	stocks: LinearStock[],
	pieces: LinearPiece[],
	kerf = 0
): LinearPackResult {
	const groups = new Map<string, LinearPiece[]>();
	for (const p of pieces) {
		const k = materialKey(p.material);
		groups.set(k, [...(groups.get(k) ?? []), p]);
	}
	const anyPieces = groups.get('') ?? [];
	groups.delete('');
	if (groups.size === 0) return packLinear(stocks, pieces, kerf);

	const result: LinearPackResult = { boards: [], unplaced: [] };
	const used = new Map<string, number>();
	const add = (r: LinearPackResult) => {
		for (const b of r.boards) result.boards.push({ ...b, index: result.boards.length });
		result.unplaced.push(...r.unplaced);
		for (const [id, n] of countBy(r.boards, (b) => b.stockId))
			used.set(id, (used.get(id) ?? 0) + n);
	};

	for (const [k, group] of groups) {
		if (!stocks.some((s) => materialKey(s.material) === k)) {
			for (const piece of group) {
				if (!(piece.length > 0)) continue;
				for (let q = 0; q < piece.quantity; q++)
					result.unplaced.push({ piece, reason: 'no_matching_stock' });
			}
			continue;
		}
		const stock = remainingStock(
			stocks.filter((s) => materialKey(s.material) === k),
			used
		);
		add(packLinear(stock, group, kerf));
	}
	if (anyPieces.length) {
		const stock = remainingStock(stocks, used);
		if (stock.some((s) => s.length > 0)) {
			add(packLinear(stock, anyPieces, kerf));
		} else {
			for (const piece of anyPieces) {
				if (!(piece.length > 0)) continue;
				for (let q = 0; q < piece.quantity; q++)
					result.unplaced.push({ piece, reason: 'stock_exhausted' });
			}
		}
	}
	return result;
}
