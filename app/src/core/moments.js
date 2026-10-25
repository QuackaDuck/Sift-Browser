// Moments: named, user-saved snapshots of a set of tabs. Pure helpers over
// the stored array; persistence lives in the store.

import { hostOf, isInternal } from './url.js';

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

export function snapshotTab(tab, extra = {}) {
  return {
    url: tab.url, title: tab.title || hostOf(tab.url), favicon: tab.favicon || null,
    pinned: !!tab.pinned, scroll: extra.scroll ?? null,
  };
}

/** A sensible default name from the tabs (never AI): the dominant site, or the active page's title. */
export function suggestName(tabs, activeTab) {
  const hosts = new Map();
  for (const t of tabs) {
    const h = hostOf(t.url);
    if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
  }
  const [topHost, count] = [...hosts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (topHost && tabs.length > 1 && count >= tabs.length * 0.6) {
    const label = topHost.split('.').slice(-2, -1)[0] || topHost;
    return label[0].toUpperCase() + label.slice(1);
  }
  const title = activeTab?.title || tabs[0]?.title || 'Untitled';
  return title.split(/\s[-|–—·:]\s/)[0].slice(0, 40);
}

export function createMoment(list, { name, tabs, activeIndex = 0, split = null, now = Date.now() }) {
  const pages = tabs.filter((t) => t.url && !isInternal(t.url));
  const moment = {
    id: newId(), name: (name || '').trim() || 'Untitled Moment', createdAt: now, updatedAt: now, openedAt: null,
    tabs: pages, activeIndex: Math.min(activeIndex, Math.max(0, pages.length - 1)), split,
  };
  return { list: [moment, ...list], moment };
}

export function renameMoment(list, id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return list;
  return list.map((m) => (m.id === id ? { ...m, name: trimmed, updatedAt: Date.now() } : m));
}

export function updateMomentTabs(list, id, tabs, now = Date.now()) {
  return list.map((m) => (m.id === id ? { ...m, tabs: tabs.filter((t) => t.url && !isInternal(t.url)), updatedAt: now } : m));
}

export function deleteMoment(list, id) {
  const index = list.findIndex((m) => m.id === id);
  if (index < 0) return { list, removed: null, index: -1 };
  return { list: list.filter((m) => m.id !== id), removed: list[index], index };
}

export function restoreDeleted(list, removed, index) {
  const next = list.slice();
  next.splice(Math.min(index, next.length), 0, removed);
  return next;
}

export function markOpened(list, id, now = Date.now()) {
  return list.map((m) => (m.id === id ? { ...m, openedAt: now } : m));
}

/** Most recently used first: opened or updated, whichever is later. */
export function recentMoments(list, n = 4) {
  const last = (m) => Math.max(m.openedAt || 0, m.updatedAt || 0);
  return list.slice().sort((a, b) => last(b) - last(a)).slice(0, n);
}
