import { describe, expect, it } from 'vitest';
import { pack, type PackResult, type PanelInput, type Sheet, type SheetType } from './packer.js';

const EPS = 1e-4;

function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function sheetType(over: Partial<SheetType> = {}): SheetType {
	return { id: 's1', width: 48, height: 96, quantity: 0, grain: 'any', ...over };
}

function panel(over: Partial<PanelInput> = {}): PanelInput {
	return { id: 'p1', width: 24, height: 24, quantity: 1, grain: 'any', label: '', ...over };
}

function gap(aStart: number, aLen: number, bStart: number, bLen: number): number {
	return Math.max(bStart - (aStart + aLen), aStart - (bStart + bLen));
}

function assertInvariants(result: PackResult, kerf: number) {
	for (const sheet of result.sheets) {
		for (const p of sheet.placements) {
			expect(p.x).toBeGreaterThanOrEqual(-EPS);
			expect(p.y).toBeGreaterThanOrEqual(-EPS);
			expect(p.x + p.width).toBeLessThanOrEqual(sheet.sheetWidth + EPS);
			expect(p.y + p.height).toBeLessThanOrEqual(sheet.sheetHeight + EPS);
		}
		const ps = sheet.placements;
		for (let i = 0; i < ps.length; i++) {
			for (let j = i + 1; j < ps.length; j++) {
				const gx = gap(ps[i].x, ps[i].width, ps[j].x, ps[j].width);
				const gy = gap(ps[i].y, ps[i].height, ps[j].y, ps[j].height);
				// separated by at least the kerf on some axis
				expect(gx >= kerf - EPS || gy >= kerf - EPS).toBe(true);
			}
		}
		assertGuillotineSeparable(sheet, kerf);
	}
}

// Replay the cut sequence: each cut must lie inside exactly one region and span it
// edge to edge, splitting it in two. Afterwards every region holds at most one part.
function assertGuillotineSeparable(sheet: Sheet, kerf: number) {
	expect(sheet.cuts).toBeDefined();
	const cuts = sheet.cuts!;
	cuts.forEach((c, i) => expect(c.order).toBe(i + 1));

	let regions = [{ x: 0, y: 0, w: sheet.sheetWidth, h: sheet.sheetHeight }];
	for (const c of cuts) {
		// The blade may overhang the far side of a region (a sliver narrower than the
		// kerf), so only the near edge of the slot must lie inside; the span must cover
		// the region edge to edge.
		const hits = regions.filter((r) =>
			c.direction === 'horizontal'
				? c.pos >= r.y - EPS &&
					c.pos <= r.y + r.h + EPS &&
					c.start <= r.x + EPS &&
					c.end >= r.x + r.w - EPS &&
					c.start >= r.x - EPS &&
					c.end <= r.x + r.w + EPS
				: c.pos >= r.x - EPS &&
					c.pos <= r.x + r.w + EPS &&
					c.start <= r.y + EPS &&
					c.end >= r.y + r.h - EPS &&
					c.start >= r.y - EPS &&
					c.end <= r.y + r.h + EPS
		);
		expect(hits.length).toBe(1);
		const r = hits[0];
		regions = regions.filter((x) => x !== r);
		if (c.direction === 'horizontal') {
			if (c.pos - r.y > EPS) regions.push({ x: r.x, y: r.y, w: r.w, h: c.pos - r.y });
			if (r.y + r.h - c.pos - kerf > EPS)
				regions.push({ x: r.x, y: c.pos + kerf, w: r.w, h: r.y + r.h - c.pos - kerf });
		} else {
			if (c.pos - r.x > EPS) regions.push({ x: r.x, y: r.y, w: c.pos - r.x, h: r.h });
			if (r.x + r.w - c.pos - kerf > EPS)
				regions.push({ x: c.pos + kerf, y: r.y, w: r.x + r.w - c.pos - kerf, h: r.h });
		}
	}

	for (const region of regions) {
		const contained = sheet.placements.filter(
			(p) =>
				p.x >= region.x - EPS &&
				p.y >= region.y - EPS &&
				p.x + p.width <= region.x + region.w + EPS &&
				p.y + p.height <= region.y + region.h + EPS
		);
		expect(contained.length).toBeLessThanOrEqual(1);
	}
	// every placement ends up fully inside one final region
	for (const p of sheet.placements) {
		const home = regions.filter(
			(region) =>
				p.x >= region.x - EPS &&
				p.y >= region.y - EPS &&
				p.x + p.width <= region.x + region.w + EPS &&
				p.y + p.height <= region.y + region.h + EPS
		);
		expect(home.length).toBe(1);
	}
}

describe('packGuillotine', () => {
	it('packs eight 23.9×23.9 pieces on one 48×96 sheet with kerf', () => {
		const result = pack(
			[sheetType()],
			[panel({ width: 23.9, height: 23.9, quantity: 8 })],
			0.125,
			'guillotine'
		);
		expect(result.sheets.length).toBe(1);
		expect(result.unplaced.length).toBe(0);
		expect(result.sheets[0].placements.length).toBe(8);
		assertInvariants(result, 0.125);
	});

	it('groups cut directions by stage (few direction changes)', () => {
		const result = pack(
			[sheetType()],
			[
				panel({ id: 'a', width: 30, height: 20, quantity: 3 }),
				panel({ id: 'b', width: 12, height: 10, quantity: 5 })
			],
			0.125,
			'guillotine'
		);
		for (const sheet of result.sheets) {
			const cuts = sheet.cuts!;
			let changes = 0;
			for (let i = 1; i < cuts.length; i++) {
				if (cuts[i].direction !== cuts[i - 1].direction) changes++;
			}
			expect(changes).toBeLessThanOrEqual(3);
			for (let i = 1; i < cuts.length; i++) {
				expect(cuts[i].depth).toBeGreaterThanOrEqual(cuts[i - 1].depth);
			}
		}
		assertInvariants(result, 0.125);
	});

	it('respects locked grain', () => {
		const same = pack(
			[sheetType({ grain: 'vertical' })],
			[panel({ width: 20, height: 30, grain: 'vertical', quantity: 4 })],
			0,
			'guillotine'
		);
		for (const s of same.sheets) for (const p of s.placements) expect(p.rotated).toBe(false);

		const opposite = pack(
			[sheetType({ grain: 'vertical' })],
			[panel({ width: 20, height: 30, grain: 'horizontal', quantity: 4 })],
			0,
			'guillotine'
		);
		for (const s of opposite.sheets) for (const p of s.placements) expect(p.rotated).toBe(true);
	});

	it('reports oversized panels and exhausted stock', () => {
		const tooBig = pack(
			[sheetType({ quantity: 1 })],
			[panel({ width: 50, height: 100 })],
			0,
			'guillotine'
		);
		expect(tooBig.unplaced.map((u) => u.reason)).toEqual(['too_large']);

		const exhausted = pack(
			[sheetType({ quantity: 1 })],
			[panel({ width: 48, height: 96, quantity: 2 })],
			0,
			'guillotine'
		);
		expect(exhausted.sheets.length).toBe(1);
		expect(exhausted.unplaced.map((u) => u.reason)).toEqual(['stock_exhausted']);
	});

	it('is deterministic', () => {
		const run = () =>
			pack(
				[sheetType()],
				[
					panel({ id: 'a', width: 17.5, height: 22, quantity: 3 }),
					panel({ id: 'b', width: 9, height: 33, quantity: 4 })
				],
				0.125,
				'guillotine'
			);
		expect(run()).toEqual(run());
	});

	it('holds invariants over randomized instances', () => {
		const rand = mulberry32(1234);
		const grains = ['horizontal', 'vertical', 'any'] as const;
		for (let iter = 0; iter < 100; iter++) {
			const kerf = rand() < 0.5 ? 0 : 0.125;
			const types: SheetType[] = [
				sheetType({
					id: 't1',
					width: 24 + Math.round(rand() * 72),
					height: 24 + Math.round(rand() * 72),
					quantity: rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0,
					grain: grains[Math.floor(rand() * 3)]
				})
			];
			if (rand() < 0.4) {
				types.push(
					sheetType({
						id: 't2',
						width: 24 + Math.round(rand() * 72),
						height: 24 + Math.round(rand() * 72),
						quantity: 0,
						grain: grains[Math.floor(rand() * 3)]
					})
				);
			}
			const panelCount = 1 + Math.floor(rand() * 8);
			const panels: PanelInput[] = [];
			for (let i = 0; i < panelCount; i++) {
				panels.push(
					panel({
						id: `p${i}`,
						width: 3 + Math.round(rand() * 296) / 8,
						height: 3 + Math.round(rand() * 296) / 8,
						quantity: 1 + Math.floor(rand() * 4),
						grain: grains[Math.floor(rand() * 3)]
					})
				);
			}

			const result = pack(types, panels, kerf, 'guillotine');
			assertInvariants(result, kerf);

			const placed = result.sheets.reduce((n, s) => n + s.placements.length, 0);
			const totalQty = panels.reduce((n, p) => n + p.quantity, 0);
			expect(placed + result.unplaced.length).toBe(totalQty);

			const usedByType = new Map<string, number>();
			for (const s of result.sheets) {
				const t = types.find((x) => x.width === s.sheetWidth && x.height === s.sheetHeight);
				if (t?.quantity) {
					usedByType.set(t.id, (usedByType.get(t.id) ?? 0) + 1);
				}
			}
			for (const t of types) {
				if (t.quantity > 0) expect(usedByType.get(t.id) ?? 0).toBeLessThanOrEqual(t.quantity);
			}
		}
	});

	it('nested mode still works and has no cuts field', () => {
		const result = pack([sheetType()], [panel({ quantity: 4 })], 0.125);
		expect(result.sheets.length).toBeGreaterThan(0);
		expect(result.sheets[0].cuts).toBeUndefined();
	});
});
