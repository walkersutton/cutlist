import { describe, expect, it } from 'vitest';
import {
	csvFileName,
	csvToHtmlTable,
	guessUnit,
	parseCsv,
	parseDelimited,
	panelsToCsv,
	piecesToCsv,
	rowsToParts,
	rowsToStock,
	stockToCsv
} from './csv.js';

describe('parseDelimited', () => {
	it('handles quotes, escaped quotes, CRLF and blank lines', () => {
		expect(parseDelimited('a,"b, c","say ""hi"""\r\n\r\n1,2,3\n', ',')).toEqual([
			['a', 'b, c', 'say "hi"'],
			['1', '2', '3']
		]);
	});
});

describe('parseCsv', () => {
	it('matches headers by name in any order, ignoring extra columns', () => {
		const r = parseCsv('Qty,Notes,Part name,Height,Width\n2,x,Side,30,24\n');
		expect(r.rows).toEqual([
			expect.objectContaining({ label: 'Side', width: 24, height: 30, qty: 2 })
		]);
		expect(r.kind).toBe('parts');
		expect(r.headerless).toBe(false);
	});

	it('reads tab-separated pastes, fractions, grain and materials', () => {
		const r = parseCsv(
			'Label\tW\tH\tQty\tGrain\tMaterial\tThickness\nShelf\t23 1/2\t11-3/4\t3\tH\tBaltic birch\t3/4\n'
		);
		expect(r.rows[0]).toEqual({
			label: 'Shelf',
			width: 23.5,
			height: 11.75,
			length: null,
			qty: 3,
			grain: 'horizontal',
			material: 'Baltic birch',
			thickness: 0.75
		});
	});

	it('does not confuse single-letter aliases with longer headers', () => {
		// "h" must not match "Length", and "w" must not match "Rows".
		const r = parseCsv('Label,Length,Rows\nRail,36,9\n');
		expect(r.rows).toEqual([expect.objectContaining({ length: 36, width: null, height: null })]);
	});

	it('defaults a blank quantity (one part / unlimited stock) and skips unusable rows', () => {
		const r = parseCsv('Label,Width,Height,Qty\nA,10,10,\nB,,,\nC,10,10,0\nD,abc,10,1\n');
		expect(r.rows.map((x) => [x.label, x.qty])).toEqual([['A', null]]);
		expect(r.skipped).toBe(3);
	});

	it('detects the unit from headers or cells', () => {
		expect(parseCsv('Width (mm),Height (mm)\n600,300\n').unit).toBe('mm');
		expect(parseCsv('Label,Width,Height\nA,24",12"\n').unit).toBe('in');
		expect(parseCsv('Label,Width,Height\nA,600mm,300 mm\n').rows[0].width).toBe(600);
		expect(parseCsv('Label,Width,Height\nA,24,12\n').unit).toBeNull();
	});

	it('guesses millimetres from sizes nobody measures in inches', () => {
		expect(guessUnit(parseCsv('Label,Width,Height\nSide,600,720\n').rows)).toBe('mm');
		expect(guessUnit(parseCsv('Label,Width,Height,Thickness\nSide,40,70,18\n').rows)).toBe('mm');
		expect(guessUnit(parseCsv('Label,Width,Height\nSide,23.5,30\n').rows)).toBeNull();
	});

	it('assumes label, width, height, qty when there is no header', () => {
		const r = parseCsv('Side;24;30;2\nTop;24;12;1\n');
		expect(r.headerless).toBe(true);
		expect(r.rows.map((x) => [x.label, x.width, x.height, x.qty])).toEqual([
			['Side', 24, 30, 2],
			['Top', 24, 12, 1]
		]);
	});

	it('guesses stock for files without labels', () => {
		expect(parseCsv('Material,Width,Height,Qty\nMDF,48,96,\n').kind).toBe('stock');
	});

	it('strips a byte-order mark and thousands separators', () => {
		const r = parseCsv('﻿Width,Height\n"1,220","2,440"\n');
		expect(r.rows[0]).toEqual(expect.objectContaining({ width: 1220, height: 2440 }));
	});
});

describe('rowsToParts / rowsToStock', () => {
	const { rows } = parseCsv(
		'Label,Width,Height,Length,Qty,Material,Thickness\nSide,600,300,,2,Birch,18\nRail,,,900,,,\n'
	);

	it('splits sheet and linear rows and converts units', () => {
		const { panels, pieces } = rowsToParts(rows, 'mm', 'in');
		expect(panels).toEqual([
			{
				label: 'Side',
				width: 23.625,
				height: 11.75,
				quantity: 2,
				grain: 'any',
				material: 'Birch',
				thickness: 0.71875
			}
		]);
		expect(pieces).toEqual([{ label: 'Rail', length: 35.375, quantity: 1 }]);
	});

	it('keeps values unchanged in the same unit, and treats blank stock qty as unlimited', () => {
		const { sheetTypes, linearStocks } = rowsToStock(rows, 'mm', 'mm');
		expect(sheetTypes[0]).toEqual(
			expect.objectContaining({ width: 600, height: 300, quantity: 2, thickness: 18 })
		);
		// No grain column: sheet stock gets the app's default, parts get "any".
		expect(sheetTypes[0].grain).toBe('vertical');
		// Unlabelled stock falls back to the label as its material name.
		expect(linearStocks).toEqual([{ length: 900, quantity: 0, material: 'Rail' }]);
	});
});

describe('export', () => {
	it('round-trips panels through CSV', () => {
		const csv = panelsToCsv(
			[
				{
					id: '1',
					label: 'Side, left',
					width: 23.5,
					height: 30,
					quantity: 2,
					grain: 'vertical',
					material: 'Baltic birch',
					thickness: 0.75
				}
			],
			'in'
		);
		expect(csv.split('\r\n')[0]).toBe(
			'Label,Width (in),Height (in),Qty,Grain,Material,Thickness (in)'
		);
		const r = parseCsv(csv);
		expect(r.unit).toBe('in');
		expect(r.kind).toBe('parts');
		expect(rowsToParts(r.rows, 'in', 'in').panels).toEqual([
			{
				label: 'Side, left',
				width: 23.5,
				height: 30,
				quantity: 2,
				grain: 'vertical',
				material: 'Baltic birch',
				thickness: 0.75
			}
		]);
	});

	it('leaves out unused material columns and blanks "any" grain', () => {
		expect(
			panelsToCsv(
				[{ id: '1', label: 'Top', width: 30, height: 30, quantity: 2, grain: 'any' }],
				'in'
			)
		).toBe('Label,Width (in),Height (in),Qty,Grain\r\nTop,30,30,2,\r\n');
		expect(piecesToCsv([{ id: '2', label: '', length: 24, quantity: 1 }], 'in')).toBe(
			'Label,Length (in),Qty\r\n,24,1\r\n'
		);
	});

	it('writes tab-separated text for copying into a spreadsheet', () => {
		const tsv = piecesToCsv(
			[{ id: '2', label: 'Rail, top', length: 36, quantity: 4, material: 'Oak' }],
			'in',
			'\t'
		);
		expect(tsv).toBe('Label\tLength (in)\tQty\tMaterial\r\nRail, top\t36\t4\tOak\r\n');
		expect(rowsToParts(parseCsv(tsv).rows, 'in', 'in').pieces).toEqual([
			{ label: 'Rail, top', length: 36, quantity: 4, material: 'Oak' }
		]);
	});

	it('round-trips stock, keeping unlimited quantities', () => {
		const csv = stockToCsv(
			{
				sheetTypes: [
					{ id: '1', width: 1220, height: 2440, quantity: 0, grain: 'vertical', material: 'MDF' }
				],
				linearStocks: [{ id: '2', length: 2440, quantity: 5, material: '2×4 SPF' }]
			},
			'mm'
		);
		expect(csv.split('\r\n')[0]).toBe('Material,Width (mm),Height (mm),Length (mm),Qty,Grain');
		const r = parseCsv(csv);
		expect(r.kind).toBe('stock');
		expect(r.unit).toBe('mm');
		expect(rowsToStock(r.rows, 'mm', 'mm')).toEqual({
			sheetTypes: [{ width: 1220, height: 2440, quantity: 0, grain: 'vertical', material: 'MDF' }],
			linearStocks: [{ length: 2440, quantity: 5, material: '2×4 SPF' }]
		});
	});

	it('turns CSV into an HTML table for pasting into spreadsheets', () => {
		expect(csvToHtmlTable('Label,Qty\r\n"Side, <left>",2\r\n')).toBe(
			'<table><thead><tr><th>Label</th><th>Qty</th></tr></thead>' +
				'<tbody><tr><td>Side, &lt;left&gt;</td><td>2</td></tr></tbody></table>'
		);
	});

	it('makes file names from plan names', () => {
		expect(csvFileName('Kitchen: base cabinets!', 'parts')).toBe('kitchen-base-cabinets-parts.csv');
		expect(csvFileName('  ', 'stock')).toBe('cutlist-stock.csv');
	});
});
