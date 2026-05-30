<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { pack, type PanelInput, type SheetType } from '$lib/packer.js';
	import { packLinear, type LinearStock, type LinearPiece } from '$lib/linear-packer.js';

	const STORAGE_KEY = 'cutlist_v1';

	function load<T>(key: string, fallback: T): T {
		try {
			const raw = localStorage.getItem(key);
			if (raw) return JSON.parse(raw) as T;
		} catch {
			/* ignore */
		}
		return fallback;
	}

	const saved = load<Record<string, unknown>>(STORAGE_KEY, {});

	let nextId = 1;
	function uid() {
		return String(nextId++);
	}

	function maxIdFrom(...arrays: Array<{ id: string }[]>) {
		let max = 0;
		for (const arr of arrays)
			for (const item of arr) {
				const n = parseInt(item.id, 10);
				if (!isNaN(n) && n > max) max = n;
			}
		return max;
	}

	const PALETTE = [
		'#93c5fd',
		'#86efac',
		'#fcd34d',
		'#f9a8d4',
		'#a5b4fc',
		'#6ee7b7',
		'#fca5a5',
		'#fdba74',
		'#c4b5fd',
		'#67e8f9'
	];

	let mode = $state<'sheet' | 'linear'>((saved.mode as 'sheet' | 'linear') ?? 'sheet');
	let unit = $state<'in' | 'mm'>((saved.unit as 'in' | 'mm') ?? 'in');
	const unitLabel = $derived(unit === 'in' ? '"' : ' mm');
	const dimStep = $derived(unit === 'in' ? 0.125 : 1);
	const dimMin = $derived(unit === 'in' ? 0.125 : 1);

	function setUnit(to: 'in' | 'mm') {
		if (to === unit) return;
		const factor = to === 'mm' ? 25.4 : 1 / 25.4;
		for (const st of sheetTypes) {
			st.width =
				to === 'mm' ? Math.round(st.width * factor) : Math.round(st.width * factor * 8) / 8;
			st.height =
				to === 'mm' ? Math.round(st.height * factor) : Math.round(st.height * factor * 8) / 8;
		}
		for (const p of panels) {
			p.width = to === 'mm' ? Math.round(p.width * factor) : Math.round(p.width * factor * 8) / 8;
			p.height =
				to === 'mm' ? Math.round(p.height * factor) : Math.round(p.height * factor * 8) / 8;
		}
		for (const ls of linearStocks) {
			ls.length =
				to === 'mm' ? Math.round(ls.length * factor) : Math.round(ls.length * factor * 8) / 8;
		}
		for (const lp of linearPieces) {
			lp.length =
				to === 'mm' ? Math.round(lp.length * factor) : Math.round(lp.length * factor * 8) / 8;
		}
		kerf = to === 'mm' ? Math.round(kerf * factor * 10) / 10 : Math.round(kerf * factor * 8) / 8;
		unit = to;
	}

	let kerf = $state<number>((saved.kerf as number) ?? 0.125);
	let settingsOpen = $state(false);
	let shareOpen = $state(false);
	let sheetZoom = $state(1.0);
	let copyLabel = $state('Copy plan');

	$effect(() => {
		if (settingsOpen || shareOpen) {
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	});

	let sheetTypes = $state<SheetType[]>(
		(saved.sheetTypes as SheetType[]) ?? [
			{ id: uid(), width: 48, height: 96, quantity: 0, grain: 'vertical' }
		]
	);
	let panels = $state<PanelInput[]>((saved.panels as PanelInput[]) ?? []);
	let linearStocks = $state<LinearStock[]>(
		(saved.linearStocks as LinearStock[]) ?? [{ id: uid(), length: 96, quantity: 0 }]
	);
	let linearPieces = $state<LinearPiece[]>((saved.linearPieces as LinearPiece[]) ?? []);

	nextId = untrack(() => maxIdFrom(sheetTypes, panels, linearStocks, linearPieces) + 1);

	function addSheetType() {
		const d = unit === 'mm' ? { w: 1220, h: 2440 } : { w: 48, h: 96 };
		sheetTypes = [
			...sheetTypes,
			{ id: uid(), width: d.w, height: d.h, quantity: 0, grain: 'vertical' }
		];
	}
	function removeSheetType(id: string) {
		sheetTypes = sheetTypes.filter((s) => s.id !== id);
	}
	function addPanel() {
		const d = unit === 'mm' ? { w: 300, h: 600 } : { w: 24, h: 24 };
		panels = [
			...panels,
			{ id: uid(), label: '', width: d.w, height: d.h, quantity: 1, grain: 'any' }
		];
	}
	function removePanel(id: string) {
		panels = panels.filter((p) => p.id !== id);
	}
	function addLinearStock() {
		linearStocks = [...linearStocks, { id: uid(), length: unit === 'mm' ? 2440 : 96, quantity: 0 }];
	}
	function removeLinearStock(id: string) {
		linearStocks = linearStocks.filter((s) => s.id !== id);
	}
	function addLinearPiece() {
		linearPieces = [
			...linearPieces,
			{ id: uid(), label: '', length: unit === 'mm' ? 300 : 24, quantity: 1 }
		];
	}
	function removeLinearPiece(id: string) {
		linearPieces = linearPieces.filter((p) => p.id !== id);
	}

	function panelColor(id: string): string {
		const idx = panels.findIndex((p) => p.id === id);
		return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
	}
	function pieceColor(id: string): string {
		const idx = linearPieces.findIndex((p) => p.id === id);
		return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
	}

	let packResult = $derived(pack(sheetTypes, panels, kerf));
	let sheets = $derived(packResult.sheets);
	let linearPackResult = $derived(packLinear(linearStocks, linearPieces, kerf));
	let linearBoards = $derived(linearPackResult.boards);

	let hasResults = $derived(mode === 'sheet' ? sheets.length > 0 : linearBoards.length > 0);

	let sheetSummary = $derived(
		(() => {
			const map: Record<string, { w: number; h: number; count: number }> = {};
			for (const s of sheets) {
				const key = `${s.sheetWidth}×${s.sheetHeight}`;
				const e = map[key];
				if (e) e.count++;
				else map[key] = { w: s.sheetWidth, h: s.sheetHeight, count: 1 };
			}
			return Object.values(map);
		})()
	);

	let linearSummary = $derived(
		(() => {
			const map: Record<number, { length: number; count: number }> = {};
			for (const b of linearBoards) {
				const e = map[b.stockLength];
				if (e) e.count++;
				else map[b.stockLength] = { length: b.stockLength, count: 1 };
			}
			return Object.values(map);
		})()
	);

	let sheetUnplaced = $derived(
		(() => {
			const map: Record<string, { label: string; count: number; reason: string }> = {};
			for (const { panel, reason } of packResult.unplaced) {
				const key = `${panel.id}:${reason}`;
				const e = map[key];
				if (e) e.count++;
				else
					map[key] = { label: panel.label || `${panel.width}×${panel.height}`, count: 1, reason };
			}
			return Object.values(map);
		})()
	);

	let linearUnplaced = $derived(
		(() => {
			const map: Record<string, { label: string; count: number; reason: string }> = {};
			for (const { piece, reason } of linearPackResult.unplaced) {
				const key = `${piece.id}:${reason}`;
				const e = map[key];
				if (e) e.count++;
				else map[key] = { label: piece.label || piece.length + unitLabel, count: 1, reason };
			}
			return Object.values(map);
		})()
	);

	let wastePctTotal = $derived(
		(() => {
			if (mode === 'sheet') {
				if (!sheets.length) return null;
				const totalArea = sheets.reduce((s, sh) => s + sh.sheetWidth * sh.sheetHeight, 0);
				const used = sheets.reduce(
					(s, sh) =>
						s +
						sh.placements.reduce(
							(a: number, p: { width: number; height: number }) => a + p.width * p.height,
							0
						),
					0
				);
				return Math.round((1 - used / totalArea) * 100);
			}
			if (!linearBoards.length) return null;
			const total = linearBoards.reduce((s, b) => s + b.stockLength, 0);
			const used = linearBoards.reduce(
				(s, b) => s + b.placements.reduce((a: number, p: { length: number }) => a + p.length, 0),
				0
			);
			return Math.round((1 - used / total) * 100);
		})()
	);

	const SVG_MAX = 400;
	function svgScale(w: number, h: number) {
		return Math.min(SVG_MAX / w, SVG_MAX / h);
	}
	const LINEAR_BAR_W = 560;
	let linearScale = $derived(
		linearBoards.length > 0 ? LINEAR_BAR_W / Math.max(...linearBoards.map((b) => b.stockLength)) : 1
	);

	$effect(() => {
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ mode, unit, kerf, sheetTypes, panels, linearStocks, linearPieces })
			);
		} catch {
			/* ignore */
		}
	});

	function parseMeasurement(s: string): number | null {
		s = s.trim();
		const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
		if (frac) {
			const den = parseInt(frac[2], 10);
			return den === 0 ? null : parseInt(frac[1], 10) / den;
		}
		const n = parseFloat(s);
		return isNaN(n) ? null : n;
	}

	function applyKerf(e: Event) {
		const el = e.target as HTMLInputElement;
		const v = parseMeasurement(el.value);
		if (v !== null && v >= 0) kerf = v;
		el.value = String(kerf);
	}

	function reset() {
		if (!confirm('Reset everything? This will clear all sheets, panels, and cuts.')) return;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* ignore */
		}
		sheetTypes = [{ id: uid(), width: 48, height: 96, quantity: 0, grain: 'vertical' }];
		panels = [];
		linearStocks = [{ id: uid(), length: 96, quantity: 0 }];
		linearPieces = [];
		kerf = 0.125;
		mode = 'sheet';
		unit = 'in';
		settingsOpen = false;
	}

	function shouldOpenPrintableTab() {
		const ua = navigator.userAgent;
		const isIOS =
			/iPad|iPhone|iPod/.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		return isIOS || /Android|Mobile/.test(ua);
	}

	function printPlan() {
		const ule = unit === 'in' ? '&quot;' : ' mm';
		function esc(s: string) {
			return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
		function buildSheetSvg(sheet: (typeof sheets)[0]): string {
			const PMAX = 280;
			const sc = Math.min(PMAX / sheet.sheetWidth, PMAX / sheet.sheetHeight);
			const w = sheet.sheetWidth * sc,
				h = sheet.sheetHeight * sc;
			let s = `<svg width="${w.toFixed(1)}" height="${h.toFixed(1)}" style="display:block;border-radius:4px;overflow:hidden">`;
			s += `<rect width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#f4f4f5"/>`;
			const sheetIsHoriz = sheet.grain === 'horizontal';
			const grainSpan = sheetIsHoriz ? h : w;
			const grainCount = Math.max(1, Math.floor(grainSpan / 14) - 1);
			for (let i = 0; i < grainCount; i++) {
				const off = ((i + 1) * grainSpan) / (grainCount + 1);
				if (sheetIsHoriz)
					s += `<line x1="3" y1="${off.toFixed(1)}" x2="${(w - 3).toFixed(1)}" y2="${off.toFixed(1)}" stroke="#a1a1aa" stroke-width="0.6" opacity="0.5"/>`;
				else
					s += `<line x1="${off.toFixed(1)}" y1="3" x2="${off.toFixed(1)}" y2="${(h - 3).toFixed(1)}" stroke="#a1a1aa" stroke-width="0.6" opacity="0.5"/>`;
			}
			for (const p of sheet.placements) {
				const px = p.x * sc,
					py = p.y * sc,
					pw = p.width * sc,
					ph = p.height * sc;
				s += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="${panelColor(p.panelId)}" rx="2"/>`;
				if (p.grain !== 'any' && pw > 8 && ph > 8) {
					const eg = p.rotated ? (p.grain === 'horizontal' ? 'vertical' : 'horizontal') : p.grain;
					const isH = eg === 'horizontal';
					const span = isH ? ph : pw;
					const cnt = Math.max(1, Math.floor(span / 10) - 1);
					for (let i = 0; i < cnt; i++) {
						const off = ((i + 1) * span) / (cnt + 1);
						if (isH)
							s += `<line x1="${(px + 4).toFixed(1)}" y1="${(py + off).toFixed(1)}" x2="${(px + pw - 4).toFixed(1)}" y2="${(py + off).toFixed(1)}" stroke="#1e3a5f" stroke-width="0.75" opacity="0.2"/>`;
						else
							s += `<line x1="${(px + off).toFixed(1)}" y1="${(py + 4).toFixed(1)}" x2="${(px + off).toFixed(1)}" y2="${(py + ph - 4).toFixed(1)}" stroke="#1e3a5f" stroke-width="0.75" opacity="0.2"/>`;
					}
				}
				if (pw > 16) {
					const wfs = Math.max(6, Math.min(9, pw / 6));
					s += `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + 3).toFixed(1)}" text-anchor="middle" dominant-baseline="hanging" font-size="${wfs.toFixed(1)}" fill="#18181b" font-family="system-ui,sans-serif" opacity="0.75">${p.width}${ule}</text>`;
				}
				if (ph > 20) {
					const hfs = Math.max(6, Math.min(9, ph / 6));
					const hx = px + Math.ceil(hfs / 2) + 2;
					s += `<text x="${hx.toFixed(1)}" y="${(py + ph / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${hfs.toFixed(1)}" fill="#18181b" font-family="system-ui,sans-serif" opacity="0.75" transform="rotate(-90 ${hx.toFixed(1)} ${(py + ph / 2).toFixed(1)})">${p.height}${ule}</text>`;
				}
				if (pw > 30 && ph > 18 && p.label) {
					const fs = Math.min(11, pw / 5, ph / 3);
					s += `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + ph / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${fs.toFixed(1)}" fill="#18181b" font-family="system-ui,sans-serif" font-weight="500">${esc(p.label)}${p.rotated ? ' ↺' : ''}</text>`;
				}
			}
			return s + '</svg>';
		}
		const cutList = panels.filter((p) => p.width > 0 && p.height > 0 && p.quantity > 0);
		const dateStr = new Date().toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const materialsRows = sheetSummary
			.map((r) => `<tr><td>${r.w}×${r.h}${ule}</td><td>${r.count}</td></tr>`)
			.join('');
		const cutRows = cutList
			.map(
				(p) =>
					`<tr><td><span class="sw" style="background:${panelColor(p.id)}"></span>${esc(p.label || '—')}</td><td>${p.width}${ule}</td><td>${p.height}${ule}</td><td class="num">${p.quantity}</td><td>${p.grain}</td></tr>`
			)
			.join('');
		const sheetCards = sheets
			.map((sheet) => {
				const placements = sheet.placements
					.map((p) => {
						const name = p.label ? esc(p.label) : `${p.width}×${p.height}${ule}`;
						const rot = p.rotated ? ' <span class="rot">↺</span>' : '';
						return `<li><span class="sw" style="background:${panelColor(p.panelId)}"></span>${name} — ${p.width}×${p.height}${ule}${rot}</li>`;
					})
					.join('');
				return `<div class="card"><p class="clabel">Sheet ${sheet.index + 1} &nbsp;·&nbsp; ${sheet.sheetWidth}×${sheet.sheetHeight}${ule} &nbsp;·&nbsp; ${sheet.wastePercent}% waste</p><div class="card-body">${buildSheetSvg(sheet)}<ul class="plist">${placements}</ul></div></div>`;
			})
			.join('');
		const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Cut Plan</title><style>*{box-sizing:border-box;margin:0;padding:0}@page{size:letter;margin:.75in}body{font-family:system-ui,-apple-system,sans-serif;font-size:10pt;color:#18181b}.screen-actions{display:none}h1{font-size:16pt;font-weight:700;margin-bottom:2pt}.meta{font-size:8.5pt;color:#71717a;margin-bottom:14pt}h2{font-size:11pt;font-weight:600;margin:14pt 0 5pt;padding-bottom:3pt;border-bottom:1px solid #e4e4e7}table{width:100%;border-collapse:collapse;font-size:9pt}thead th{text-align:left;padding:3pt 8pt;background:#f4f4f5;font-weight:600}tbody td{padding:3pt 8pt;border-bottom:1px solid #f4f4f5;vertical-align:middle}tbody tr:last-child td{border-bottom:none}.num{text-align:right}.sw{display:inline-block;width:8pt;height:8pt;border-radius:2pt;vertical-align:middle;margin-right:3pt}.sheets{display:flex;flex-wrap:wrap;gap:14pt;margin-top:6pt}.card{break-inside:avoid;page-break-inside:avoid}.clabel{font-size:8pt;color:#71717a;margin-bottom:3pt}.card-body{display:flex;flex-direction:row;align-items:flex-start;gap:10pt}.plist{margin-top:0;font-size:8pt;color:#3f3f46;list-style:none}.plist li{padding:1pt 0}.rot{font-style:normal}@media screen{body{padding:18px;font-size:12px;background:white}.screen-actions{display:flex;position:sticky;top:0;z-index:1;align-items:center;gap:10px;margin:-18px -18px 18px;padding:12px 18px;border-bottom:1px solid #e4e4e7;background:rgba(255,255,255,.96);backdrop-filter:blur(8px)}.screen-actions button{border:1px solid #d4d4d8;border-radius:8px;background:#18181b;color:white;padding:9px 12px;font:600 14px system-ui,-apple-system,sans-serif}.screen-actions p{font-size:12px;color:#71717a}}@media print{.screen-actions{display:none!important}}</style></head><body><div class="screen-actions"><button type="button" onclick="window.print()">Print / PDF</button><p>If the preview did not open automatically, tap Print / PDF.</p></div><h1>Cut Plan</h1><p class="meta">${dateStr} &nbsp;·&nbsp; Kerf: ${kerf}${ule}</p><h2>Materials Needed</h2><table><thead><tr><th>Sheet Size</th><th>Qty</th></tr></thead><tbody>${materialsRows}</tbody></table><h2>Cut List</h2><table><thead><tr><th>Label</th><th>Width</th><th>Height</th><th class="num">Qty</th><th>Grain</th></tr></thead><tbody>${cutRows}</tbody></table><h2>Sheet Layouts</h2><div class="sheets">${sheetCards}</div><script>window.addEventListener('load',()=>{window.print();});<\/script></body></html>`; // eslint-disable-line no-useless-escape
		if (shouldOpenPrintableTab()) {
			const win = window.open('', '_blank');
			if (win) {
				win.document.open();
				win.document.write(html);
				win.document.close();
				win.focus();
				return;
			}
		}
		const iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
		document.body.appendChild(iframe);
		iframe.contentDocument!.write(html);
		iframe.contentDocument!.close();
		iframe.contentWindow!.addEventListener('afterprint', () => iframe.remove());
		iframe.contentWindow!.print();
	}

	async function copyPlan() {
		const ul = unit === 'in' ? '"' : ' mm';
		const lines: string[] = [];
		lines.push(
			`Cut Plan — ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`
		);
		lines.push(`Kerf: ${kerf}${ul}`);
		lines.push('');
		lines.push('MATERIALS');
		for (const row of sheetSummary) lines.push(`  ${row.count}× ${row.w}×${row.h}${ul}`);
		function grainArrow(grain: string) {
			if (grain === 'horizontal') return 'grain →';
			if (grain === 'vertical') return 'grain ↑';
			return '';
		}
		function asciiSheetDiagram(sheet: (typeof sheets)[0]): string[] {
			const CW = 36;
			const scX = CW / sheet.sheetWidth;
			const scY = scX * 0.5;
			const CH = Math.min(40, Math.max(4, Math.ceil(sheet.sheetHeight * scY)));
			const grid: string[][] = Array.from({ length: CH }, () => Array(CW).fill(' '));
			function put(r: number, c: number, ch: string) {
				if (r >= 0 && r < CH && c >= 0 && c < CW) grid[r][c] = ch;
			}
			function putH(r: number, c: number) {
				const e = grid[r]?.[c];
				put(r, c, e === '|' || e === '+' ? '+' : '-');
			}
			function putV(r: number, c: number) {
				const e = grid[r]?.[c];
				put(r, c, e === '-' || e === '+' ? '+' : '|');
			}
			for (const p of sheet.placements) {
				const x1 = Math.floor(p.x * scX),
					y1 = Math.floor(p.y * scY);
				const x2 = Math.min(CW - 1, Math.ceil((p.x + p.width) * scX));
				const y2 = Math.min(CH - 1, Math.ceil((p.y + p.height) * scY));
				for (let c = x1; c <= x2 && c < CW; c++) {
					putH(y1, c);
					putH(y2, c);
				}
				for (let r = y1 + 1; r < y2; r++) {
					putV(r, x1);
					putV(r, x2);
				}
				put(y1, x1, '+');
				put(y1, x2, '+');
				put(y2, x1, '+');
				put(y2, x2, '+');
				const innerW = x2 - x1 - 2;
				if (innerW > 0) {
					const lbl = (p.label || `${p.width}×${p.height}${ul}`).slice(0, innerW);
					const midR = Math.round((y1 + y2) / 2);
					if (midR > y1 && midR < y2) {
						const startC = x1 + 1 + Math.floor((innerW - lbl.length) / 2);
						for (let i = 0; i < lbl.length; i++) {
							const c = startC + i;
							if (c > x1 && c < x2 && c < CW) grid[midR][c] = lbl[i];
						}
					}
				}
			}
			return [
				'+' + '-'.repeat(CW) + '+',
				...grid.map((row) => '|' + row.join('') + '|'),
				'+' + '-'.repeat(CW) + '+'
			].map((l) => '  ' + l);
		}
		lines.push('');
		lines.push('CUT LIST');
		for (const p of panels.filter((p) => p.width > 0 && p.height > 0 && p.quantity > 0)) {
			const name = p.label ? `${p.label}  ` : '';
			const g = grainArrow(p.grain);
			lines.push(`  ${name}${p.width}×${p.height}${ul}  ×${p.quantity}${g ? `  ${g}` : ''}`);
		}
		lines.push('');
		lines.push('SHEET LAYOUTS');
		lines.push('  (| = vertical grain  - = horizontal grain)');
		for (const sheet of sheets) {
			lines.push('');
			lines.push(
				`  Sheet ${sheet.index + 1} — ${sheet.sheetWidth}×${sheet.sheetHeight}${ul}  ${grainArrow(sheet.grain) || 'any grain'}`
			);
			for (const p of sheet.placements) {
				const name = p.label ? `${p.label}  ` : '';
				const rot = p.rotated ? ' ↺' : '';
				const eg =
					p.grain === 'any'
						? 'any'
						: p.rotated
							? p.grain === 'horizontal'
								? 'vertical'
								: 'horizontal'
							: p.grain;
				const g = grainArrow(eg);
				lines.push(`    ${name}${p.width}×${p.height}${ul}${rot}${g ? `  ${g}` : ''}`);
			}
			for (const dl of asciiSheetDiagram(sheet)) lines.push(dl);
		}
		await navigator.clipboard.writeText(lines.join('\n'));
		copyLabel = 'Copied!';
		setTimeout(() => (copyLabel = 'Copy plan'), 2000);
	}

	// CSS helpers
	const inputBase =
		'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-base text-zinc-900 placeholder:text-zinc-400 sm:text-[13.5px] sm:py-1.5';
	const numBase = inputBase + ' text-right tabular-nums';
	const cardCls = 'row mb-2 rounded-xl border border-zinc-300 bg-zinc-50 p-3';
	const delCls =
		'del flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-500';
	const addBtnCls =
		'mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900';
	const stepBtnCls =
		'flex h-9 w-8 shrink-0 items-center justify-center border border-zinc-200 text-base leading-none text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 active:bg-zinc-100';
	const stepInputCls =
		'w-11 border-y border-zinc-200 bg-white text-center text-base tabular-nums text-zinc-900 placeholder:text-zinc-400 focus:relative sm:text-sm';
</script>

<svelte:head>
	<title>Cut List Tool — Free 1D & 2D Cut List Optimizer</title>
	<meta
		name="description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D). Supports kerf, grain direction, inches, and millimeters."
	/>
	<meta
		name="keywords"
		content="cut list, cut list optimizer, plywood cut list, lumber cut list, woodworking tool, 2d packing, linear packing"
	/>
	<link rel="canonical" href="https://cutlist.walkersutton.com" />
	<script type="application/ld+json">
		{
			"@context": "https://schema.org",
			"@type": "WebApplication",
			"name": "Cut List Tool",
			"url": "https://cutlist.walkersutton.com",
			"description": "Free online cut list optimizer for sheet goods (2D) and linear stock (1D).",
			"applicationCategory": "Tool",
			"operatingSystem": "All"
		}
	</script>
	<meta property="og:title" content="Cut List Tool — Free 1D & 2D Cut List Optimizer" />
	<meta
		property="og:description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D)."
	/>
	<meta property="og:url" content="https://cutlist.walkersutton.com" />
	<meta name="twitter:title" content="Cut List Tool — Free 1D & 2D Cut List Optimizer" />
	<meta
		name="twitter:description"
		content="Plan your cuts without the fuss. Free online cut list optimizer for sheet goods (2D) and linear stock (1D)."
	/>
</svelte:head>

<div
	class="flex min-h-screen flex-col bg-white text-zinc-900 lg:h-screen lg:min-h-0 lg:overflow-hidden"
>
	<!-- ===== Header ===== -->
	<header
		class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200/80 bg-white/95 px-4 backdrop-blur lg:h-16 lg:px-6"
	>
		<!-- Logo -->
		<div class="flex items-center gap-2">
			<img src="/logo.jpg" alt="" class="h-7 w-7 lg:h-8 lg:w-8" />
			<span class="text-lg font-semibold tracking-tight">cutlist</span>
		</div>

		<!-- Desktop toolbar -->
		<div class="ml-3 hidden items-center gap-2 lg:flex">
			<div
				class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			>
				<button
					onclick={() => (mode = 'sheet')}
					class="rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors {mode ===
					'sheet'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Sheet</button
				>
				<button
					onclick={() => (mode = 'linear')}
					class="rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors {mode ===
					'linear'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Linear</button
				>
			</div>
			<div
				class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			>
				<button
					onclick={() => setUnit('in')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {unit ===
					'in'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">in</button
				>
				<button
					onclick={() => setUnit('mm')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {unit ===
					'mm'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">mm</button
				>
			</div>
			<div class="mx-1 h-5 w-px bg-zinc-200"></div>
			<label class="flex items-center gap-1.5 text-[13px] text-zinc-500">
				kerf
				<input
					type="text"
					inputmode="decimal"
					value={kerf}
					onblur={applyKerf}
					onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
					class="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-right text-[13px] text-zinc-900 tabular-nums"
				/>
				<span class="text-zinc-400">{unit}</span>
			</label>
		</div>

		<!-- Mobile mode toggle -->
		<div class="ml-auto lg:hidden">
			<div
				class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
			>
				<button
					onclick={() => (mode = 'sheet')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {mode ===
					'sheet'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Sheet</button
				>
				<button
					onclick={() => (mode = 'linear')}
					class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {mode ===
					'linear'
						? 'bg-white text-zinc-900 shadow-sm'
						: 'text-zinc-500 hover:text-zinc-800'}">Linear</button
				>
			</div>
		</div>

		<!-- Desktop right actions -->
		<div class="ml-auto hidden items-center gap-1.5 lg:flex">
			{#if hasResults}
				<button
					onclick={copyPlan}
					class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><rect x="5.5" y="5.5" width="8" height="9" rx="1.3" /><path
							d="M10 5.5V3.2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h2.5"
						/></svg
					>
					{copyLabel}
				</button>
				<button
					onclick={printPlan}
					class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><path d="M4.5 5.5V2.5h7v3" /><rect x="2" y="5.5" width="12" height="5.5" rx="1" /><path
							d="M4.5 8.5h7v4.5h-7z"
						/></svg
					>
					Print / PDF
				</button>
				<div class="mx-1 h-5 w-px bg-zinc-200"></div>
			{/if}
			<button
				onclick={reset}
				class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path
						d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
					/></svg
				>
				Reset
			</button>
		</div>
	</header>

	<!-- ===== Body: two-pane on lg ===== -->
	<div
		class="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(400px,460px)_1fr] xl:grid-cols-[480px_1fr]"
	>
		<!-- Left pane: inputs -->
		<div class="border-zinc-200/80 px-4 pt-5 pb-28 lg:overflow-y-auto lg:border-r lg:px-6 lg:pb-10">
			{#if mode === 'sheet'}
				<div class="space-y-7">
					<!-- Sheet stock -->
					<section>
						<div class="mb-2.5 flex items-baseline justify-between gap-2">
							<div class="flex items-baseline gap-2">
								<h2
									class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
								>
									Sheet stock
								</h2>
								<span class="text-xs text-zinc-400 tabular-nums">{sheetTypes.length}</span>
							</div>
							<span class="shrink-0 text-[11px] whitespace-nowrap text-zinc-400">blank qty = ∞</span
							>
						</div>
						{#each sheetTypes as st (st.id)}
							<div class={cardCls}>
								<div class="flex items-end gap-2">
									<label class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Width ({unit})</span
										>
										<input
											type="number"
											inputmode="decimal"
											class={numBase}
											min={dimMin}
											step={dimStep}
											bind:value={st.width}
										/>
									</label>
									<span class="pb-2 text-zinc-300">×</span>
									<label class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Height ({unit})</span
										>
										<input
											type="number"
											inputmode="decimal"
											class={numBase}
											min={dimMin}
											step={dimStep}
											bind:value={st.height}
										/>
									</label>
								</div>
								<div class="mt-3 flex items-center gap-2">
									<div
										class="inline-flex items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 ring-1 ring-zinc-200/70"
									>
										<button
											type="button"
											onclick={() => (st.grain = 'horizontal')}
											class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {st.grain ===
											'horizontal'
												? 'bg-white text-zinc-900 shadow-sm'
												: 'text-zinc-500 hover:text-zinc-800'}">Horiz →</button
										>
										<button
											type="button"
											onclick={() => (st.grain = 'vertical')}
											class="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors {st.grain ===
											'vertical'
												? 'bg-white text-zinc-900 shadow-sm'
												: 'text-zinc-500 hover:text-zinc-800'}">Vert ↑</button
										>
									</div>
									<div class="ml-auto flex items-center gap-2">
										<span class="text-[11px] text-zinc-400">qty</span>
										<div class="flex items-stretch">
											<button
												type="button"
												class="{stepBtnCls} rounded-l-lg"
												onclick={() => {
													if (st.quantity > 0) st.quantity -= 1;
												}}>−</button
											>
											<input
												type="number"
												inputmode="numeric"
												min="0"
												value={st.quantity || ''}
												placeholder="∞"
												oninput={(e) => {
													st.quantity = Number((e.target as HTMLInputElement).value) || 0;
												}}
												class={stepInputCls}
											/>
											<button
												type="button"
												class="{stepBtnCls} rounded-r-lg"
												onclick={() => {
													st.quantity += 1;
												}}>+</button
											>
										</div>
										<button
											onclick={() => removeSheetType(st.id)}
											class={delCls}
											aria-label="Remove"
										>
											<svg
												width="14"
												height="14"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												stroke-width="1.6"
												stroke-linecap="round"
												stroke-linejoin="round"
												><path
													d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
												/></svg
											>
										</button>
									</div>
								</div>
							</div>
						{/each}
						<button onclick={addSheetType} class={addBtnCls}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
							>
							Add sheet size
						</button>
					</section>

					<!-- Panels -->
					<section>
						<div class="mb-2.5 flex items-baseline justify-between gap-2">
							<div class="flex items-baseline gap-2">
								<h2
									class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
								>
									Panels
								</h2>
								<span class="text-xs text-zinc-400 tabular-nums">{panels.length}</span>
							</div>
							<span class="shrink-0 text-[11px] whitespace-nowrap text-zinc-400">pieces to cut</span
							>
						</div>
						{#each panels as panel (panel.id)}
							<div class={cardCls}>
								<div class="flex items-center gap-2">
									<span
										class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
										style="background:{panelColor(panel.id)}"
									></span>
									<input
										type="text"
										class="{inputBase} flex-1"
										placeholder="Label (optional)"
										bind:value={panel.label}
									/>
									<button onclick={() => removePanel(panel.id)} class={delCls} aria-label="Remove">
										<svg
											width="14"
											height="14"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
											><path
												d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
											/></svg
										>
									</button>
								</div>
								<div class="mt-2.5 flex items-end gap-2">
									<label class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Width ({unit})</span
										>
										<input
											type="number"
											inputmode="decimal"
											class={numBase}
											min={dimMin}
											step={dimStep}
											bind:value={panel.width}
										/>
									</label>
									<span class="pb-2 text-zinc-300">×</span>
									<label class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Height ({unit})</span
										>
										<input
											type="number"
											inputmode="decimal"
											class={numBase}
											min={dimMin}
											step={dimStep}
											bind:value={panel.height}
										/>
									</label>
								</div>
								<div class="mt-2.5 flex items-end gap-2">
									<label class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Grain</span
										>
										<select class={inputBase} bind:value={panel.grain}>
											<option value="any">Any ↕↔</option>
											<option value="horizontal">Horiz →</option>
											<option value="vertical">Vert ↑</option>
										</select>
									</label>
									<div class="flex flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Qty</span
										>
										<div class="flex items-stretch">
											<button
												type="button"
												class="{stepBtnCls} rounded-l-lg"
												onclick={() => {
													if (panel.quantity > 1) panel.quantity -= 1;
												}}>−</button
											>
											<input
												type="number"
												inputmode="numeric"
												min="1"
												bind:value={panel.quantity}
												class={stepInputCls}
											/>
											<button
												type="button"
												class="{stepBtnCls} rounded-r-lg"
												onclick={() => {
													panel.quantity += 1;
												}}>+</button
											>
										</div>
									</div>
								</div>
							</div>
						{/each}
						<button onclick={addPanel} class={addBtnCls}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
							>
							Add panel
						</button>
					</section>

					{#if sheetUnplaced.length > 0}
						<div class="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
							<p class="mb-1.5 text-xs font-semibold text-amber-800">Could not place all panels</p>
							<ul class="space-y-1">
								{#each sheetUnplaced as item (item.label + item.reason)}
									<li class="text-xs text-amber-700">
										{item.count > 1 ? `${item.count}× ` : ''}"{item.label}" — {item.reason ===
										'too_large'
											? 'too large to fit in any sheet'
											: 'not enough stock sheets available'}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Linear mode -->
				<div class="space-y-7">
					<!-- Stock -->
					<section>
						<div class="mb-2.5 flex items-baseline justify-between gap-2">
							<div class="flex items-baseline gap-2">
								<h2
									class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
								>
									Stock
								</h2>
								<span class="text-xs text-zinc-400 tabular-nums">{linearStocks.length}</span>
							</div>
							<span class="shrink-0 text-[11px] whitespace-nowrap text-zinc-400">blank qty = ∞</span
							>
						</div>
						{#each linearStocks as ls (ls.id)}
							<div class="{cardCls} flex items-end gap-3">
								<label class="flex min-w-0 flex-1 flex-col gap-1">
									<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
										>Length ({unit})</span
									>
									<input
										type="number"
										inputmode="decimal"
										class={numBase}
										min={dimMin}
										step={dimStep}
										bind:value={ls.length}
									/>
								</label>
								<div class="flex items-center gap-2 pb-0.5">
									<span class="text-[11px] text-zinc-400">qty</span>
									<div class="flex items-stretch">
										<button
											type="button"
											class="{stepBtnCls} rounded-l-lg"
											onclick={() => {
												if (ls.quantity > 0) ls.quantity -= 1;
											}}>−</button
										>
										<input
											type="number"
											inputmode="numeric"
											min="0"
											value={ls.quantity || ''}
											placeholder="∞"
											oninput={(e) => {
												ls.quantity = Number((e.target as HTMLInputElement).value) || 0;
											}}
											class={stepInputCls}
										/>
										<button
											type="button"
											class="{stepBtnCls} rounded-r-lg"
											onclick={() => {
												ls.quantity += 1;
											}}>+</button
										>
									</div>
									<button
										onclick={() => removeLinearStock(ls.id)}
										class={delCls}
										aria-label="Remove"
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
											><path
												d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
											/></svg
										>
									</button>
								</div>
							</div>
						{/each}
						<button onclick={addLinearStock} class={addBtnCls}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
							>
							Add stock length
						</button>
					</section>

					<!-- Cut list -->
					<section>
						<div class="mb-2.5 flex items-baseline justify-between gap-2">
							<div class="flex items-baseline gap-2">
								<h2
									class="text-[13px] font-semibold tracking-tight whitespace-nowrap text-zinc-900"
								>
									Cut list
								</h2>
								<span class="text-xs text-zinc-400 tabular-nums">{linearPieces.length}</span>
							</div>
							<span class="shrink-0 text-[11px] whitespace-nowrap text-zinc-400">pieces to cut</span
							>
						</div>
						{#each linearPieces as lp (lp.id)}
							<div class={cardCls}>
								<div class="flex items-center gap-2">
									<span
										class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
										style="background:{pieceColor(lp.id)}"
									></span>
									<input
										type="text"
										class="{inputBase} flex-1"
										placeholder="Label (optional)"
										bind:value={lp.label}
									/>
									<button
										onclick={() => removeLinearPiece(lp.id)}
										class={delCls}
										aria-label="Remove"
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
											><path
												d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
											/></svg
										>
									</button>
								</div>
								<div class="mt-2.5 flex items-end gap-3">
									<label class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Length ({unit})</span
										>
										<input
											type="number"
											inputmode="decimal"
											class={numBase}
											min={dimMin}
											step={dimStep}
											bind:value={lp.length}
										/>
									</label>
									<div class="flex flex-col gap-1">
										<span class="text-[10.5px] font-semibold tracking-wider text-zinc-400 uppercase"
											>Qty</span
										>
										<div class="flex items-stretch">
											<button
												type="button"
												class="{stepBtnCls} rounded-l-lg"
												onclick={() => {
													if (lp.quantity > 1) lp.quantity -= 1;
												}}>−</button
											>
											<input
												type="number"
												inputmode="numeric"
												min="1"
												bind:value={lp.quantity}
												class={stepInputCls}
											/>
											<button
												type="button"
												class="{stepBtnCls} rounded-r-lg"
												onclick={() => {
													lp.quantity += 1;
												}}>+</button
											>
										</div>
									</div>
								</div>
							</div>
						{/each}
						<button onclick={addLinearPiece} class={addBtnCls}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg
							>
							Add piece
						</button>
					</section>

					{#if linearUnplaced.length > 0}
						<div class="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
							<p class="mb-1.5 text-xs font-semibold text-amber-800">Could not place all pieces</p>
							<ul class="space-y-1">
								{#each linearUnplaced as item (item.label + item.reason)}
									<li class="text-xs text-amber-700">
										{item.count > 1 ? `${item.count}× ` : ''}"{item.label}" — {item.reason ===
										'too_large'
											? 'too long to fit in any stock'
											: 'not enough stock available'}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Right pane: results -->
		<div class="flex flex-col bg-zinc-50/70 lg:min-h-0 lg:overflow-hidden">
			{#if hasResults}
				<!-- Sticky results sub-header -->
				<div
					class="sticky top-14 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200/70 bg-zinc-50/90 px-4 py-3 backdrop-blur lg:top-0 lg:px-6"
				>
					<div class="flex flex-wrap items-center gap-1.5">
						{#if mode === 'sheet'}
							{#each sheetSummary as row (`${row.w}×${row.h}`)}
								<div
									class="flex items-baseline gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 whitespace-nowrap shadow-sm"
								>
									<span class="text-base font-semibold text-zinc-900 tabular-nums">{row.count}</span
									>
									<span class="text-xs text-zinc-500">× {row.w}×{row.h}{unitLabel}</span>
								</div>
							{/each}
						{:else}
							{#each linearSummary as row (row.length)}
								<div
									class="flex items-baseline gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 whitespace-nowrap shadow-sm"
								>
									<span class="text-base font-semibold text-zinc-900 tabular-nums">{row.count}</span
									>
									<span class="text-xs text-zinc-500">× {row.length}{unitLabel}</span>
								</div>
							{/each}
						{/if}
						{#if wastePctTotal != null}
							<div class="flex items-baseline gap-1.5 rounded-lg px-1 py-1.5">
								<span class="text-base font-semibold text-zinc-900 tabular-nums"
									>{wastePctTotal}%</span
								>
								<span class="text-xs text-zinc-500">waste</span>
							</div>
						{/if}
					</div>
					<div class="ml-auto flex items-center gap-1.5">
						{#if mode === 'sheet'}
							<div class="hidden items-center gap-1 sm:flex">
								<button
									onclick={() => (sheetZoom = Math.max(0.25, sheetZoom - 0.25))}
									class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-base leading-none text-zinc-600 hover:bg-zinc-50"
									aria-label="Zoom out">−</button
								>
								<span class="w-9 text-center text-xs text-zinc-500 tabular-nums"
									>{Math.round(sheetZoom * 100)}%</span
								>
								<button
									onclick={() => (sheetZoom = Math.min(4, sheetZoom + 0.25))}
									class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-base leading-none text-zinc-600 hover:bg-zinc-50"
									aria-label="Zoom in">+</button
								>
							</div>
						{/if}
					</div>
				</div>

				<!-- Diagrams -->
				<div class="px-4 py-5 lg:flex-1 lg:overflow-y-auto lg:px-6">
					{#if mode === 'sheet'}
						<div class="flex flex-wrap gap-4">
							{#each sheets as sheet (sheet.index)}
								{@const sc = svgScale(sheet.sheetWidth, sheet.sheetHeight) * sheetZoom}
								{@const svgW = sheet.sheetWidth * sc}
								{@const svgH = sheet.sheetHeight * sc}
								{@const sheetIsHoriz = sheet.grain === 'horizontal'}
								{@const grainSpan = sheetIsHoriz ? svgH : svgW}
								{@const grainCount = Math.max(1, Math.floor(grainSpan / 14) - 1)}
								<div class="rounded-2xl border border-zinc-300 bg-white p-3.5 shadow-sm">
									<div class="mb-2 flex items-center justify-between gap-3">
										<p class="text-xs font-medium text-zinc-700">
											Sheet {sheet.index + 1}<span class="text-zinc-400">
												· {sheet.sheetWidth}×{sheet.sheetHeight}{unitLabel}</span
											>
										</p>
										<span
											class="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 tabular-nums"
											>{sheet.wastePercent}% waste</span
										>
									</div>
									<svg
										viewBox="0 0 {svgW} {svgH}"
										width={svgW}
										height={svgH}
										style="display:block;overflow:hidden;max-width:100%;height:auto"
									>
										<rect width={svgW} height={svgH} fill="#f4f4f5" rx="3" />
										{#each [...Array(grainCount).keys()] as i (i)}
											{@const offset = (i + 1) * (grainSpan / (grainCount + 1))}
											{#if sheetIsHoriz}
												<line
													x1={3}
													y1={offset}
													x2={svgW - 3}
													y2={offset}
													stroke="#a1a1aa"
													stroke-width="0.6"
													opacity="0.5"
												/>
											{:else}
												<line
													x1={offset}
													y1={3}
													x2={offset}
													y2={svgH - 3}
													stroke="#a1a1aa"
													stroke-width="0.6"
													opacity="0.5"
												/>
											{/if}
										{/each}
										{#each sheet.placements as p (`${p.panelId}-${p.x}-${p.y}`)}
											{@const px = p.x * sc}
											{@const py = p.y * sc}
											{@const pw = p.width * sc}
											{@const ph = p.height * sc}
											<rect
												x={px}
												y={py}
												width={pw}
												height={ph}
												fill={panelColor(p.panelId)}
												rx="2"
											/>
											{#if p.grain !== 'any' && pw > 8 && ph > 8}
												{@const effectiveGrain = p.rotated
													? p.grain === 'horizontal'
														? 'vertical'
														: 'horizontal'
													: p.grain}
												{@const isHoriz = effectiveGrain === 'horizontal'}
												{@const span = isHoriz ? ph : pw}
												{@const count = Math.max(1, Math.floor(span / 10) - 1)}
												{#each [...Array(count).keys()] as i (i)}
													{@const offset = (i + 1) * (span / (count + 1))}
													{#if isHoriz}
														<line
															x1={px + 4}
															y1={py + offset}
															x2={px + pw - 4}
															y2={py + offset}
															stroke="#1e3a5f"
															stroke-width="0.75"
															opacity="0.2"
														/>
													{:else}
														<line
															x1={px + offset}
															y1={py + 4}
															x2={px + offset}
															y2={py + ph - 4}
															stroke="#1e3a5f"
															stroke-width="0.75"
															opacity="0.2"
														/>
													{/if}
												{/each}
											{/if}
											{#if pw > 16}
												{@const wfs = Math.max(6, Math.min(9 * sheetZoom, pw / 6))}
												<text
													x={px + pw / 2}
													y={py + 3}
													text-anchor="middle"
													dominant-baseline="hanging"
													font-size={wfs}
													fill="#18181b"
													font-family="Inter, system-ui, sans-serif"
													opacity="0.7">{p.width}{unitLabel}</text
												>
											{/if}
											{#if ph > 20}
												{@const hfs = Math.max(6, Math.min(9 * sheetZoom, ph / 6))}
												{@const hx = px + Math.ceil(hfs / 2) + 2}
												<text
													x={hx}
													y={py + ph / 2}
													text-anchor="middle"
													dominant-baseline="middle"
													font-size={hfs}
													fill="#18181b"
													font-family="Inter, system-ui, sans-serif"
													opacity="0.7"
													transform="rotate(-90 {hx} {py + ph / 2})">{p.height}{unitLabel}</text
												>
											{/if}
											{#if pw > 30 && ph > 18 && p.label}
												{@const fs = Math.min(11 * sheetZoom, pw / 5, ph / 3)}
												<text
													x={px + pw / 2}
													y={py + ph / 2}
													text-anchor="middle"
													dominant-baseline="middle"
													font-size={fs}
													fill="#18181b"
													font-family="Inter, system-ui, sans-serif"
													font-weight="600">{p.label}{p.rotated ? ' ↺' : ''}</text
												>
											{/if}
										{/each}
									</svg>
								</div>
							{/each}
						</div>
					{:else}
						<div class="space-y-3">
							{#each linearBoards as board (board.index)}
								{@const sc = linearScale}
								{@const svgW = board.stockLength * sc}
								<div class="rounded-2xl border border-zinc-300 bg-white p-3.5 shadow-sm">
									<p class="mb-2 text-xs font-medium text-zinc-700">
										Board {board.index + 1}<span class="text-zinc-400">
											· {board.stockLength}{unitLabel}</span
										>
										{#if board.stockLength - board.usedLength > 0}
											<span class="ml-2 text-zinc-400"
												>{Math.round((board.stockLength - board.usedLength) * 100) / 100}{unitLabel} remaining</span
											>
										{/if}
									</p>
									<div class="overflow-x-auto">
										<svg
											width={svgW}
											height={40}
											style="display:block;border-radius:6px;overflow:hidden;min-width:100%"
										>
											<rect x={0} y={0} width={svgW} height={40} fill="#f4f4f5" />
											{#each board.placements as p (`${p.pieceId}-${p.start}`)}
												{@const px = p.start * sc}
												{@const pw = p.length * sc}
												<rect
													x={px + 0.5}
													y={0.5}
													width={Math.max(0, pw - 1)}
													height={39}
													fill={pieceColor(p.pieceId)}
													rx="3"
												/>
												{#if pw > 20}
													<text
														x={px + pw / 2}
														y={20}
														text-anchor="middle"
														dominant-baseline="middle"
														font-size={Math.min(10, pw / 3)}
														fill="#18181b"
														font-family="Inter, system-ui, sans-serif"
														font-weight="600">{p.label || '?'}</text
													>
												{/if}
											{/each}
										</svg>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<!-- Empty state -->
				<div class="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
					<div
						class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-zinc-300 shadow-sm ring-1 ring-zinc-200/70"
					>
						<svg
							width="28"
							height="28"
							viewBox="0 0 22 22"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="11" cy="11" r="7.5" />
							<circle cx="11" cy="11" r="2" />
						</svg>
					</div>
					<p class="text-sm font-medium text-zinc-500">No layout yet</p>
					<p class="mt-1 max-w-[15rem] text-[13px] text-zinc-400">
						{mode === 'sheet'
							? 'Add at least one sheet size and a panel to see your cut layout.'
							: 'Add a stock length and a piece to see your cut layout.'}
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Mobile footer -->
	<div class="pt-2 pb-24 text-center lg:hidden">
		<a
			href="https://github.com/walkersutton/cutlist"
			target="_blank"
			rel="noopener noreferrer"
			class="footer-link inline-flex items-center gap-1.5 text-xs text-zinc-400"
		>
			<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
				><path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/></svg
			>
			GitHub
		</a>
	</div>

	<!-- Mobile bottom bar -->
	<nav
		class="fixed right-0 bottom-0 left-0 z-30 flex border-t border-zinc-200 bg-white/95 backdrop-blur lg:hidden"
		style="padding-bottom: env(safe-area-inset-bottom)"
	>
		<button
			onclick={() => hasResults && (shareOpen = true)}
			disabled={!hasResults}
			class="flex flex-1 flex-col items-center gap-0.5 py-2.5 {hasResults
				? 'text-zinc-500'
				: 'text-zinc-300'}"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 22 22"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M11 3v12M7 7l4-4 4 4" /><path
					d="M5 13v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5"
				/></svg
			>
			<span class="text-[11px] font-medium">Share</span>
		</button>
		<button
			onclick={() => (settingsOpen = true)}
			class="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-zinc-500"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 22 22"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				aria-hidden="true"
				><line x1="3" y1="6" x2="19" y2="6" /><line x1="3" y1="11" x2="19" y2="11" /><line
					x1="3"
					y1="16"
					x2="19"
					y2="16"
				/><circle cx="8" cy="6" r="2.2" fill="white" /><circle cx="8" cy="6" r="2.2" /><circle
					cx="14"
					cy="11"
					r="2.2"
					fill="white"
				/><circle cx="14" cy="11" r="2.2" /><circle cx="9" cy="16" r="2.2" fill="white" /><circle
					cx="9"
					cy="16"
					r="2.2"
				/></svg
			>
			<span class="text-[11px] font-medium">Settings</span>
		</button>
	</nav>

	<!-- Settings drawer -->
	{#if settingsOpen}
		<div
			class="fixed inset-0 z-40 bg-black/40 lg:hidden"
			transition:fade={{ duration: 200 }}
			onclick={() => (settingsOpen = false)}
			role="presentation"
		></div>
		<div
			class="fixed right-0 bottom-0 left-0 z-50 rounded-t-2xl bg-white px-6 pt-4 pb-10 lg:hidden"
			transition:fly={{ y: 380, duration: 320, easing: cubicOut }}
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
		>
			<div class="mx-auto mb-6 h-1.5 w-10 rounded-full bg-zinc-200"></div>
			<div class="space-y-6">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-zinc-700">Mode</span>
					<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
						<button
							onclick={() => {
								mode = 'sheet';
								settingsOpen = false;
							}}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {mode ===
							'sheet'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">Sheet</button
						>
						<button
							onclick={() => {
								mode = 'linear';
								settingsOpen = false;
							}}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {mode ===
							'linear'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">Linear</button
						>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-zinc-700">Unit</span>
					<div class="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5">
						<button
							onclick={() => setUnit('in')}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {unit === 'in'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">Inches</button
						>
						<button
							onclick={() => setUnit('mm')}
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {unit === 'mm'
								? 'bg-white text-zinc-900 shadow-sm'
								: 'text-zinc-500'}">mm</button
						>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-zinc-700">Kerf width</span>
					<label class="flex items-center gap-2 text-sm text-zinc-600">
						<input
							type="text"
							inputmode="decimal"
							value={kerf}
							onblur={applyKerf}
							class="w-24 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-right text-base text-zinc-900 tabular-nums"
						/>
						<span class="text-zinc-400">{unit}</span>
					</label>
				</div>
				<div class="border-t border-zinc-100 pt-4">
					<button
						onclick={() => {
							settingsOpen = false;
							reset();
						}}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M2.5 4h11M5.5 4V2.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M6.5 7v4M9.5 7v4M3.5 4l.7 8.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4"
							/></svg
						>
						Reset everything
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Share sheet -->
	{#if shareOpen}
		<div
			class="fixed inset-0 z-40 bg-black/40 lg:hidden"
			transition:fade={{ duration: 200 }}
			onclick={() => (shareOpen = false)}
			role="presentation"
		></div>
		<div
			class="fixed right-0 bottom-0 left-0 z-50 rounded-t-2xl bg-white px-6 pt-4 pb-10 lg:hidden"
			transition:fly={{ y: 200, duration: 280, easing: cubicOut }}
			role="dialog"
			aria-modal="true"
			aria-label="Share"
		>
			<div class="mx-auto mb-6 h-1.5 w-10 rounded-full bg-zinc-200"></div>
			<div class="space-y-1">
				<button
					onclick={() => {
						printPlan();
						shareOpen = false;
					}}
					class="flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 22 22"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 text-zinc-500"
						aria-hidden="true"
						><path d="M6 7V3h10v4" /><rect x="2" y="7" width="18" height="8" rx="1.5" /><path
							d="M6 15h10v4H6z"
						/></svg
					>
					<div>
						<p class="text-sm font-medium">Print / PDF</p>
						<p class="text-xs text-zinc-400">Opens print dialog</p>
					</div>
				</button>
				<button
					onclick={async () => {
						await copyPlan();
						shareOpen = false;
					}}
					class="flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 22 22"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 text-zinc-500"
						aria-hidden="true"
						><rect x="8" y="8" width="11" height="13" rx="1.5" /><path
							d="M14 8V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h4"
						/></svg
					>
					<div>
						<p class="text-sm font-medium">Copy as text</p>
						<p class="text-xs text-zinc-400">Paste into any app</p>
					</div>
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	@media (hover: hover) and (pointer: fine) {
		.del {
			opacity: 0;
		}
		.row:hover .del,
		.row:focus-within .del {
			opacity: 1;
		}
	}
	.del {
		transition:
			opacity 120ms ease,
			color 120ms ease,
			background-color 120ms ease;
	}
	.footer-link {
		transition:
			color 150ms ease,
			transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	@media (hover: hover) and (pointer: fine) {
		.footer-link:hover {
			color: #18181b;
			transform: translateY(-1px);
		}
	}
</style>
