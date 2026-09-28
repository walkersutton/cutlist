import { describe, expect, it } from 'vitest';
import { convertThickness, formatThickness, parseMeasurement, stockName } from './stock.js';

describe('parseMeasurement', () => {
	it('parses decimals, fractions and mixed numbers', () => {
		expect(parseMeasurement('0.75')).toBe(0.75);
		expect(parseMeasurement('.5')).toBe(0.5);
		expect(parseMeasurement('3/4')).toBe(0.75);
		expect(parseMeasurement('1 1/2')).toBe(1.5);
		expect(parseMeasurement('1-1/2')).toBe(1.5);
		expect(parseMeasurement(' 18 ')).toBe(18);
	});

	it('rejects junk', () => {
		expect(parseMeasurement('')).toBeNull();
		expect(parseMeasurement('abc')).toBeNull();
		expect(parseMeasurement('3/0')).toBeNull();
		expect(parseMeasurement('3/4 in')).toBeNull();
	});
});

describe('formatThickness', () => {
	it('shows inches as reduced fractions', () => {
		expect(formatThickness(0.75, 'in')).toBe('3/4″');
		expect(formatThickness(0.71875, 'in')).toBe('23/32″');
		expect(formatThickness(1.5, 'in')).toBe('1-1/2″');
		expect(formatThickness(1, 'in')).toBe('1″');
	});

	it('shows mm to one decimal', () => {
		expect(formatThickness(18, 'mm')).toBe('18 mm');
		expect(formatThickness(19.05, 'mm')).toBe('19.1 mm');
	});
});

describe('stockName', () => {
	it('joins thickness and material, skipping blanks', () => {
		const sheet = { id: '1', width: 48, height: 96, quantity: 0, grain: 'any' as const };
		expect(stockName({ ...sheet, material: 'Baltic birch', thickness: 0.75 }, 'in')).toBe(
			'3/4″ Baltic birch'
		);
		expect(stockName({ ...sheet, material: '  MDF ' }, 'in')).toBe('MDF');
		expect(stockName(sheet, 'in')).toBe('');
		expect(stockName({ id: '2', length: 96, quantity: 0, material: '2×4 SPF' }, 'in')).toBe(
			'2×4 SPF'
		);
	});
});

describe('convertThickness', () => {
	it('rounds to sheet-goods precision', () => {
		expect(convertThickness(18, 'in')).toBe(0.71875);
		expect(convertThickness(0.75, 'mm')).toBe(19.1);
		expect(convertThickness(undefined, 'mm')).toBeUndefined();
	});
});
