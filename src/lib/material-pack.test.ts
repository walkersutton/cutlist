import { describe, expect, it } from 'vitest';
import { materialKey, packByMaterial, packLinearByMaterial } from './material-pack.js';
import { pack, type PanelInput, type SheetType } from './packer.js';

const birch: SheetType = {
	id: 'b',
	width: 48,
	height: 96,
	quantity: 0,
	grain: 'any',
	material: 'Baltic birch',
	thickness: 0.75
};
const mdf: SheetType = {
	id: 'm',
	width: 48,
	height: 96,
	quantity: 0,
	grain: 'any',
	material: 'MDF'
};

function panel(over: Partial<PanelInput> = {}): PanelInput {
	return { id: 'p', label: '', width: 20, height: 20, quantity: 1, grain: 'any', ...over };
}

describe('materialKey', () => {
	it('ignores case and surrounding whitespace, and includes thickness', () => {
		expect(materialKey(' Baltic Birch ', 0.75)).toBe(materialKey('baltic birch', 0.75));
		expect(materialKey('Baltic birch', 0.75)).not.toBe(materialKey('Baltic birch', 0.5));
		expect(materialKey()).toBe('');
		expect(materialKey('  ')).toBe('');
	});
});

describe('packByMaterial', () => {
	it('packs exactly like pack() when no part names a material', () => {
		const panels = [panel({ quantity: 3 })];
		expect(packByMaterial([birch, mdf], panels, 0.125)).toEqual(pack([birch, mdf], panels, 0.125));
	});

	it('only puts a part on stock of its material', () => {
		const r = packByMaterial(
			[mdf, birch],
			[panel({ id: 'a', material: 'baltic birch', thickness: 0.75, quantity: 2 })]
		);
		expect(r.sheets.every((s) => s.stockId === 'b')).toBe(true);
		expect(r.unplaced).toHaveLength(0);
	});

	it('reports parts whose material is not in stock', () => {
		const r = packByMaterial([mdf], [panel({ material: 'Walnut', quantity: 2 })]);
		expect(r.sheets).toHaveLength(0);
		expect(r.unplaced.map((u) => u.reason)).toEqual(['no_matching_stock', 'no_matching_stock']);
	});

	it("doesn't reuse limited stock for any-stock parts, and never silently drops them", () => {
		const oneBirch = { ...birch, quantity: 1 };
		const r = packByMaterial(
			[oneBirch],
			[
				panel({ id: 'a', width: 48, height: 96, material: 'Baltic birch', thickness: 0.75 }),
				panel({ id: 'b' })
			]
		);
		expect(r.sheets).toHaveLength(1);
		expect(r.unplaced).toEqual([
			{ panel: expect.objectContaining({ id: 'b' }), reason: 'stock_exhausted' }
		]);
	});

	it('numbers sheets continuously across materials', () => {
		const r = packByMaterial(
			[birch, mdf],
			[
				panel({ id: 'a', material: 'MDF' }),
				panel({ id: 'b', material: 'Baltic birch', thickness: 0.75 })
			]
		);
		expect(r.sheets.map((s) => s.index)).toEqual([0, 1]);
		expect(new Set(r.sheets.map((s) => s.stockId))).toEqual(new Set(['b', 'm']));
	});
});

describe('packLinearByMaterial', () => {
	it('matches pieces to stock of their material', () => {
		const r = packLinearByMaterial(
			[
				{ id: 'p', length: 96, quantity: 0, material: '2×4 SPF' },
				{ id: 'e', length: 120, quantity: 0, material: '½″ EMT' }
			],
			[
				{ id: 'a', label: '', length: 30, quantity: 2, material: '½″ emt' },
				{ id: 'b', label: '', length: 30, quantity: 1, material: 'Oak' }
			]
		);
		expect(r.boards.every((b) => b.stockId === 'e')).toBe(true);
		expect(r.unplaced.map((u) => u.reason)).toEqual(['no_matching_stock']);
	});
});
