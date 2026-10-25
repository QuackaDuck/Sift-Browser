// The address bar's ranking engine. Given what the user typed and the
// browser's local state, produce one ordered, de-duplicated list of
// actionable results. Pure: no DOM, no network.

import { canonicalUrl, classifyInput, hostOf, searchUrl } from './url.js';
import { initialsMatch, matchText, terms as splitTerms } from './match.js';

export const KIND = {
  NAVIGATE: 'navigate',     // go to a URL (typed or inline-completed)
  SEARCH: 'search',         // search the default engine
  SUGGESTION: 'suggestion', // engine-provided query suggestion
  TAB: 'tab',               // switch to an open tab
  HISTORY: 'history',
  BOOKMARK: 'bookmark',
  CLOSED: 'closed',         // reopen a recently closed tab
  MOMENT: 'moment',         // restore a saved Moment
  COMMAND: 'command',
};

const HOUR = 3600e3;
const DAY = 24 * HOUR;

/** Frecency in the spirit of Firefox's: visit count, decayed by age. */
export function frecency(entry, now) {
  const age = now - (entry.lastVisit || 0);
  const recency = age < HOUR ? 1.6 : age < DAY ? 1.3 : age < 7 * DAY ? 1 : age < 30 * DAY ? 0.7 : 0.4;
  return Math.log2((entry.visits || 1) + 1) * recency;
}

function urlFields(url) {
  const host = hostOf(url);
  let path = '';
  try {
    const u = new URL(url);
    path = (u.pathname + u.search).replace(/^\/$/, '');
  } catch { /* not a URL */ }
  return { host, path };
}

// Match terms against title, host and path; host prefix matches dominate.
function scoreEntry(entry, termList, rawInput) {
  const { host, path } = urlFields(entry.url);
  // Every term must appear somewhere across the fields.
  if (!matchText(`${entry.title || ''} ${host} ${path}`, termList).score) return null;
  const title = matchText(entry.title || '', termList);
  const hostM = matchText(host, termList);
  const pathM = matchText(path, termList);
  let score = Math.max(title.score, hostM.score * 1.25, pathM.score * 0.7, 0.8);
  const bare = rawInput.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (bare && host.startsWith(bare)) score += 4;
  return { score, titleRanges: title.ranges, hostRanges: hostM.ranges };
}

/**
 * @param {string} input
 * @param {object} ctx
 *   tabs:        [{id,url,title,favicon,lastActive,pinned}]
 *   activeId:    current tab id (never offered as "switch to")
 *   history:     [{url,title,favicon,visits,lastVisit}]
 *   bookmarks:   [{id,url,title,favicon}]
 *   closed:      [{url,title,favicon,closedAt}]
 *   moments:     [{id,name,tabs,updatedAt}]
 *   commands:    [{id,title,keywords,shortcut,hint,priority}]
 *   suggestions: [string] from the search engine (optional, off by default)
 *   engine:      {name,url}
 *   now, mode ('address' | 'command'), limit
 * @returns {{results: Array, autocomplete: null|{completion:string, result:object}}}
 */
export function rank(input, ctx) {
  const now = ctx.now ?? Date.now();
  const raw = (input || '').trim();
  const limit = ctx.limit || 8;
  if (ctx.mode === 'command') return rankCommands(raw, ctx, limit);
  if (!raw) return { results: zeroState(ctx, now, limit), autocomplete: null };

  const termList = splitTerms(raw);
  const typed = classifyInput(raw);
  const candidates = [];
  const openByCanon = new Map();
  for (const t of ctx.tabs || []) openByCanon.set(canonicalUrl(t.url), t);

  // Open tabs: switching is cheaper than loading, so they get a boost.
  for (const tab of ctx.tabs || []) {
    if (tab.id === ctx.activeId || !tab.url) continue;
    const m = scoreEntry(tab, termList, raw);
    if (!m) continue;
    const recentBoost = tab.lastActive && now - tab.lastActive < HOUR ? 0.6 : 0;
    candidates.push({
      kind: KIND.TAB, id: `tab:${tab.id}`, tabId: tab.id, url: tab.url, title: tab.title || hostOf(tab.url),
      favicon: tab.favicon, score: m.score + 2.2 + recentBoost, titleRanges: m.titleRanges, hostRanges: m.hostRanges,
    });
  }

  for (const b of ctx.bookmarks || []) {
    const m = scoreEntry(b, termList, raw);
    if (!m) continue;
    candidates.push({
      kind: KIND.BOOKMARK, id: `bm:${b.id}`, url: b.url, title: b.title || hostOf(b.url), favicon: b.favicon,
      score: m.score + 1.6, titleRanges: m.titleRanges, hostRanges: m.hostRanges,
    });
  }

  for (const h of ctx.history || []) {
    const m = scoreEntry(h, termList, raw);
    if (!m) continue;
    candidates.push({
      kind: KIND.HISTORY, id: `h:${h.url}`, url: h.url, title: h.title || hostOf(h.url), favicon: h.favicon,
      score: m.score + frecency(h, now) * 0.9, lastVisit: h.lastVisit, titleRanges: m.titleRanges, hostRanges: m.hostRanges,
    });
  }

  for (const c of ctx.closed || []) {
    if (now - (c.closedAt || 0) > DAY) continue;
    const m = scoreEntry(c, termList, raw);
    if (!m) continue;
    candidates.push({
      kind: KIND.CLOSED, id: `closed:${c.closedAt}:${c.url}`, url: c.url, title: c.title || hostOf(c.url),
      favicon: c.favicon, closedAt: c.closedAt, score: m.score + 0.8, titleRanges: m.titleRanges, hostRanges: m.hostRanges,
    });
  }

  for (const mo of ctx.moments || []) {
    const m = matchText(mo.name, termList);
    if (!m.score) continue;
    candidates.push({
      kind: KIND.MOMENT, id: `moment:${mo.id}`, momentId: mo.id, title: mo.name,
      subtitle: `${mo.tabs.length} ${mo.tabs.length === 1 ? 'page' : 'pages'}`, score: m.score + 1.5, titleRanges: m.ranges,
    });
  }

  // Commands only surface on a strong, deliberate match so they never crowd
  // out navigation ("set" shouldn't bury your settings.com history).
  if (raw.length >= 2) {
    for (const cmd of ctx.commands || []) {
      const s = commandScore(cmd, termList, raw);
      if (s < 2.6) continue;
      candidates.push({
        kind: KIND.COMMAND, id: `cmd:${cmd.id}`, commandId: cmd.id, title: cmd.title, subtitle: cmd.hint,
        shortcut: cmd.shortcut, icon: cmd.icon, score: s - 0.4, titleRanges: matchText(cmd.title, termList).ranges,
      });
    }
  }

  const deduped = dedupe(candidates, openByCanon);

  // Navigational suggestion: the most-visited origin whose host starts with
  // what was typed. This is the inline-autocomplete target ("fig" -> figma.com).
  const nav = typed.type === 'search' || !raw.includes(' ') ? navigationalHit(raw, ctx, now) : null;
  const results = [];
  let autocomplete = null;

  if (nav) {
    results.push(nav);
    autocomplete = { completion: nav.completion, result: nav };
  } else if (typed.type === 'url' || typed.type === 'internal') {
    results.push({ kind: KIND.NAVIGATE, id: `go:${typed.url}`, url: typed.url, title: raw, typed: true, score: 100 });
  }

  const engine = ctx.engine;
  const search = typed.type === 'search' && engine
    ? { kind: KIND.SEARCH, id: `search:${raw}`, query: raw, url: searchUrl(engine, raw), title: raw, engine: engine.name, score: 3 }
    : null;

  deduped.sort((a, b) => b.score - a.score);
  const navCanon = nav ? canonicalUrl(nav.url) : null;
  const pool = deduped.filter((c) => !c.url || canonicalUrl(c.url) !== navCanon);

  // With no navigational hit and no strong match, Enter should search.
  if (search && !nav && (pool[0]?.score ?? 0) < 6) results.push(search);

  let history = 0;
  for (const c of pool) {
    if (results.length >= limit - (search && !results.includes(search) ? 1 : 0)) break;
    if (c.kind === KIND.HISTORY && ++history > 4) continue;
    results.push(c);
  }
  // Searching is always one arrow-key away: second when something else leads.
  if (search && !results.includes(search)) results.splice(Math.min(1, results.length), 0, search);

  for (const s of (ctx.suggestions || []).slice(0, 4)) {
    if (!s || s.toLowerCase() === raw.toLowerCase() || !engine) continue;
    results.push({ kind: KIND.SUGGESTION, id: `sugg:${s}`, query: s, url: searchUrl(engine, s), title: s, engine: engine.name, score: 0 });
  }

  return { results: results.slice(0, limit + 3), autocomplete };
}

function commandScore(cmd, termList, raw) {
  const title = matchText(cmd.title, termList).score;
  const keys = matchText((cmd.keywords || []).join(' '), termList).score * 0.9;
  let s = Math.max(title, keys);
  if (initialsMatch(cmd.title, raw)) s = Math.max(s, 3);
  return s;
}

const KIND_ORDER = { tab: 5, bookmark: 4, closed: 3, history: 2, moment: 6, command: 6 };

function dedupe(candidates, openByCanon) {
  const best = new Map();
  for (const c of candidates) {
    const key = c.url ? canonicalUrl(c.url) : c.id;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, c);
      continue;
    }
    // Keep the most actionable kind, but carry over the strongest score.
    const keep = KIND_ORDER[c.kind] > KIND_ORDER[prev.kind] ? c : prev;
    const other = keep === c ? prev : c;
    keep.score = Math.max(prev.score, c.score) + 0.3;
    if (other.kind === KIND.BOOKMARK || keep.kind === KIND.BOOKMARK) keep.bookmarked = true;
    if (other.lastVisit && !keep.lastVisit) keep.lastVisit = other.lastVisit;
    best.set(key, keep);
  }
  // A closed tab whose page is open again is just a tab.
  return [...best.values()].filter((c) => !(c.kind === KIND.CLOSED && openByCanon.has(canonicalUrl(c.url))));
}

function navigationalHit(raw, ctx, now) {
  const typed = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!typed || /\s/.test(typed)) return null;
  const origins = new Map();
  const add = (url, weight, title, favicon) => {
    let u;
    try { u = new URL(url); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const key = u.hostname.replace(/^www\./, '') + (u.port ? `:${u.port}` : '');
    if (!key.startsWith(typed)) return;
    const o = origins.get(key) || { host: key, weight: 0, url: `${u.protocol}//${u.host}/`, title: '', favicon: null, isRoot: false };
    o.weight += weight;
    if (u.pathname === '/' && !o.isRoot) { o.isRoot = true; o.title = title || o.title; }
    if (!o.title) o.title = title;
    if (!o.favicon && favicon) o.favicon = favicon;
    origins.set(key, o);
  };
  for (const h of ctx.history || []) add(h.url, frecency(h, now), h.title, h.favicon);
  for (const b of ctx.bookmarks || []) add(b.url, 2, b.title, b.favicon);
  for (const t of ctx.tabs || []) add(t.url, 1, t.title, t.favicon);
  let top = null;
  for (const o of origins.values()) if (!top || o.weight > top.weight) top = o;
  if (!top || top.weight < 0.2) return null;
  return {
    kind: KIND.NAVIGATE, id: `go:${top.url}`, url: top.url, title: top.host, subtitle: top.isRoot ? top.title : '',
    favicon: top.favicon, completion: top.host, score: 50, inline: true,
  };
}

// What the dropdown shows before anything is typed: where you were, not ads.
function zeroState(ctx, now, limit) {
  const out = [];
  const tabs = (ctx.tabs || [])
    .filter((t) => t.id !== ctx.activeId && t.url && !t.url.startsWith('sift:'))
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
    .slice(0, 3);
  for (const t of tabs) out.push({ kind: KIND.TAB, id: `tab:${t.id}`, tabId: t.id, url: t.url, title: t.title, favicon: t.favicon, score: 0 });
  for (const c of (ctx.closed || []).filter((c) => now - c.closedAt < HOUR).slice(0, 1)) {
    out.push({ kind: KIND.CLOSED, id: `closed:${c.closedAt}:${c.url}`, url: c.url, title: c.title, favicon: c.favicon, closedAt: c.closedAt, score: 0 });
  }
  const seen = new Set(out.map((r) => canonicalUrl(r.url)));
  for (const t of ctx.tabs || []) seen.add(canonicalUrl(t.url));
  const recent = (ctx.history || []).slice().sort((a, b) => b.lastVisit - a.lastVisit);
  for (const h of recent) {
    if (out.length >= limit - 1) break;
    const key = canonicalUrl(h.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: KIND.HISTORY, id: `h:${h.url}`, url: h.url, title: h.title, favicon: h.favicon, lastVisit: h.lastVisit, score: 0 });
  }
  return out;
}

function rankCommands(raw, ctx, limit) {
  const termList = splitTerms(raw);
  const list = [];
  for (const cmd of ctx.commands || []) {
    if (cmd.hidden && !raw) continue;
    if (!raw) { list.push({ cmd, score: cmd.priority || 0 }); continue; }
    const s = commandScore(cmd, termList, raw);
    if (s > 0) list.push({ cmd, score: s + (cmd.priority || 0) * 0.1 });
  }
  list.sort((a, b) => b.score - a.score);
  const results = list.map(({ cmd, score }) => ({
    kind: KIND.COMMAND, id: `cmd:${cmd.id}`, commandId: cmd.id, title: cmd.title, subtitle: cmd.hint, shortcut: cmd.shortcut,
    icon: cmd.icon, score, titleRanges: raw ? matchText(cmd.title, termList).ranges : [],
  }));
  // Moments are reachable by name from the command list too.
  if (raw) {
    for (const mo of ctx.moments || []) {
      const m = matchText(mo.name, termList);
      if (m.score) results.push({ kind: KIND.MOMENT, id: `moment:${mo.id}`, momentId: mo.id, title: mo.name, subtitle: `${mo.tabs.length} pages`, score: m.score + 0.5, titleRanges: m.ranges });
    }
    results.sort((a, b) => b.score - a.score);
  }
  return { results: results.slice(0, limit + 4), autocomplete: null };
}
