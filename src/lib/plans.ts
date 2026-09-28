import type { PackMethod, PanelInput, SheetType } from './packer.js';
import type { LinearPiece, LinearStock } from './linear-packer.js';
import { convertThickness } from './stock.js';

export type Unit = 'in' | 'mm';

export interface Stock {
	sheetTypes: SheetType[];
	linearStocks: LinearStock[];
}

/** Units and shop stock are device-wide; plans use the shop stock unless they opt out. */
export interface Shop extends Stock {
	unit: Unit;
}

export interface Plan {
	id: string;
	name: string;
	updatedAt: number;
	mode: 'sheet' | 'linear';
	kerf: number;
	cutMethod: PackMethod;
	panels: PanelInput[];
	linearPieces: LinearPiece[];
	/** Plan-specific stock. Kept even while `useCustomStock` is off so toggling back restores it. */
	stock?: Stock;
	useCustomStock?: boolean;
}

export interface Store {
	v: 2;
	shop: Shop;
	plans: Plan[];
	activeId: string;
}

export const STORE_KEY = 'cutlist_v2';
const LEGACY_KEY = 'cutlist_v1';

export function newPlanId(): string {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function defaultShop(unit: Unit = 'in'): Shop {
	return unit === 'mm'
		? {
				unit,
				sheetTypes: [{ id: '1', width: 1220, height: 2440, quantity: 0, grain: 'vertical' }],
				linearStocks: [{ id: '2', length: 2440, quantity: 0 }]
			}
		: {
				unit,
				sheetTypes: [{ id: '1', width: 48, height: 96, quantity: 0, grain: 'vertical' }],
				linearStocks: [{ id: '2', length: 96, quantity: 0 }]
			};
}

export function newPlan(name: string, unit: Unit = 'in'): Plan {
	return {
		id: newPlanId(),
		name,
		updatedAt: Date.now(),
		mode: 'sheet',
		kerf: unit === 'mm' ? 3 : 0.125,
		cutMethod: 'nested',
		panels: [],
		linearPieces: []
	};
}

export function freshStore(): Store {
	const plan = newPlan('My plan');
	return { v: 2, shop: defaultShop(), plans: [plan], activeId: plan.id };
}

export function planHasContent(p: Pick<Plan, 'panels' | 'linearPieces'>): boolean {
	return p.panels.length > 0 || p.linearPieces.length > 0;
}

/** Returns `base`, or `base 2`, `base 3`… — whichever isn't taken yet. */
export function uniqueName(base: string, plans: Pick<Plan, 'name'>[]): string {
	const taken = new Set(plans.map((p) => p.name));
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}

function migrateLegacy(raw: Record<string, unknown>): Store {
	const unit: Unit = raw.unit === 'mm' ? 'mm' : 'in';
	const fallback = defaultShop(unit);
	const plan: Plan = {
		...newPlan('My plan', unit),
		mode: raw.mode === 'linear' ? 'linear' : 'sheet',
		kerf: typeof raw.kerf === 'number' ? raw.kerf : unit === 'mm' ? 3 : 0.125,
		cutMethod: raw.cutMethod === 'guillotine' ? 'guillotine' : 'nested',
		panels: (raw.panels as PanelInput[]) ?? [],
		linearPieces: (raw.linearPieces as LinearPiece[]) ?? []
	};
	return {
		v: 2,
		shop: {
			unit,
			sheetTypes: (raw.sheetTypes as SheetType[]) ?? fallback.sheetTypes,
			linearStocks: (raw.linearStocks as LinearStock[]) ?? fallback.linearStocks
		},
		plans: [plan],
		activeId: plan.id
	};
}

/** Loads the v2 store, migrating v1 data (single plan) if that's all there is. */
export function loadStore(getItem: (key: string) => string | null): Store {
	try {
		const raw = getItem(STORE_KEY);
		if (raw) {
			const s = JSON.parse(raw) as Store;
			if (s.v === 2 && s.shop && Array.isArray(s.plans) && s.plans.length > 0) {
				if (!s.plans.some((p) => p.id === s.activeId)) s.activeId = s.plans[0].id;
				return s;
			}
		}
		const legacy = getItem(LEGACY_KEY);
		if (legacy) return migrateLegacy(JSON.parse(legacy));
	} catch {
		/* fall through to a fresh store */
	}
	return freshStore();
}

export function convertLength(v: number, to: Unit): number {
	return to === 'mm' ? Math.round(v * 25.4) : Math.round((v / 25.4) * 8) / 8;
}

export function convertKerf(v: number, to: Unit): number {
	return to === 'mm' ? Math.round(v * 25.4 * 10) / 10 : Math.round((v / 25.4) * 8) / 8;
}

export function convertShopStock<T extends Stock>(shop: T, to: Unit): T {
	return {
		...shop,
		sheetTypes: shop.sheetTypes.map((s) => ({
			...s,
			width: convertLength(s.width, to),
			height: convertLength(s.height, to),
			...(s.thickness ? { thickness: convertThickness(s.thickness, to) } : {})
		})),
		linearStocks: shop.linearStocks.map((s) => ({ ...s, length: convertLength(s.length, to) }))
	};
}

export function convertPlanUnits<
	T extends Pick<Plan, 'kerf' | 'panels' | 'linearPieces'> & { stock?: Stock | null }
>(plan: T, to: Unit): T {
	return {
		...plan,
		...(plan.stock ? { stock: convertShopStock(plan.stock, to) } : {}),
		kerf: convertKerf(plan.kerf, to),
		panels: plan.panels.map((p) => ({
			...p,
			width: convertLength(p.width, to),
			height: convertLength(p.height, to),
			// Same rounding as stock thickness, so panel and stock keep matching after conversion.
			...(p.thickness ? { thickness: convertThickness(p.thickness, to) } : {})
		})),
		linearPieces: plan.linearPieces.map((p) => ({ ...p, length: convertLength(p.length, to) }))
	};
}
