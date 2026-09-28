import { describe, expect, it } from 'vitest';
import { SHARE_PARAM, decodePlan, encodePlan, planFromHash, type PlanState } from './share.js';

const plan: PlanState = {
	name: 'Bookshelf',
	mode: 'sheet',
	unit: 'in',
	kerf: 0.125,
	cutMethod: 'guillotine',
	sheetTypes: [
		{
			id: '7',
			width: 48,
			height: 96,
			quantity: 2,
			grain: 'vertical',
			material: 'Baltic birch',
			thickness: 0.75
		},
		{ id: '12', width: 24, height: 48, quantity: 0, grain: 'any' }
	],
	panels: [
		{
			id: '8',
			label: 'Side — ½" ply',
			width: 23.875,
			height: 30,
			quantity: 2,
			grain: 'vertical',
			material: 'Baltic birch',
			thickness: 0.75
		},
		{ id: '9', label: '', width: 12, height: 12, quantity: 1, grain: 'any' }
	],
	linearStocks: [{ id: '10', length: 96, quantity: 0, material: '2×4 SPF' }],
	linearPieces: [{ id: '11', label: 'Rail', length: 22.5, quantity: 4, material: '2×4 SPF' }]
};

describe('share encoding', () => {
	it('round-trips a plan, reassigning ids', () => {
		const decoded = decodePlan(encodePlan(plan));
		expect(decoded).not.toBeNull();
		const strip = (p: PlanState) =>
			JSON.parse(JSON.stringify(p, (k, v) => (k === 'id' ? undefined : v)));
		expect(strip(decoded!)).toEqual(strip(plan));
		const ids = [
			...decoded!.sheetTypes,
			...decoded!.panels,
			...decoded!.linearStocks,
			...decoded!.linearPieces
		].map((x) => x.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('produces a URL-safe string', () => {
		expect(encodePlan(plan)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('reads the plan from a location hash', () => {
		expect(planFromHash(`#${SHARE_PARAM}=${encodePlan(plan)}`)?.panels).toHaveLength(2);
		expect(planFromHash('')).toBeNull();
		expect(planFromHash('#other=1')).toBeNull();
	});

	it('still decodes links made before stock descriptors existed', () => {
		const old = {
			v: 1,
			m: 's',
			u: 'in',
			k: 0.125,
			c: 'n',
			s: [[48, 96, 0, 'v']],
			p: [],
			ls: [[96, 0]],
			lp: []
		};
		const decoded = decodePlan(btoa(JSON.stringify(old)));
		expect(decoded?.sheetTypes[0]).not.toHaveProperty('material');
		expect(decoded?.sheetTypes[0]).not.toHaveProperty('thickness');
		expect(decoded?.linearStocks[0]).not.toHaveProperty('material');
	});

	it('rejects malformed input', () => {
		expect(decodePlan('not-base64!!')).toBeNull();
		expect(decodePlan(btoa('{"v":1}'))).toBeNull();
		expect(decodePlan(btoa(JSON.stringify({ v: 99 })))).toBeNull();
		const bad = {
			v: 1,
			m: 's',
			u: 'in',
			k: 0.125,
			c: 'n',
			s: [[48, -1, 0, 'v']],
			p: [],
			ls: [],
			lp: []
		};
		expect(decodePlan(btoa(JSON.stringify(bad)))).toBeNull();
	});
});
