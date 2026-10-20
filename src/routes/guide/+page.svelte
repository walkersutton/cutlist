<script lang="ts">
	import { resolve } from '$app/paths';

	const SITE = 'https://cutlist.walkersutton.com';
	const PAGE_URL = `${SITE}/guide/`;
	const TITLE = 'Cut List Optimizer Guide — Plywood & Lumber Cutting Layouts | cutlist';
	const DESCRIPTION =
		'How to use cutlist, a free online cut list optimizer: lay out plywood and sheet goods (2D) or boards and lumber (1D) with saw kerf, grain direction, track saw cut sequences, and CSV import.';

	// Shown on the page and emitted as FAQPage data, so the two never drift apart.
	const faqs = [
		{
			q: 'Is cutlist free?',
			a: 'Yes. cutlist is free to use with no account, sign-up, or install, and its source code is MIT-licensed on GitHub.'
		},
		{
			q: 'How many sheets of plywood do I need?',
			a: 'Enter your sheet size (for example 4×8 ft, 48×96 in, or 1220×2440 mm) and every part you need, and cutlist lays the parts out and counts the sheets. Dividing total part area by sheet area underestimates, because kerf, grain direction, and offcuts too small for any part all cost material — the layout accounts for those.'
		},
		{
			q: 'Does it account for the saw blade kerf?',
			a: 'Yes. Set the kerf (blade width) once — it defaults to 1/8″ or 3 mm — and cutlist leaves that gap between every pair of adjacent parts.'
		},
		{
			q: 'Can it keep the wood grain running the right way?',
			a: 'Yes. Give each sheet a grain direction and mark parts as horizontal, vertical, or any. Parts with a grain direction are never rotated against the sheet’s grain; parts marked any can be rotated to fit better.'
		},
		{
			q: 'Can I cut the layout with a track saw or table saw?',
			a: 'Yes. Track saw mode only produces layouts where every part comes free with full, straight, edge-to-edge cuts, and it numbers the cuts in order. That works for track saws, table saws, and panel saws. CNC mode nests parts more tightly for cutting with a CNC router.'
		},
		{
			q: 'Does it work for lumber, 2×4s, and trim?',
			a: 'Yes. Linear mode plans one-dimensional stock: boards, dimensional lumber, trim, dowels, pipe, or metal tube and extrusion. Enter your stock lengths and the pieces you need, and it shows how to cut each board.'
		},
		{
			q: 'Does it support metric?',
			a: 'Yes. Switch between inches and millimeters at any time; existing sizes are converted.'
		},
		{
			q: 'Can I mix materials and thicknesses in one project?',
			a: 'Yes. Name a material and thickness on your stock (for example 3/4″ Baltic birch and 1/4″ MDF) and on each part, and parts are only laid out on matching stock.'
		},
		{
			q: 'Can I import a cut list from Excel or Google Sheets?',
			a: 'Yes. Import a CSV file or paste rows straight from a spreadsheet. Columns are matched by name in any order, and parts or stock can be exported back to CSV.'
		},
		{
			q: 'Where are my plans saved?',
			a: 'In your browser’s local storage on your device — there is no account or server copy. To move a plan to another device or send it to someone, use a share link or export it to CSV.'
		},
		{
			q: 'Does it work on a phone?',
			a: 'Yes. The layout adapts to phones and tablets, and you can add it to your home screen like an app.'
		},
		{
			q: 'How is cutlist different from other cut list optimizers?',
			a: 'cutlist is built to be fast and simple: it runs entirely in your browser, the layout updates as you type, and there is no account, paywall, or project limit. Dedicated paid tools offer more advanced features; cutlist focuses on getting a good cut layout quickly.'
		}
	];

	const jsonLd = {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'Article',
				'@id': `${PAGE_URL}#article`,
				headline: 'Cut list optimizer guide',
				description: DESCRIPTION,
				url: PAGE_URL,
				inLanguage: 'en',
				author: { '@id': `${SITE}/#author` },
				publisher: { '@id': `${SITE}/#author` },
				about: { '@id': `${SITE}/#app` },
				isPartOf: { '@id': `${SITE}/#website` }
			},
			{
				'@type': 'FAQPage',
				'@id': `${PAGE_URL}#faq`,
				mainEntity: faqs.map(({ q, a }) => ({
					'@type': 'Question',
					name: q,
					acceptedAnswer: { '@type': 'Answer', text: a }
				}))
			},
			{
				'@type': 'BreadcrumbList',
				itemListElement: [
					{ '@type': 'ListItem', position: 1, name: 'Cut List Tool', item: `${SITE}/` },
					{ '@type': 'ListItem', position: 2, name: 'Guide', item: PAGE_URL }
				]
			}
		]
	};
	// Escape "<" so nothing in the text can close the tag early; the closing tag is split for the
	// same reason, since Svelte would read it as the end of this block.
	const jsonLdTag =
		`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</` +
		'script>';

	const h2 = 'mt-12 mb-3 text-lg font-semibold tracking-tight text-zinc-900';
	const h3 = 'mt-6 mb-1.5 text-[15px] font-semibold text-zinc-900';
</script>

<svelte:head>
	<title>{TITLE}</title>
	<meta name="description" content={DESCRIPTION} />
	<link rel="canonical" href={PAGE_URL} />
	<meta property="og:title" content={TITLE} />
	<meta property="og:description" content={DESCRIPTION} />
	<meta property="og:url" content={PAGE_URL} />
	<meta name="twitter:title" content={TITLE} />
	<meta name="twitter:description" content={DESCRIPTION} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static JSON built above -->
	{@html jsonLdTag}
</svelte:head>

<div class="min-h-screen bg-white text-zinc-900">
	<header
		class="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200/80 bg-white/95 px-4 backdrop-blur lg:h-16 lg:px-6"
	>
		<a href={resolve('/')} class="flex items-center gap-2 rounded-lg">
			<img src="/logo.jpg" alt="" class="h-7 w-7 lg:h-8 lg:w-8" />
			<span class="text-base font-semibold tracking-tight">cutlist</span>
		</a>
		<a
			href={resolve('/')}
			class="press rounded-lg bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700"
			>Open the tool</a
		>
	</header>

	<main class="mx-auto max-w-2xl px-5 pt-10 pb-20 text-[15px] leading-relaxed text-zinc-700">
		<nav aria-label="Breadcrumb" class="mb-4 text-xs text-zinc-400">
			<a href={resolve('/')} class="hover:text-zinc-700">Cut list tool</a>
			<span aria-hidden="true" class="mx-1">/</span>
			<span>Guide</span>
		</nav>

		<h1 class="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
			Cut list optimizer guide
		</h1>
		<p class="mt-4 text-base text-zinc-600">
			<a href={resolve('/')} class="font-medium text-zinc-900 underline underline-offset-2"
				>cutlist</a
			> is a free online cut list optimizer for woodworkers and DIYers. Enter the plywood sheets or boards
			you have and the parts you need, and it lays the parts out to use as few sheets and boards as possible
			— accounting for saw kerf and grain direction. It runs in your browser, with no account or install.
		</p>

		<h2 class={h2}>What it does</h2>
		<ul class="list-disc space-y-1.5 pl-5">
			<li>
				<strong class="font-medium text-zinc-900">Sheet goods (2D):</strong> lays out panels on plywood,
				MDF, particleboard, melamine, hardboard, acrylic, or any other sheet material.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Linear stock (1D):</strong> plans cuts from boards,
				dimensional lumber, trim, dowels, pipe, and metal tube or extrusion.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Saw kerf:</strong> reserves the blade width between
				parts so the finished pieces come out at size.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Grain direction:</strong> keeps grain or pattern running
				the right way on each part, and rotates parts that don’t care.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">CNC or track saw layouts:</strong> tightly nested layouts,
				or layouts made only of straight edge-to-edge cuts with a numbered cut sequence.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Materials and thicknesses:</strong> keep 3/4″ plywood
				parts on 3/4″ plywood and 1/4″ parts on 1/4″ stock in a single project.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Shop stock:</strong> record the sheets and boards you
				keep on hand, with limited or unlimited quantities, and reuse them in every plan.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Inches or millimeters</strong>, with saved plans,
				share links, CSV import and export, print or save as PDF, and copy as text.
			</li>
		</ul>

		<h2 class={h2}>How to make a cut list</h2>
		<ol class="list-decimal space-y-2 pl-5">
			<li>
				<strong class="font-medium text-zinc-900">Choose Sheet or Linear.</strong> Sheet is for panels
				cut from plywood and other sheet goods; Linear is for pieces cut from boards and lengths.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Set your stock.</strong> Add the sheet sizes (a 4×8
				sheet, 48×96″ or 1220×2440 mm, is filled in for you) or board lengths you’ll buy or have on hand.
				Leave quantity blank for unlimited, or enter how many you have.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Set the kerf.</strong> Enter your blade width — 1/8″
				(3 mm) is typical for a table saw or track saw.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Add your parts.</strong> Give each one a label, width
				and height (or length), quantity, and grain direction. Or import them from a CSV.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Read the layout.</strong> Every sheet or board is drawn
				to scale with the parts on it, alongside the stock you need and the waste percentage. Parts that
				don’t fit on any stock are listed with the reason.
			</li>
			<li>
				<strong class="font-medium text-zinc-900">Take it to the shop.</strong> Print it or save it as
				a PDF, copy it as text, or send someone a link that opens the plan.
			</li>
		</ol>

		<h2 class={h2}>Sheet goods vs. linear stock</h2>
		<p>
			Sheet mode is a two-dimensional problem: parts have a width and a height, and they are packed
			onto rectangular sheets. Use it for cabinets, shelving, drawers, and anything else cut from
			plywood or panels.
		</p>
		<p class="mt-3">
			Linear mode is one-dimensional: only length matters. Use it for face frames, legs, rails,
			trim, and framing lumber. Each piece is placed on the board with the least leftover length
			that still fits it, and a new board is started only when nothing else will do.
		</p>

		<h2 class={h2}>CNC vs. track saw layouts</h2>
		<h3 class={h3}>Track saw (straight cuts)</h3>
		<p>
			A saw can’t stop in the middle of a sheet, so track saw mode only produces layouts where every
			part comes free with full, straight cuts from one edge to the other. Each sheet is ripped into
			strips, the strips are crosscut, and stacked pieces are cut apart — a guillotine layout. The
			cuts are numbered in the order to make them, and each sheet needs at most three changes of
			cutting direction. Use it with a track saw, table saw, panel saw, or circular saw and a
			straightedge.
		</p>
		<h3 class={h3}>CNC (nested)</h3>
		<p>
			CNC mode nests parts wherever they fit, which usually saves more material but can produce cuts
			that stop partway across the sheet. Use it with a CNC router, or when you’re cutting with a
			jigsaw or band saw.
		</p>

		<h2 class={h2}>Kerf and grain direction</h2>
		<p>
			<strong class="font-medium text-zinc-900">Kerf</strong> is the width of material the blade turns
			into sawdust. Ignore it, and a row of parts that fits a sheet exactly on paper comes up short in
			the shop. cutlist reserves the kerf between neighboring parts, so set it to your blade’s width.
		</p>
		<p class="mt-3">
			<strong class="font-medium text-zinc-900">Grain direction</strong> matters for veneered plywood
			and patterned sheets. Set the grain of each sheet size, then mark each part horizontal, vertical,
			or any. Parts with a direction stay aligned with the sheet’s grain; parts marked any can turn 90°
			to fill gaps.
		</p>

		<h2 class={h2}>Importing a cut list from a spreadsheet</h2>
		<p>
			Import a <code class="rounded bg-zinc-100 px-1 py-0.5 text-[13px]">.csv</code> or tab-separated
			file, or paste rows copied from Excel, Google Sheets, or Numbers. Headers are matched by name, so
			column order doesn’t matter and extra columns are ignored:
		</p>
		<div class="mt-4 overflow-x-auto rounded-lg border border-zinc-200">
			<table class="w-full text-left text-[13px]">
				<thead class="bg-zinc-50 text-zinc-500">
					<tr>
						<th class="px-3 py-2 font-medium">Column</th>
						<th class="px-3 py-2 font-medium">Also accepted</th>
						<th class="px-3 py-2 font-medium">Notes</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zinc-100">
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-900">Label</td>
						<td class="px-3 py-2">Name, Part, Piece, Description</td>
						<td class="px-3 py-2">What the part is called</td>
					</tr>
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-900">Width, Height</td>
						<td class="px-3 py-2">W, H</td>
						<td class="px-3 py-2">Sheet parts and sheet stock</td>
					</tr>
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-900">Length</td>
						<td class="px-3 py-2">Len, L</td>
						<td class="px-3 py-2">Linear pieces and board stock</td>
					</tr>
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-900">Qty</td>
						<td class="px-3 py-2">Quantity, Count, Pcs</td>
						<td class="px-3 py-2">Blank means one part, or unlimited stock</td>
					</tr>
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-900">Grain</td>
						<td class="px-3 py-2">Grain direction</td>
						<td class="px-3 py-2">H, V, or blank for any</td>
					</tr>
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-900">Material, Thickness</td>
						<td class="px-3 py-2">Species, Stock, T</td>
						<td class="px-3 py-2">Optional; thickness accepts fractions like 3/4</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p class="mt-3">
			Put the unit in a header — <code class="rounded bg-zinc-100 px-1 py-0.5 text-[13px]"
				>Width (in)</code
			>
			or <code class="rounded bg-zinc-100 px-1 py-0.5 text-[13px]">Length (mm)</code> — and sizes are
			converted if your plan uses the other unit. Exported files include the unit, so they import back
			cleanly.
		</p>

		<h2 class={h2}>Saving and sharing plans</h2>
		<p>
			Plans save automatically in your browser, and you can keep as many as you like and switch
			between them. A share link carries the whole plan in the part of the PAGE_URL after the
			<code class="rounded bg-zinc-100 px-1 py-0.5 text-[13px]">#</code>, which browsers never send
			to a server — the person you send it to sees the plan and can save their own copy.
		</p>

		<h2 class={h2}>Frequently asked questions</h2>
		<div class="divide-y divide-zinc-100 border-y border-zinc-100">
			{#each faqs as { q, a } (q)}
				<section class="py-4">
					<h3 class="text-[15px] font-semibold text-zinc-900">{q}</h3>
					<p class="mt-1.5">{a}</p>
				</section>
			{/each}
		</div>

		<div class="mt-12 rounded-2xl bg-zinc-50 p-6 text-center ring-1 ring-zinc-200/70">
			<p class="text-base font-semibold text-zinc-900">Ready to plan your cuts?</p>
			<p class="mt-1 text-sm text-zinc-500">Free, no sign-up — your plan saves as you go.</p>
			<a
				href={resolve('/')}
				class="press mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
				>Open the cut list tool</a
			>
		</div>
	</main>

	<footer
		class="flex items-center justify-center gap-2.5 border-t border-zinc-100 py-6 text-xs text-zinc-400"
	>
		<a href="https://walkersutton.com" class="hover:text-zinc-900">built by Walker</a>
		<span
			class="h-[2px] w-[2px] shrink-0 translate-y-[1px] rounded-full bg-zinc-300"
			aria-hidden="true"
		></span>
		<a href="https://github.com/walkersutton/cutlist" class="hover:text-zinc-900">Source</a>
	</footer>
</div>
