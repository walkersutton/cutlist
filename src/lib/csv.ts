/**
 * CSV import/export for plan parts and stock.
 *
 * One column layout covers both kinds of rows: a row with width + height is a sheet part (or
 * sheet stock), a row with a length is a linear part (or linear stock). Headers are matched by
 * name, so column order doesn't matter and spreadsheets with extra columns still import.
 * Exports put the unit in the header ("Width (in)") so a file re-imports without guessing.
 */
import type { GrainDirection, PanelInput, SheetType } from './packer.js';
import type { LinearPiece, LinearStock } from './linear-packer.js';
import { convertLength, type Stock, type Unit } from './plans.js';
import { convertThickness, parseMeasurement } from './stock.js';

export type CsvKind = 'parts' | 'stock';

type Field = 'label' | 'width' | 'height' | 'length' | 'qty' | 'grain' | 'material' | 'thickness';

/** Header aliases, compared after lowercasing and stripping everything but letters and digits. */
const ALIASES: Record<Field, string[]> = {
	label: ['label', 'name', 'part', 'partname', 'piece', 'panel', 'item', 'description', 'desc'],
	width: ['width', 'w'],
	height: ['height', 'h'],
	length: ['length', 'len', 'l'],
	qty: ['qty', 'quantity', 'count', 'number', 'num', 'pcs', 'pieces'],
	grain: ['grain', 'graindirection', 'grainside'],
	material: ['material', 'species', 'stock', 'stockmaterial'],
	thickness: ['thickness', 'thick', 't']
};

export interface CsvRow {
	label: string;
	width: number | null;
	height: number | null;
	length: number | null;
	/** null = blank: one part, or unlimited stock. */
	qty: number | null;
	/** null = blank: parts default to any, sheet stock to vertical (like new stock in the app). */
	grain: GrainDirection | null;
	material: string;
	thickness: number | null;
}

export interface CsvParseResult {
	rows: CsvRow[];
	/** Rows with neither width × height nor a length. */
	skipped: number;
	/** Unit named in the headers or cells, if any. */
	unit: Unit | null;
	/** Best guess at what the file holds: labelled rows are parts, unlabelled rows are stock. */
	kind: CsvKind;
	/** True when the first row wasn't a header and columns were assumed. */
	headerless: boolean;
}

/** Splits delimited text into rows of fields (RFC 4180 quoting, CRLF or LF). */
export function parseDelimited(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch !== '"') field += ch;
			else if (text[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = false;
		} else if (ch === '"' && field === '') quoted = true;
		else if (ch === delimiter) {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (ch !== '\r') field += ch;
	}
	row.push(field);
	rows.push(row);
	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Tab for spreadsheet pastes, semicolon for European-locale CSVs, comma otherwise. */
export function detectDelimiter(text: string): string {
	const first = text.split('\n', 1)[0];
	if (first.includes('\t')) return '\t';
	if (first.includes(';') && !first.includes(',')) return ';';
	return ',';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Unit written in a header ("Width (mm)", "Length in") or after a number ("600mm", "24\""). */
function unitIn(s: string): Unit | null {
	const t = s.trim().toLowerCase();
	if (/(\bmm\b|\d\s*mm$|\(mm\)|\[mm\])/.test(t)) return 'mm';
	if (/(\(in\)|\[in\]|\binches\b|\binch\b|\d\s*in$|["″]$|\(["″]\)|\s+in$)/.test(t)) return 'in';
	return null;
}

function headerField(h: string): Field | null {
	// Drop a trailing unit so "Width (in)" and "Length mm" match their plain names.
	const name = norm(h.replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s+(mm|in|inches)\s*$/i, ''));
	for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][])
		if (names.includes(name)) return field;
	return null;
}

function number(raw: string | undefined): number | null {
	if (raw == null) return null;
	const t = raw
		.trim()
		.replace(/\s*(mm|in|inches|inch|["″])$/i, '')
		.replace(/,(?=\d{3}\b)/g, ''); // thousands separators: "1,220"
	if (!t) return null;
	const n = parseMeasurement(t);
	return n != null && Number.isFinite(n) ? n : null;
}

function grain(raw: string | undefined): GrainDirection | null {
	const t = (raw ?? '').trim().toLowerCase();
	if (!t) return null;
	if (/^(h|horiz|horizontal|↔|→|←|-)$/.test(t)) return 'horizontal';
	if (/^(v|vert|vertical|↕|↑|↓|\|)$/.test(t)) return 'vertical';
	return 'any';
}

function quantity(raw: string | undefined): number | null {
	const t = (raw ?? '').trim();
	if (!t || /^(∞|inf|infinite|unlimited|any|-)$/i.test(t)) return null;
	const n = number(t);
	return n != null && n >= 0 ? Math.floor(n) : null;
}

export function parseCsv(input: string): CsvParseResult {
	const text = input.replace(/^\uFEFF/, '');
	const table = parseDelimited(text, detectDelimiter(text));
	const empty: CsvParseResult = {
		rows: [],
		skipped: 0,
		unit: null,
		kind: 'parts',
		headerless: false
	};
	if (!table.length) return empty;

	const fields = table[0].map(headerField);
	const headerless = !fields.includes('width') && !fields.includes('length');
	const cols = new Map<Field, number>();
	if (headerless) {
		// No recognisable header: assume the common "label, width, height, qty" layout, or
		// "width, height, qty" if the first column is numeric.
		const layout: Field[] =
			number(table[0][0]) == null
				? ['label', 'width', 'height', 'qty', 'grain', 'material', 'thickness']
				: ['width', 'height', 'qty', 'grain', 'material', 'thickness'];
		layout.forEach((f, i) => cols.set(f, i));
	} else {
		fields.forEach((f, i) => f && !cols.has(f) && cols.set(f, i));
	}

	const units = headerless ? [] : table[0].map(unitIn);
	const dimUnit = (['width', 'height', 'length'] as Field[])
		.map((f) => (cols.has(f) ? units[cols.get(f)!] : null))
		.find(Boolean);

	const data = headerless ? table : table.slice(1);
	const cell = (r: string[], f: Field) => (cols.has(f) ? r[cols.get(f)!] : undefined);
	let cellUnit: Unit | null = null;
	const rows: CsvRow[] = [];
	let skipped = 0;
	for (const r of data) {
		for (const f of ['width', 'height', 'length'] as Field[]) cellUnit ||= unitIn(cell(r, f) ?? '');
		const row: CsvRow = {
			label: (cell(r, 'label') ?? '').trim(),
			width: number(cell(r, 'width')),
			height: number(cell(r, 'height')),
			length: number(cell(r, 'length')),
			qty: quantity(cell(r, 'qty')),
			grain: grain(cell(r, 'grain')),
			material: (cell(r, 'material') ?? '').trim(),
			thickness: number(cell(r, 'thickness'))
		};
		const isSheet = !!(row.width && row.height && row.width > 0 && row.height > 0);
		const isLinear = !isSheet && !!(row.length && row.length > 0);
		if ((!isSheet && !isLinear) || row.qty === 0) skipped++;
		else rows.push(row);
	}

	return {
		rows,
		skipped,
		unit: dimUnit ?? cellUnit,
		kind: cols.has('label') && rows.some((r) => r.label) ? 'parts' : 'stock',
		headerless
	};
}

/**
 * For files that don't say: sizes no one measures in inches (a 600″ panel, an 18″-thick sheet)
 * mean millimetres. Returns null when the numbers could plausibly be either.
 */
export function guessUnit(rows: CsvRow[]): Unit | null {
	const mm = rows.some(
		(r) =>
			(r.width ?? 0) > 144 ||
			(r.height ?? 0) > 144 ||
			(r.length ?? 0) > 480 ||
			(r.thickness ?? 0) > 4
	);
	return mm ? 'mm' : null;
}

const isSheetRow = (r: CsvRow) => r.width != null && r.height != null;

/** Conversion is skipped when the file is already in the plan's unit. */
function lengthIn(v: number, from: Unit, to: Unit) {
	return from === to ? v : convertLength(v, to);
}
function thicknessIn(v: number | null, from: Unit, to: Unit) {
	if (!v) return undefined;
	return from === to ? v : convertThickness(v, to);
}

type NoId<T> = Omit<T, 'id'>;

export function rowsToParts(rows: CsvRow[], from: Unit, to: Unit) {
	const panels: NoId<PanelInput>[] = [];
	const pieces: NoId<LinearPiece>[] = [];
	for (const r of rows) {
		const material = r.material || undefined;
		if (isSheetRow(r)) {
			panels.push({
				label: r.label,
				width: lengthIn(r.width!, from, to),
				height: lengthIn(r.height!, from, to),
				quantity: r.qty ?? 1,
				grain: r.grain ?? 'any',
				...(material ? { material } : {}),
				...(thicknessIn(r.thickness, from, to)
					? { thickness: thicknessIn(r.thickness, from, to) }
					: {})
			});
		} else {
			pieces.push({
				label: r.label,
				length: lengthIn(r.length!, from, to),
				quantity: r.qty ?? 1,
				...(material ? { material } : {})
			});
		}
	}
	return { panels, pieces };
}

export function rowsToStock(rows: CsvRow[], from: Unit, to: Unit) {
	const sheetTypes: NoId<SheetType>[] = [];
	const linearStocks: NoId<LinearStock>[] = [];
	for (const r of rows) {
		// Stock has no label column of its own; a label is the best available material name.
		const material = r.material || r.label || undefined;
		if (isSheetRow(r)) {
			sheetTypes.push({
				width: lengthIn(r.width!, from, to),
				height: lengthIn(r.height!, from, to),
				quantity: r.qty ?? 0,
				grain: r.grain ?? 'vertical',
				...(material ? { material } : {}),
				...(thicknessIn(r.thickness, from, to)
					? { thickness: thicknessIn(r.thickness, from, to) }
					: {})
			});
		} else {
			linearStocks.push({
				length: lengthIn(r.length!, from, to),
				quantity: r.qty ?? 0,
				...(material ? { material } : {})
			});
		}
	}
	return { sheetTypes, linearStocks };
}

/** What the import dialog hands back: rows already converted into the app's unit. */
export type CsvImport =
	| { kind: 'parts'; replace: boolean; data: ReturnType<typeof rowsToParts> }
	| { kind: 'stock'; replace: boolean; data: ReturnType<typeof rowsToStock> };

// ---- Export ----

/** Comma for .csv files; tab for copying, since spreadsheets split tab-separated pastes into cells. */
export type Delimiter = ',' | '\t';

type Cell = string | number | undefined;
type ExportRow = Partial<Record<Field, Cell>>;

interface Column {
	field: Field;
	header: string;
	/** Left out when every row is blank, e.g. Material in a plan that doesn't use materials. */
	optional?: boolean;
}

function escapeField(v: Cell, delimiter: Delimiter): string {
	const s = v == null ? '' : String(v);
	const special = s.includes(delimiter) || /["\n\r]/.test(s) || s !== s.trim();
	return special ? `"${s.replace(/"/g, '""')}"` : s;
}

function toTable(columns: Column[], rows: ExportRow[], delimiter: Delimiter): string {
	const kept = columns.filter(
		(c) => !c.optional || rows.some((r) => r[c.field] != null && r[c.field] !== '')
	);
	const lines = [kept.map((c) => c.header), ...rows.map((r) => kept.map((c) => r[c.field]))].map(
		(cells) => cells.map((v) => escapeField(v, delimiter)).join(delimiter)
	);
	return lines.join('\r\n') + '\r\n';
}

/** Sheet parts. Grain "any" is left blank, which is what a blank imports as. */
export function panelsToCsv(panels: PanelInput[], unit: Unit, delimiter: Delimiter = ','): string {
	return toTable(
		[
			{ field: 'label', header: 'Label' },
			{ field: 'width', header: `Width (${unit})` },
			{ field: 'height', header: `Height (${unit})` },
			{ field: 'qty', header: 'Qty' },
			{ field: 'grain', header: 'Grain' },
			{ field: 'material', header: 'Material', optional: true },
			{ field: 'thickness', header: `Thickness (${unit})`, optional: true }
		],
		panels.map((p) => ({
			label: p.label,
			width: p.width,
			height: p.height,
			qty: p.quantity,
			grain: p.grain === 'any' ? '' : p.grain,
			material: p.material,
			thickness: p.thickness
		})),
		delimiter
	);
}

export function piecesToCsv(pieces: LinearPiece[], unit: Unit, delimiter: Delimiter = ','): string {
	return toTable(
		[
			{ field: 'label', header: 'Label' },
			{ field: 'length', header: `Length (${unit})` },
			{ field: 'qty', header: 'Qty' },
			{ field: 'material', header: 'Material', optional: true }
		],
		pieces.map((p) => ({
			label: p.label,
			length: p.length,
			qty: p.quantity,
			material: p.material
		})),
		delimiter
	);
}

/**
 * Sheet and linear stock in one table; columns a kind doesn't use are dropped when the shop has
 * none of that kind. A blank qty is unlimited, and grain is always written because a blank sheet
 * grain imports as vertical.
 */
export function stockToCsv(stock: Stock, unit: Unit, delimiter: Delimiter = ','): string {
	return toTable(
		[
			{ field: 'material', header: 'Material', optional: true },
			{ field: 'thickness', header: `Thickness (${unit})`, optional: true },
			{ field: 'width', header: `Width (${unit})`, optional: true },
			{ field: 'height', header: `Height (${unit})`, optional: true },
			{ field: 'length', header: `Length (${unit})`, optional: true },
			{ field: 'qty', header: 'Qty' },
			{ field: 'grain', header: 'Grain', optional: true }
		],
		[
			...stock.sheetTypes.map((s) => ({
				material: s.material,
				thickness: s.thickness,
				width: s.width,
				height: s.height,
				qty: s.quantity || '',
				grain: s.grain
			})),
			...stock.linearStocks.map((s) => ({
				material: s.material,
				length: s.length,
				qty: s.quantity || ''
			}))
		],
		delimiter
	);
}

/** File-name-safe version of a plan name, e.g. "Kitchen base cabinets" → "kitchen-base-cabinets". */
export function csvFileName(name: string, suffix: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug || 'cutlist'}-${suffix}.csv`;
}

/**
 * The same table as HTML, for the clipboard's text/html slot: spreadsheets paste it into
 * cells, while text fields (including our importer) take the plain CSV.
 */
export function csvToHtmlTable(csv: string): string {
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const [head = [], ...body] = parseDelimited(csv, ',');
	const row = (cells: string[], tag: 'th' | 'td') =>
		`<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
	return `<table><thead>${row(head, 'th')}</thead><tbody>${body.map((r) => row(r, 'td')).join('')}</tbody></table>`;
}
