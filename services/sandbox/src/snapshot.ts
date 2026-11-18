/**
 * Page snapshot + element classification, executed inside the page (no Node APIs here).
 * Interactive elements get stable refs (data-muse-ref). Password fields are listed without values.
 */
export interface SnapshotResult { url: string; title: string; text: string }

export function snapshotInPage(maxChars: number): SnapshotResult {
  let n = 0;
  const lines: string[] = [];
  const seen = new Set<Element>();
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    const st = getComputedStyle(el);
    return !!r && r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const label = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const id = el.getAttribute('id');
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l?.textContent) return l.textContent.trim();
    }
    const ph = el.getAttribute('placeholder');
    if (ph) return ph;
    return ((el as HTMLElement).innerText || el.getAttribute('value') || el.getAttribute('name') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  };
  const ref = (el: Element) => {
    let r = el.getAttribute('data-muse-ref');
    if (!r) { r = 'r' + ++n; el.setAttribute('data-muse-ref', r); }
    return r;
  };
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
  let total = 0;
  const push = (s: string) => { if (total < maxChars) { lines.push(s); total += s.length + 1; } };
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    const el = node;
    if (seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE'].includes(el.tagName)) continue;
    if (!visible(el)) continue;
    const tag = el.tagName;
    if (/^H[1-4]$/.test(tag)) { push(`${'#'.repeat(Number(tag[1]))} ${(el as HTMLElement).innerText.trim().slice(0, 160)}`); el.querySelectorAll('*').forEach((c) => seen.add(c)); continue; }
    if (tag === 'A' && el.getAttribute('href')) { push(`[${ref(el)}] link "${label(el)}" → ${(el as HTMLAnchorElement).href.slice(0, 200)}`); el.querySelectorAll('*').forEach((c) => seen.add(c)); continue; }
    if (tag === 'BUTTON' || el.getAttribute('role') === 'button' || (tag === 'INPUT' && ['submit', 'button'].includes((el as HTMLInputElement).type))) {
      push(`[${ref(el)}] button "${label(el)}"`); el.querySelectorAll('*').forEach((c) => seen.add(c)); continue;
    }
    if (tag === 'INPUT') {
      const i = el as HTMLInputElement;
      if (i.type === 'hidden') continue;
      if (i.type === 'password') { push(`[${ref(el)}] password field "${label(el)}" (use the login tool; never type passwords)`); continue; }
      if (i.type === 'checkbox' || i.type === 'radio') { push(`[${ref(el)}] ${i.type} "${label(el)}" ${i.checked ? '(checked)' : ''}`); continue; }
      push(`[${ref(el)}] textbox "${label(el)}"${i.value ? ` = "${i.value.slice(0, 60)}"` : ''}`);
      continue;
    }
    if (tag === 'TEXTAREA') { push(`[${ref(el)}] textarea "${label(el)}"`); continue; }
    if (tag === 'SELECT') {
      const s = el as HTMLSelectElement;
      push(`[${ref(el)}] select "${label(el)}" options: ${[...s.options].slice(0, 15).map((o) => o.text.trim()).join(' | ')}`);
      el.querySelectorAll('*').forEach((c) => seen.add(c));
      continue;
    }
    if (['P', 'LI', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'SPAN', 'DIV', 'LABEL', 'FIGCAPTION'].includes(tag)) {
      // only leaf-ish text blocks
      const hasBlockChild = [...el.children].some((c) => ['P', 'DIV', 'LI', 'UL', 'OL', 'TABLE', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'FORM'].includes(c.tagName));
      if (hasBlockChild) continue;
      const t = (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ');
      if (t && t.length > 1 && !el.querySelector('a,button,input,select,textarea')) { push((tag === 'LI' ? '- ' : '') + t.slice(0, 500)); el.querySelectorAll('*').forEach((c) => seen.add(c)); }
    }
  }
  return { url: location.href, title: document.title, text: lines.join('\n') };
}

export interface ClickClass { found: boolean; sensitive: boolean; reason: string; description: string; isPassword: boolean }

/** Decide whether clicking/typing on an element could cause an external side effect. */
export function classifyInPage(refId: string): ClickClass {
  const el = document.querySelector(`[data-muse-ref="${CSS.escape(refId)}"]`) as HTMLElement | null;
  if (!el) return { found: false, sensitive: false, reason: '', description: '', isPassword: false };
  const text = (el.innerText || el.getAttribute('value') || el.getAttribute('aria-label') || '').trim().slice(0, 80);
  const isPassword = el instanceof HTMLInputElement && (el.type === 'password' || el.autocomplete === 'current-password' || el.autocomplete === 'new-password');
  const form = el.closest('form');
  const isSubmit = (el instanceof HTMLButtonElement && (el.type === 'submit' || (!el.getAttribute('type') && !!form))) || (el instanceof HTMLInputElement && el.type === 'submit');
  const risky = /\b(buy|pay|purchase|place order|order now|checkout|check out|send|submit|confirm|book now|reserve|sign up|subscribe|delete|transfer|donate|apply|post|publish)\b/i.test(text);
  const formMethod = (form?.getAttribute('method') ?? 'get').toLowerCase();
  const isSearchForm = !!form && formMethod === 'get' && !!form.querySelector('input[type=search], input[name=q], input[name=query]');
  const sensitive = (isSubmit && !isSearchForm) || (risky && !isSearchForm);
  const reason = isSubmit ? (isSearchForm ? '' : `submits a ${formMethod.toUpperCase()} form`) : risky ? `button "${text}" looks like it sends or buys something` : '';
  return { found: true, sensitive, reason, description: `${el.tagName.toLowerCase()} "${text}"`, isPassword };
}
