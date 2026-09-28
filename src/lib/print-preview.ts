/**
 * In-app print preview for phones and installed PWAs.
 *
 * Opening the printable plan in a new window strands PWA users: standalone mode has no tabs or
 * back button. Instead the document is shown in a full-screen overlay (inside a shadow root, so
 * its page-level CSS can't leak into the app) with Done and Print buttons, and a print stylesheet
 * hides everything else so only the plan is printed.
 */

const HOST_CLASS = 'cl-print-host';
const OPEN_CLASS = 'cl-printing';

const TOOLBAR_CSS = `
.bar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;
	padding:10px 16px;padding-top:calc(10px + env(safe-area-inset-top));
	border-bottom:1px solid #e4e4e7;background:rgba(255,255,255,.96);
	-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
	font-family:system-ui,-apple-system,sans-serif}
.bar button{font:600 15px system-ui,-apple-system,sans-serif;border-radius:10px;padding:9px 14px;
	border:1px solid transparent;cursor:pointer}
.bar button:active{transform:scale(.97)}
.done{background:transparent;color:#18181b;margin-right:auto}
.print{background:#18181b;color:#fff}
.doc{padding:18px 16px calc(24px + env(safe-area-inset-bottom))}
@media print{.bar{display:none}.doc{padding:0}}
`;

/** Turns the standalone print document's CSS into CSS scoped to the preview's `.doc`. */
function scopeCss(css: string): string {
	return css
		.replace(/@page\s*\{[^}]*\}/g, '') // @page is ignored in shadow roots; set globally instead
		.replace(/@media screen\{body\{[^}]*\}/g, '@media screen{')
		.replace(/(^|[}\s])body\{/g, '$1.doc{');
}

export function openPrintPreview(html: string, pageRule = '@page{size:letter;margin:.75in}') {
	document.querySelector(`.${HOST_CLASS}`)?.remove();

	const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
	const body = (html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '')
		.replace(/<div class="screen-actions">[\s\S]*?<\/div>/, '')
		.replace(/<script>[\s\S]*?<\/script>/g, '');

	const pageStyle = document.createElement('style');
	pageStyle.textContent = pageRule;
	document.head.appendChild(pageStyle);

	const host = document.createElement('div');
	host.className = HOST_CLASS;
	host.setAttribute('role', 'dialog');
	host.setAttribute('aria-modal', 'true');
	host.setAttribute('aria-label', 'Print preview');
	const root = host.attachShadow({ mode: 'open' });
	root.innerHTML = `<style>${scopeCss(css)}${TOOLBAR_CSS}</style>
		<div class="bar">
			<button type="button" class="done">Done</button>
			<button type="button" class="print">Print / Save PDF</button>
		</div>
		<div class="doc">${body}</div>`;

	let closed = false;
	// Unique per preview, so a stale marker (e.g. left by a reload mid-preview) is never mistaken
	// for ours and we never go back further than the entry we added.
	const token = `${Date.now()}-${Math.random()}`;

	function close(fromHistory = false) {
		if (closed) return;
		closed = true;
		host.remove();
		pageStyle.remove();
		document.documentElement.classList.remove(OPEN_CLASS);
		window.removeEventListener('popstate', onPop);
		document.removeEventListener('keydown', onKey);
		// Pop the entry we pushed, unless the user already went back (which is what closed us).
		if (!fromHistory && history.state?.clPrintPreview === token) history.back();
	}
	const onPop = () => close(true);
	const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();

	root.querySelector('.done')!.addEventListener('click', () => close());
	root.querySelector('.print')!.addEventListener('click', () => window.print());

	document.body.appendChild(host);
	document.documentElement.classList.add(OPEN_CLASS);
	// A history entry means Android's back button / iOS back-swipe closes the preview rather
	// than leaving the app.
	history.pushState({ ...history.state, clPrintPreview: token }, '');
	window.addEventListener('popstate', onPop);
	document.addEventListener('keydown', onKey);
	(root.querySelector('.print') as HTMLButtonElement).focus();
}
