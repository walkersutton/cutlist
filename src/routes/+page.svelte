<script lang="ts">
  import { pack, type PanelInput, type SheetType, type GrainDirection } from '$lib/packer.js';

  let nextId = 1;
  function uid() { return String(nextId++); }

  let sheetTypes = $state<SheetType[]>([
    { id: uid(), width: 48, height: 96, quantity: 0 }
  ]);

  let panels = $state<PanelInput[]>([]);

  function addSheetType() {
    sheetTypes = [...sheetTypes, { id: uid(), width: 48, height: 96, quantity: 0 }];
  }
  function removeSheetType(id: string) {
    sheetTypes = sheetTypes.filter(s => s.id !== id);
  }

  function addPanel() {
    panels = [...panels, { id: uid(), label: '', width: 24, height: 24, quantity: 1, grain: 'any' }];
  }
  function removePanel(id: string) {
    panels = panels.filter(p => p.id !== id);
  }

  let sheets = $derived(pack(sheetTypes, panels));
  let totalSheets = $derived(sheets.length);
  let avgWaste = $derived(
    sheets.length > 0
      ? Math.round(sheets.reduce((s, sh) => s + sh.wastePercent, 0) / sheets.length)
      : 0
  );

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

    <div>
      <h1 class="text-2xl font-bold text-gray-900">Cut List Optimizer</h1>
      <p class="text-sm text-gray-500 mt-1">MAXRECTS packing · grain direction · all client-side</p>
    </div>

    <!-- Sheet stock -->
    <section class="bg-white border border-gray-200 rounded p-4 space-y-3">
      <h2 class="font-semibold text-gray-800">Sheet Stock</h2>
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-left text-gray-500">
            <th class="pb-1 pr-2 font-medium w-28">Width (in)</th>
            <th class="pb-1 pr-2 font-medium w-28">Height (in)</th>
            <th class="pb-1 pr-2 font-medium w-28">Qty (blank=∞)</th>
            <th class="pb-1 font-medium w-6"></th>
          </tr>
        </thead>
        <tbody>
          {#each sheetTypes as st (st.id)}
            <tr class="border-b border-gray-100">
              <td class="py-1 pr-2">
                <input type="number" class={numCls} min="1" bind:value={st.width} />
              </td>
              <td class="py-1 pr-2">
                <input type="number" class={numCls} min="1" bind:value={st.height} />
              </td>
              <td class="py-1 pr-2">
                <input
                  type="number"
                  class={numCls}
                  min="0"
                  placeholder="∞"
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
              <th class="pb-1 pr-2 font-medium w-24">Width (in)</th>
              <th class="pb-1 pr-2 font-medium w-24">Height (in)</th>
              <th class="pb-1 pr-2 font-medium w-16">Qty</th>
              <th class="pb-1 pr-2 font-medium w-32">Grain</th>
              <th class="pb-1 font-medium w-6"></th>
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
                  <input type="number" class={numCls} min="0.125" step="0.125" bind:value={panel.width} />
                </td>
                <td class="py-1 pr-2">
                  <input type="number" class={numCls} min="0.125" step="0.125" bind:value={panel.height} />
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
        <div class="flex items-center gap-4">
          <div class="bg-white border border-gray-200 rounded px-4 py-3 text-center min-w-24">
            <div class="text-2xl font-bold text-gray-900">{totalSheets}</div>
            <div class="text-xs text-gray-500">sheets needed</div>
          </div>
          <div class="bg-white border border-gray-200 rounded px-4 py-3 text-center min-w-24">
            <div class="text-2xl font-bold text-gray-900">{avgWaste}%</div>
            <div class="text-xs text-gray-500">avg waste</div>
          </div>
        </div>

        <div class="flex flex-wrap gap-6">
          {#each sheets as sheet (sheet.index)}
            {@const sc = svgScale(sheet.sheetWidth, sheet.sheetHeight)}
            {@const svgW = sheet.sheetWidth * sc}
            {@const svgH = sheet.sheetHeight * sc}
            <div class="bg-white border border-gray-200 rounded p-4 space-y-2">
              <div class="flex items-center justify-between text-sm gap-6">
                <span class="font-medium text-gray-800">
                  Sheet {sheet.index + 1}
                  <span class="text-gray-400 font-normal ml-1">{sheet.sheetWidth}×{sheet.sheetHeight}"</span>
                </span>
                <span class="text-gray-500">{sheet.wastePercent}% waste</span>
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
                    {@const step = Math.max(6, span / 8)}
                    {@const count = Math.floor(span / step) - 1}
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
