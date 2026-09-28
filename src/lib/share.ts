import type { GrainDirection, PackMethod, PanelInput, SheetType } from './packer.js';
import type { LinearPiece, LinearStock } from './linear-packer.js';

export interface PlanState {
	name?: string;
	mode: 'sheet' | 'linear';
	unit: 'in' | 'mm';
	kerf: number;
	cutMethod: PackMethod;
	sheetTypes: SheetType[];
	panels: PanelInput[];
	linearStocks: LinearStock[];
	linearPieces: LinearPiece[];
}

// Hash param holding the encoded plan. The fragment is never sent to the server, so shared
// plans stay out of request logs and work with the static build.
export const SHARE_PARAM = 'plan';

const VERSION = 1;
const GRAIN_TO_CODE: Record<GrainDirection, string> = { any: 'a', horizontal: 'h', vertical: 'v' };
const CODE_TO_GRAIN: Record<string, GrainDirection> = { a: 'any', h: 'horizontal', v: 'vertical' };

// Compact positional encoding — ids are dropped and reassigned on decode.
interface Wire {
	v: number;
	m: 's' | 'l';
	u: 'in' | 'mm';
	k: number;
	c: 'n' | 'g';
	// Optional trailing fields are only written when set, so older links still decode.
	s: [number, number, number, string, string?, number?][];
	p: [string, number, number, number, string, string?, number?][];
	ls: [number, number, string?][];
	lp: [string, number, number, string?][];
	n?: string;
}

function toBase64Url(s: string): string {
	let bin = '';
	for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodePlan(plan: PlanState): string {
	const wire: Wire = {
		v: VERSION,
		m: plan.mode === 'linear' ? 'l' : 's',
		u: plan.unit,
		k: plan.kerf,
		c: plan.cutMethod === 'guillotine' ? 'g' : 'n',
		s: plan.sheetTypes.map((s) => {
			const row: Wire['s'][number] = [s.width, s.height, s.quantity, GRAIN_TO_CODE[s.grain]];
			if (s.material || s.thickness) row.push(s.material ?? '');
			if (s.thickness) row.push(s.thickness);
			return row;
		}),
		p: plan.panels.map((p) => {
			const row: Wire['p'][number] = [
				p.label,
				p.width,
				p.height,
				p.quantity,
				GRAIN_TO_CODE[p.grain]
			];
			if (p.material || p.thickness) row.push(p.material ?? '');
			if (p.thickness) row.push(p.thickness);
			return row;
		}),
		ls: plan.linearStocks.map((s) => {
			const row: Wire['ls'][number] = [s.length, s.quantity];
			if (s.material) row.push(s.material);
			return row;
		}),
		lp: plan.linearPieces.map((p) => {
			const row: Wire['lp'][number] = [p.label, p.length, p.quantity];
			if (p.material) row.push(p.material);
			return row;
		})
	};
	if (plan.name) wire.n = plan.name;
	return toBase64Url(JSON.stringify(wire));
}

function num(v: unknown, min = 0): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error('bad number');
	return v;
}
function str(v: unknown): string {
	if (typeof v !== 'string') throw new Error('bad string');
	return v.slice(0, 200);
}
function grain(v: unknown): GrainDirection {
	const g = typeof v === 'string' ? CODE_TO_GRAIN[v] : undefined;
	if (!g) throw new Error('bad grain');
	return g;
}
function optionalMaterial(v: unknown): { material?: string } {
	if (v === undefined) return {};
	const m = str(v).trim();
	return m ? { material: m } : {};
}
function list(v: unknown): unknown[][] {
	if (!Array.isArray(v) || !v.every(Array.isArray)) throw new Error('bad list');
	return v as unknown[][];
}

/** Decodes an encoded plan. Returns null for anything malformed rather than throwing. */
export function decodePlan(encoded: string): PlanState | null {
	try {
		const w = JSON.parse(fromBase64Url(encoded)) as Partial<Wire>;
		if (w.v !== VERSION) return null;
		let id = 1;
		const uid = () => String(id++);
		return {
			name: typeof w.n === 'string' ? str(w.n) : undefined,
			mode: w.m === 'l' ? 'linear' : 'sheet',
			unit: w.u === 'mm' ? 'mm' : 'in',
			kerf: num(w.k),
			cutMethod: w.c === 'g' ? 'guillotine' : 'nested',
			sheetTypes: list(w.s).map(([width, height, quantity, g, material, thickness]) => ({
				id: uid(),
				width: num(width),
				height: num(height),
				quantity: Math.floor(num(quantity)),
				grain: grain(g),
				...optionalMaterial(material),
				...(thickness !== undefined ? { thickness: num(thickness) } : {})
			})),
			panels: list(w.p).map(([label, width, height, quantity, g, material, thickness]) => ({
				id: uid(),
				label: str(label),
				width: num(width),
				height: num(height),
				quantity: Math.floor(num(quantity)),
				grain: grain(g),
				...optionalMaterial(material),
				...(thickness !== undefined ? { thickness: num(thickness) } : {})
			})),
			linearStocks: list(w.ls).map(([length, quantity, material]) => ({
				id: uid(),
				length: num(length),
				quantity: Math.floor(num(quantity)),
				...optionalMaterial(material)
			})),
			linearPieces: list(w.lp).map(([label, length, quantity, material]) => ({
				id: uid(),
				label: str(label),
				length: num(length),
				quantity: Math.floor(num(quantity)),
				...optionalMaterial(material)
			}))
		};
	} catch {
		return null;
	}
}

/** Reads a shared plan from a location hash like `#plan=...`. */
export function planFromHash(hash: string): PlanState | null {
	const value = new URLSearchParams(hash.replace(/^#/, '')).get(SHARE_PARAM);
	return value ? decodePlan(value) : null;
}
