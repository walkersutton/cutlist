<script lang="ts">
  import { pack, type PanelInput, type SheetType, type GrainDirection } from '$lib/packer.js';

  let nextId = 1;
  function uid() { return String(nextId++); }

  let unit = $state<'in' | 'mm'>('in');
  const unitLabel = $derived(unit === 'in' ? '"' : ' mm');
  const dimStep = $derived(unit === 'in' ? 0.125 : 1);
  const dimMin  = $derived(unit === 'in' ? 0.125 : 1);

  function round(n: number): number {
    return unit === 'mm' ? Math.round(n) : Math.round(n * 8) / 8;
  }

  function setUnit(to: 'in' | 'mm') {
    if (to === unit) return;
    const factor = to === 'mm' ? 25.4 : 1 / 25.4;
    for (const st of sheetTypes) {
      st.width  = to === 'mm' ? Math.round(st.width  * factor) : Math.round(st.width  * factor * 8) / 8;
      st.height = to === 'mm' ? Math.round(st.height * factor) : Math.round(st.height * factor * 8) / 8;
    }
    for (const p of panels) {
      p.width  = to === 'mm' ? Math.round(p.width  * factor) : Math.round(p.width  * factor * 8) / 8;
      p.height = to === 'mm' ? Math.round(p.height * factor) : Math.round(p.height * factor * 8) / 8;
    }
    kerf = to === 'mm' ? Math.round(kerf * factor * 10) / 10 : Math.round(kerf * factor * 8) / 8;
    unit = to;
  }

  let kerf = $state(0.125); // default 1/8"

  let sheetTypes = $state<SheetType[]>([
    { id: uid(), width: 48, height: 96, quantity: 0 }
  ]);
  let panels = $state<PanelInput[]>([]);

  function addSheetType() {
    const d = unit === 'mm' ? { w: 1220, h: 2440 } : { w: 48, h: 96 };
    sheetTypes = [...sheetTypes, { id: uid(), width: d.w, height: d.h, quantity: 0 }];
  }
  function removeSheetType(id: string) {
    sheetTypes = sheetTypes.filter(s => s.id !== id);
  }

  function addPanel() {
    const d = unit === 'mm' ? { w: 300, h: 600 } : { w: 24, h: 24 };
    panels = [...panels, { id: uid(), label: '', width: d.w, height: d.h, quantity: 1, grain: 'any' }];
  }
  function removePanel(id: string) {
    panels = panels.filter(p => p.id !== id);
  }

  let sheets = $derived(pack(sheetTypes, panels, kerf));

  // Group results by sheet dimensions for the summary
  let sheetSummary = $derived((() => {
    const map = new Map<string, { w: number; h: number; count: number }>();
    for (const s of sheets) {
      const key = `${s.sheetWidth}×${s.sheetHeight}`;
      const e = map.get(key);
      if (e) e.count++;
      else map.set(key, { w: s.sheetWidth, h: s.sheetHeight, count: 1 });
    }
    return [...map.values()];
  })());

  const SVG_MAX = 440;
  function svgScale(w: number, h: number) {
    return Math.min(SVG_MAX / w, SVG_MAX / h);
  }

  const PALETTE = [
    '#93c5fd', '#86efac', '#fcd34d', '#f9a8d4', '#a5b4fc',
    '#6ee7b7', '#fca5a5', '#fdba74', '#c4b5fd', '#67e8f9'
  ];
  function panelColor(id: string): string {
    const idx = panels.findIndex(p => p.id === id);
    return PALETTE[idx % PALETTE.length] ?? '#d1d5db';
  }

  const inputCls = 'border border-gray-300 rounded px-2 py-1 w-full text-sm';
  const numCls = inputCls + ' text-right';
  const addBtnCls = 'inline-flex items-center gap-1 text-sm border border-gray-300 rounded px-3 py-1 text-gray-600 hover:border-gray-500 hover:text-gray-900 bg-white';
  const delBtnCls = 'w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500 text-base leading-none font-medium';
</script>

<div class="min-h-screen bg-gray-50 p-6">
  <div class="max-w-5xl mx-auto space-y-6">

    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Cut List Optimizer</h1>
        <p class="text-sm text-gray-500 mt-1">MAXRECTS packing · grain direction · all client-side</p>
      </div>
      <!-- Unit toggle -->
      <div class="flex items-center border border-gray-300 rounded overflow-hidden text-sm shrink-0">
        <button
          onclick={() => setUnit('in')}
          class={unit === 'in' ? 'px-3 py-1.5 bg-gray-900 text-white font-medium' : 'px-3 py-1.5 text-gray-600 hover:bg-gray-100'}
        >in</button>
        <button
          onclick={() => setUnit('mm')}
          class={unit === 'mm' ? 'px-3 py-1.5 bg-gray-900 text-white font-medium' : 'px-3 py-1.5 text-gray-600 hover:bg-gray-100 border-l border-gray-300'}
        >mm</button>
      </div>
    </div>

    <!-- Sheet stock -->
    <section class="bg-white border border-gray-200 rounded p-4 space-y-3">
      <div class="flex items-center justify-between gap-4">
        <h2 class="font-semibold text-gray-800">Sheet Stock</h2>
        <label class="flex items-center gap-2 text-sm text-gray-600 shrink-0">
          Kerf ({unit})
          <input type="number" class="border border-gray-300 rounded px-2 py-1 w-20 text-right text-sm" min="0" step={dimStep} bind:value={kerf} />
        </label>
      </div>
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-left text-gray-500">
            <th class="pb-1 pr-2 font-medium w-36">Width ({unit})</th>
            <th class="pb-1 pr-2 font-medium w-36">Height ({unit})</th>
            <th class="pb-1 pr-2 font-medium w-36">Qty (blank=∞)</th>
            <th class="pb-1 font-medium w-8"></th>
          </tr>
        </thead>
        <tbody>
          {#each sheetTypes as st (st.id)}
            <tr class="border-b border-gray-100">
              <td class="py-1 pr-2">
                <input type="number" class={numCls} min={dimMin} step={dimStep} bind:value={st.width} />
              </td>
              <td class="py-1 pr-2">
                <input type="number" class={numCls} min={dimMin} step={dimStep} bind:value={st.height} />
              </td>
              <td class="py-1 pr-2">
                <input
                  type="number" class={numCls} min="0" placeholder="∞"
                  value={st.quantity || ''}
                  oninput={(e) => { st.quantity = Number((e.target as HTMLInputElement).value) || 0; }}
                />
              </td>
              <td class="py-1 text-center">
                <button onclick={() => removeSheetType(st.id)} class={delBtnCls}>×</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button onclick={addSheetType} class={addBtnCls}>+ Add sheet size</button>
    </section>

    <!-- Panels -->
    <section class="bg-white border border-gray-200 rounded p-4 space-y-3">
      <h2 class="font-semibold text-gray-800">Panels</h2>
      {#if panels.length > 0}
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="border-b border-gray-200 text-left text-gray-500">
              <th class="pb-1 pr-2 font-medium">Label</th>
              <th class="pb-1 pr-2 font-medium w-28">Width ({unit})</th>
              <th class="pb-1 pr-2 font-medium w-28">Height ({unit})</th>
              <th class="pb-1 pr-2 font-medium w-16">Qty</th>
              <th class="pb-1 pr-2 font-medium w-32">Grain</th>
              <th class="pb-1 font-medium w-8"></th>
            </tr>
          </thead>
          <tbody>
            {#each panels as panel (panel.id)}
              <tr class="border-b border-gray-100">
                <td class="py-1 pr-2">
                  <div class="flex items-center gap-1.5">
                    <span class="shrink-0 w-3 h-3 rounded-sm" style="background:{panelColor(panel.id)}"></span>
                    <input type="text" class={inputCls} placeholder="Label" bind:value={panel.label} />
                  </div>
                </td>
                <td class="py-1 pr-2">
                  <input type="number" class={numCls} min={dimMin} step={dimStep} bind:value={panel.width} />
                </td>
                <td class="py-1 pr-2">
                  <input type="number" class={numCls} min={dimMin} step={dimStep} bind:value={panel.height} />
                </td>
                <td class="py-1 pr-2">
                  <input type="number" class={numCls} min="1" bind:value={panel.quantity} />
                </td>
                <td class="py-1 pr-2">
                  <select class={inputCls} bind:value={panel.grain}>
                    <option value="any">Any</option>
                    <option value="horizontal">Horizontal →</option>
                    <option value="vertical">Vertical ↑</option>
                  </select>
                </td>
                <td class="py-1 text-center">
                  <button onclick={() => removePanel(panel.id)} class={delBtnCls}>×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <button onclick={addPanel} class={addBtnCls}>+ Add panel</button>
    </section>

    <!-- Results -->
    {#if sheets.length > 0}
      <section class="space-y-4">
        <!-- Sheet summary -->
        <div class="bg-white border border-gray-200 rounded p-4 space-y-1">
          <div class="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">Sheets needed</div>
          {#each sheetSummary as row}
            <div class="text-sm text-gray-800">
              <span class="font-bold text-gray-900 text-base">{row.count}</span>
              &times;
              {row.w}×{row.h}{unitLabel}
            </div>
          {/each}
        </div>

        <!-- Sheet diagrams -->
        <div class="flex flex-wrap gap-6">
          {#each sheets as sheet (sheet.index)}
            {@const sc = svgScale(sheet.sheetWidth, sheet.sheetHeight)}
            {@const svgW = sheet.sheetWidth * sc}
            {@const svgH = sheet.sheetHeight * sc}
            <div class="bg-white border border-gray-200 rounded p-4 space-y-2">
              <div class="text-sm font-medium text-gray-800">
                Sheet {sheet.index + 1}
                <span class="text-gray-400 font-normal ml-1">{sheet.sheetWidth}×{sheet.sheetHeight}{unitLabel}</span>
              </div>
              <svg width={svgW} height={svgH} style="display:block;background:#f9fafb;border:1px solid #e5e7eb;">
                {#each sheet.placements as p (`${p.panelId}-${p.x}-${p.y}`)}
                  {@const px = p.x * sc}
                  {@const py = p.y * sc}
                  {@const pw = p.width * sc}
                  {@const ph = p.height * sc}
                  <rect x={px} y={py} width={pw} height={ph} fill={panelColor(p.panelId)} stroke="#374151" stroke-width="1" />
                  {#if p.grain !== 'any' && pw > 8 && ph > 8}
                    {@const isHoriz = p.grain === 'horizontal'}
                    {@const span = isHoriz ? ph : pw}
                    {@const count = Math.max(1, Math.floor(span / 10) - 1)}
                    {#each Array.from({length: count}) as _, i}
                      {@const offset = (i + 1) * (span / (count + 1))}
                      {#if isHoriz}
                        <line x1={px+3} y1={py+offset} x2={px+pw-3} y2={py+offset} stroke="#1e3a5f" stroke-width="0.75" opacity="0.3" />
                      {:else}
                        <line x1={px+offset} y1={py+3} x2={px+offset} y2={py+ph-3} stroke="#1e3a5f" stroke-width="0.75" opacity="0.3" />
                      {/if}
                    {/each}
                  {/if}
                  {#if pw > 24 && ph > 12}
                    <text
                      x={px + pw/2} y={py + ph/2}
                      text-anchor="middle" dominant-baseline="middle"
                      font-size={Math.min(11, pw/4, ph/2)}
                      fill="#111827" font-family="system-ui,sans-serif"
                    >{p.label || '?'}{p.rotated ? ' ↺' : ''}</text>
                  {/if}
                {/each}
              </svg>
            </div>
          {/each}
        </div>
      </section>
    {:else if panels.length === 0}
      <p class="text-gray-400 text-sm">Add panels above to see the layout.</p>
    {/if}

  </div>
</div>
