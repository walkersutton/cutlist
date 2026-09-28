import { describe, expect, it } from 'vitest';
import {
	STORE_KEY,
	convertPlanUnits,
	loadStore,
	newPlan,
	uniqueName,
	type Store
} from './plans.js';

function storage(items: Record<string, unknown>) {
	return (key: string) => (key in items ? JSON.stringify(items[key]) : null);
}

describe('loadStore', () => {
	it('starts fresh with one empty plan', () => {
		const s = loadStore(storage({}));
		expect(s.plans).toHaveLength(1);
		expect(s.activeId).toBe(s.plans[0].id);
		expect(s.shop.sheetTypes).toHaveLength(1);
	});

	it('migrates v1 data into a single plan plus shop stock', () => {
		const s = loadStore(
			storage({
				cutlist_v1: {
					mode: 'linear',
					unit: 'mm',
					kerf: 3,
					cutMethod: 'guillotine',
					sheetTypes: [{ id: '1', width: 1220, height: 2440, quantity: 2, grain: 'vertical' }],
					panels: [{ id: '2', label: 'Side', width: 600, height: 300, quantity: 2, grain: 'any' }],
					linearStocks: [{ id: '3', length: 2400, quantity: 0 }],
					linearPieces: [{ id: '4', label: 'Rail', length: 500, quantity: 4 }]
				}
			})
		);
		expect(s.shop.unit).toBe('mm');
		expect(s.shop.sheetTypes[0].quantity).toBe(2);
		expect(s.plans).toHaveLength(1);
		expect(s.plans[0]).toMatchObject({
			name: 'My plan',
			mode: 'linear',
			kerf: 3,
			cutMethod: 'guillotine'
		});
		expect(s.plans[0].panels[0].label).toBe('Side');
		expect(s.plans[0].linearPieces[0].label).toBe('Rail');
	});

	it('prefers v2 over v1 and repairs a dangling activeId', () => {
		const plan = newPlan('Bookshelf');
		const v2: Store = {
			v: 2,
			shop: { unit: 'in', sheetTypes: [], linearStocks: [] },
			plans: [plan],
			activeId: 'gone'
		};
		const s = loadStore(storage({ [STORE_KEY]: v2, cutlist_v1: { panels: [] } }));
		expect(s.plans[0].name).toBe('Bookshelf');
		expect(s.activeId).toBe(plan.id);
	});

	it('survives corrupt storage', () => {
		expect(loadStore(() => '{nope').plans).toHaveLength(1);
	});
});

describe('helpers', () => {
	it('uniqueName skips taken names', () => {
		const plans = [{ name: 'Untitled plan' }, { name: 'Untitled plan 2' }];
		expect(uniqueName('Untitled plan', plans)).toBe('Untitled plan 3');
		expect(uniqueName('Desk', plans)).toBe('Desk');
	});

	it('converts plan units', () => {
		const p = convertPlanUnits(
			{
				kerf: 0.125,
				panels: [{ id: '1', label: '', width: 24, height: 12, quantity: 1, grain: 'any' }],
				linearPieces: [{ id: '2', label: '', length: 10, quantity: 1 }]
			},
			'mm'
		);
		expect(p.kerf).toBe(3.2);
		expect(p.panels[0].width).toBe(610);
		expect(p.linearPieces[0].length).toBe(254);
	});

	it("converts a plan's own stock with it", () => {
		const p = convertPlanUnits(
			{
				kerf: 3,
				panels: [],
				linearPieces: [],
				stock: {
					sheetTypes: [{ id: '1', width: 1219, height: 2438, quantity: 0, grain: 'any' }],
					linearStocks: [{ id: '2', length: 2438, quantity: 0 }]
				}
			},
			'in'
		);
		expect(p.stock!.sheetTypes[0]).toMatchObject({ width: 48, height: 96 });
		expect(p.stock!.linearStocks[0].length).toBe(96);
	});
});
