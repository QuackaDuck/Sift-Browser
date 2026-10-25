// Tab tidy suggestions. Pure: tabs in, suggestions out. Nothing here closes
// anything; the UI asks first and every close can be undone.

import { canonicalUrl, hostOf } from './url.js';

const DAY = 24 * 3600e3;

/**
 * @param {Array} tabs [{id,url,title,pinned,lastActive}]
 * @param {object} opts {now, activeId, visibleIds, staleDays}
 */
export function tidySuggestions(tabs, opts = {}) {
  const now = opts.now ?? Date.now();
  const staleDays = opts.staleDays ?? 7;
  const protectedIds = new Set([opts.activeId, ...(opts.visibleIds || [])].filter(Boolean));
  const out = [];
  const isClosable = (t) => !t.pinned && !protectedIds.has(t.id) && t.url && !t.url.startsWith('sift:');

  // 1. Exact duplicates (ignoring #fragments, tracking parameters and www).
  const groups = new Map();
  for (const t of tabs) {
    if (!t.url || t.url.startsWith('sift:')) continue;
    const key = canonicalUrl(t.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const dupIds = [];
  let dupPages = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Keep the protected copy if there is one, else the most recently used.
    const keep = group.find((t) => protectedIds.has(t.id) || t.pinned) ||
      group.slice().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
    const extra = group.filter((t) => t !== keep && isClosable(t));
    if (extra.length) {
      dupIds.push(...extra.map((t) => t.id));
      dupPages++;
    }
  }
  if (dupIds.length) {
    out.push({
      id: 'duplicates', kind: 'close', tabIds: dupIds,
      title: `Close ${dupIds.length} duplicate ${dupIds.length === 1 ? 'tab' : 'tabs'}`,
      detail: `${dupPages} ${dupPages === 1 ? 'page is' : 'pages are'} open more than once. Sift keeps the copy you used last.`,
    });
  }

  // 2. Tabs not looked at for a while.
  const dup = new Set(dupIds);
  const stale = tabs.filter((t) => isClosable(t) && !dup.has(t.id) && t.lastActive && now - t.lastActive > staleDays * DAY);
  if (stale.length) {
    out.push({
      id: 'stale', kind: 'close', tabIds: stale.map((t) => t.id),
      title: `Close ${stale.length} ${stale.length === 1 ? 'tab' : 'tabs'} untouched for ${staleDays}+ days`,
      detail: 'They stay in History and Recently Closed, so nothing is lost.',
    });
  }

  // 3. Many tabs from one site: offer to file them away as a Moment.
  const bySite = new Map();
  for (const t of tabs) {
    if (!isClosable(t) || dup.has(t.id)) continue;
    const h = hostOf(t.url);
    if (!h) continue;
    if (!bySite.has(h)) bySite.set(h, []);
    bySite.get(h).push(t);
  }
  const crowded = [...bySite.entries()].filter(([, list]) => list.length >= 5).sort((a, b) => b[1].length - a[1].length);
  for (const [host, list] of crowded.slice(0, 2)) {
    out.push({
      id: `site:${host}`, kind: 'moment', tabIds: list.map((t) => t.id), host,
      title: `Save ${list.length} ${host} tabs as a Moment`,
      detail: 'Closes them and keeps the set one click away in Moments.',
    });
  }
  return out;
}
