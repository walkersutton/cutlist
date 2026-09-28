import type { SheetType } from './packer.js';
import type { LinearStock } from './linear-packer.js';
import type { Unit } from './plans.js';

/** Parses "0.75", "3/4", "1 1/2" or "1-1/2". Returns null for anything else. */
export function parseMeasurement(input: string): number | null {
	const s = input.trim();
	const mixed = s.match(/^(\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)$/);
	if (mixed) {
		const den = parseInt(mixed[3], 10);
		return den === 0 ? null : parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / den;
	}
	const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
	if (frac) {
		const den = parseInt(frac[2], 10);
		return den === 0 ? null : parseInt(frac[1], 10) / den;
	}
	if (!/^\d*\.?\d+$/.test(s)) return null;
	return parseFloat(s);
}

function gcd(a: number, b: number): number {
	return b ? gcd(b, a % b) : a;
}

/** Thickness for display: inches as a fraction to the nearest 1/32 ("3/4″", "1-1/2″"), mm as-is. */
export function formatThickness(t: number, unit: Unit): string {
	if (unit === 'mm') return `${Math.round(t * 10) / 10} mm`;
	const n32 = Math.round(t * 32);
	const whole = Math.floor(n32 / 32);
	const rem = n32 % 32;
	if (rem === 0) return `${whole}″`;
	const g = gcd(rem, 32);
	const frac = `${rem / g}/${32 / g}`;
	return whole ? `${whole}-${frac}″` : `${frac}″`;
}

/** Human name for a stock item from its optional descriptors, e.g. "3/4″ Baltic birch". */
export function stockName(item: SheetType | LinearStock, unit: Unit): string {
	const thickness =
		'thickness' in item && item.thickness ? formatThickness(item.thickness, unit) : '';
	return [thickness, item.material?.trim()].filter(Boolean).join(' ');
}

export function convertThickness(t: number | undefined, to: Unit): number | undefined {
	if (!t) return t;
	// 1/32″ matches how sheet goods are sold (18 mm ≈ 23/32″).
	// The epsilon keeps float error (0.75 × 25.4 = 19.0499…) from rounding the wrong way.
	return to === 'mm'
		? Math.round(t * 25.4 * 10 + 1e-9) / 10
		: Math.round((t / 25.4) * 32 + 1e-9) / 32;
}
