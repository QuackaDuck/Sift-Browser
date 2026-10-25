// URL classification and display helpers. Pure functions, shared by the
// address bar, tab strip and native bridge. No DOM access.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const HOSTLIKE_RE = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62}(?::\d{1,5})?(?:[/?#].*)?$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#].*)?$/;
const LOCAL_RE = /^localhost(?::\d{1,5})?(?:[/?#].*)?$/i;
const KNOWN_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:', 'chrome:', 'data:', 'view-source:', 'blob:', 'sift:', 'devtools:', 'ftp:']);

export const INTERNAL_SCHEME = 'sift:';

/**
 * Decide whether typed text is a URL, an internal page or a search query.
 * @returns {{type:'url'|'internal'|'search', url?:string, query?:string}}
 */
export function classifyInput(raw) {
  const text = (raw || '').trim();
  if (!text) return { type: 'search', query: '' };
  if (/\s/.test(text) && !/^[a-z]+:\/\//i.test(text)) return { type: 'search', query: text };

  if (SCHEME_RE.test(text)) {
    const scheme = text.slice(0, text.indexOf(':') + 1).toLowerCase();
    if (scheme === INTERNAL_SCHEME) return { type: 'internal', url: normalizeInternal(text) };
    if (KNOWN_SCHEMES.has(scheme)) return { type: 'url', url: text };
    // "localhost:3000" parses as scheme "localhost:"; fall through.
  }
  if (LOCAL_RE.test(text) || IPV4_RE.test(text)) return { type: 'url', url: `http://${text}` };
  if (HOSTLIKE_RE.test(text)) return { type: 'url', url: `https://${text}` };
  return { type: 'search', query: text };
}

function normalizeInternal(text) {
  const rest = text.replace(/^sift:(\/\/)?/i, '').replace(/\/+$/, '');
  return `sift://${rest.toLowerCase() || 'newtab'}`;
}

export function isInternal(url) {
  return typeof url === 'string' && url.toLowerCase().startsWith('sift://');
}

export function safeParse(url) {
  try { return new URL(url); } catch { return null; }
}

/** Hostname without a leading "www.". */
export function hostOf(url) {
  const u = safeParse(url);
  if (!u) return '';
  if (u.protocol === 'sift:') return 'sift';
  return u.hostname.replace(/^www\./, '');
}

/** Parts used by the address bar's resting state: host emphasised, rest dimmed. */
export function displayParts(url) {
  const u = safeParse(url);
  if (!u) return { host: url || '', rest: '', secure: false, scheme: '' };
  if (u.protocol === 'sift:') return { host: `sift://${u.host}${u.pathname === '/' ? '' : u.pathname}`, rest: '', secure: true, scheme: 'sift', internal: true };
  if (u.protocol === 'file:') return { host: 'file', rest: decodeURIComponent(u.pathname), secure: false, scheme: 'file' };
  const host = u.hostname.replace(/^www\./, '') + (u.port ? `:${u.port}` : '');
  let rest = u.pathname === '/' ? '' : u.pathname;
  rest += u.search + u.hash;
  return { host, rest: safeDecode(rest), secure: u.protocol === 'https:', scheme: u.protocol.slice(0, -1) };
}

function safeDecode(s) {
  try { return decodeURI(s); } catch { return s; }
}

/** The full URL shown while editing. Drops the scheme only for plain https origins. */
export function editableUrl(url) {
  return url || '';
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|igshid|ref_src|_hsenc|_hsmi)$/i;

/** Canonical form for duplicate detection: no hash, no tracking params, no www, no trailing slash. */
export function canonicalUrl(url) {
  const u = safeParse(url);
  if (!u) return url || '';
  if (u.protocol === 'sift:') return url.toLowerCase();
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = params.length ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  const path = u.pathname.replace(/\/+$/, '') || '';
  return `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.port ? ':' + u.port : ''}${path}${search}`.toLowerCase();
}

export function searchUrl(engine, query) {
  return engine.url.replace('%s', encodeURIComponent(query));
}

/** Pull the query back out of a search results URL, so the address bar can show "figma tutorials" instead of a long URL. */
export function queryFromSearchUrl(engines, url) {
  const u = safeParse(url);
  if (!u) return null;
  for (const e of engines) {
    const t = safeParse(e.url.replace('%s', 'SIFTQ'));
    if (!t || t.hostname !== u.hostname || t.pathname !== u.pathname) continue;
    for (const [k, v] of t.searchParams) if (v === 'SIFTQ') return u.searchParams.get(k);
  }
  return null;
}

export const SEARCH_ENGINES = [
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  { id: 'kagi', name: 'Kagi', url: 'https://kagi.com/search?q=%s', suggest: null },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', suggest: null },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', suggest: null },
];
