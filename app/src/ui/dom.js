// Tiny DOM helpers. Sift's UI is plain DOM: no framework, no virtual DOM,
// keyed updates where lists are long (tabs, results).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Escape text and wrap matched [start,end) ranges in <mark>. */
export function highlight(text, ranges) {
  const s = String(text ?? '');
  if (!ranges || !ranges.length) return esc(s);
  let out = '';
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at || a >= s.length) continue;
    out += esc(s.slice(at, a)) + '<mark>' + esc(s.slice(a, b)) + '</mark>';
    at = b;
  }
  return out + esc(s.slice(at));
}

export function favicon(url, faviconSrc, opts = {}) {
  if (faviconSrc) return `<img src="${esc(faviconSrc)}" alt="" draggable="false">`;
  if (typeof url === 'string' && url.startsWith('sift:')) {
    return `<span class="favicon-fallback is-internal">${opts.internalIcon || ''}</span>`;
  }
  let letter = '·';
  try { letter = new URL(url).hostname.replace(/^www\./, '')[0] || '·'; } catch { /* ignore */ }
  return `<span class="favicon-fallback">${esc(letter)}</span>`;
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const isMac = () => document.documentElement.dataset.platform === 'mac';

/** Render a shortcut like "mod+shift+a" as platform keycaps. */
export function keycaps(combo) {
  if (!combo) return '';
  const mac = isMac();
  const map = {
    mod: mac ? '⌘' : 'Ctrl', shift: mac ? '⇧' : 'Shift', alt: mac ? '⌥' : 'Alt', ctrl: mac ? '⌃' : 'Ctrl',
    enter: '↵', esc: 'Esc', up: '↑', down: '↓', left: '←', right: '→', backspace: '⌫', tab: 'Tab', space: 'Space',
  };
  return `<span class="keys">${combo.split('+').map((k) => `<kbd>${esc(map[k] || k.toUpperCase())}</kbd>`).join('')}</span>`;
}

export function shortcutText(combo) {
  if (!combo) return '';
  const mac = isMac();
  const map = { mod: mac ? '⌘' : 'Ctrl+', shift: mac ? '⇧' : 'Shift+', alt: mac ? '⌥' : 'Alt+', enter: '↵', backspace: '⌫' };
  return combo.split('+').map((k) => map[k] ?? k.toUpperCase()).join('');
}

/** True when the event's primary modifier (Cmd on macOS, Ctrl elsewhere) is held. */
export function primary(e) {
  return isMac() ? e.metaKey : e.ctrlKey;
}
