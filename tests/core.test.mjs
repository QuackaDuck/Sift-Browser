// Unit tests for Sift's pure UI logic. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyInput, canonicalUrl, displayParts, queryFromSearchUrl, SEARCH_ENGINES } from '../app/src/core/url.js';
import { rank, KIND } from '../app/src/core/omnibox.js';
import { tidySuggestions } from '../app/src/core/cleanup.js';
import { createMoment, deleteMoment, renameMoment, restoreDeleted, suggestName, recentMoments } from '../app/src/core/moments.js';
import { parseBookmarksHtml, exportBookmarksHtml, parseChromiumBookmarks } from '../app/src/core/bookmarks-io.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const engine = SEARCH_ENGINES[0];

test('classifyInput separates URLs, internal pages and searches', () => {
  assert.deepEqual(classifyInput('figma.com'), { type: 'url', url: 'https://figma.com' });
  assert.deepEqual(classifyInput('localhost:3000/app'), { type: 'url', url: 'http://localhost:3000/app' });
  assert.deepEqual(classifyInput('192.168.1.1'), { type: 'url', url: 'http://192.168.1.1' });
  assert.deepEqual(classifyInput('https://example.org/a b'), { type: 'url', url: 'https://example.org/a b' });
  assert.deepEqual(classifyInput('sift://Settings/'), { type: 'internal', url: 'sift://settings' });
  assert.equal(classifyInput('figma').type, 'search');
  assert.equal(classifyInput('how to center a div').type, 'search');
  assert.equal(classifyInput('node.js streams').type, 'search');
});

test('canonicalUrl ignores www, fragments, trailing slashes and tracking params', () => {
  assert.equal(
    canonicalUrl('https://www.example.com/a/?utm_source=x&b=2#top'),
    canonicalUrl('https://example.com/a?b=2'),
  );
  assert.notEqual(canonicalUrl('https://example.com/a?b=2'), canonicalUrl('https://example.com/a?b=3'));
});

test('displayParts emphasises the host', () => {
  const p = displayParts('https://www.figma.com/files/recent?x=1');
  assert.equal(p.host, 'figma.com');
  assert.equal(p.rest, '/files/recent?x=1');
  assert.equal(p.secure, true);
});

test('queryFromSearchUrl recovers the typed query', () => {
  assert.equal(queryFromSearchUrl(SEARCH_ENGINES, 'https://duckduckgo.com/?q=figma%20plugins'), 'figma plugins');
  assert.equal(queryFromSearchUrl(SEARCH_ENGINES, 'https://figma.com/'), null);
});

const ctx = {
  now: NOW,
  engine,
  activeId: 't0',
  tabs: [
    { id: 't0', url: 'https://news.ycombinator.com/', title: 'Hacker News', lastActive: NOW },
    { id: 't1', url: 'https://www.figma.com/design/abc/Design-Review', title: 'Figma Design Review', lastActive: NOW - 600e3 },
  ],
  history: [
    { url: 'https://www.figma.com/', title: 'Figma: The Collaborative Interface Design Tool', visits: 40, lastVisit: NOW - 3600e3 },
    { url: 'https://www.figma.com/resources/learn-design/', title: 'Figma resources', visits: 3, lastVisit: NOW - 5 * 86400e3 },
    { url: 'https://fig.io/', title: 'Fig', visits: 1, lastVisit: NOW - 60 * 86400e3 },
  ],
  bookmarks: [],
  closed: [],
  moments: [],
  commands: [{ id: 'newTab', title: 'New Tab', keywords: ['open'] }, { id: 'settings', title: 'Open Settings', keywords: ['preferences'] }],
};

test('typing "figma" ranks the site, then the open tab, then history, with search close by', () => {
  const { results, autocomplete } = rank('figma', ctx);
  assert.equal(results[0].kind, KIND.NAVIGATE);
  assert.equal(results[0].url, 'https://www.figma.com/');
  assert.equal(autocomplete.completion, 'figma.com');
  assert.equal(results[1].kind, KIND.SEARCH);
  const kinds = results.map((r) => r.kind);
  assert.ok(kinds.indexOf(KIND.TAB) > 0 && kinds.indexOf(KIND.TAB) < kinds.indexOf(KIND.HISTORY));
  assert.equal(results.find((r) => r.kind === KIND.TAB).tabId, 't1');
  assert.ok(results.some((r) => r.kind === KIND.HISTORY && /resources/.test(r.url)));
});

test('inline completion follows the typed prefix', () => {
  const { autocomplete } = rank('fi', ctx);
  assert.equal(autocomplete.completion, 'figma.com'); // 40 visits beats fig.io's 1
  assert.equal(rank('fig.', ctx).autocomplete.completion, 'fig.io');
});

test('inline completion skips a leading subdomain', () => {
  const c = { ...ctx, history: [{ url: 'https://en.wikipedia.org/wiki/Typography', title: 'Typography', visits: 5, lastVisit: NOW }] };
  const { autocomplete, results } = rank('wiki', c);
  assert.equal(autocomplete.completion, 'wikipedia.org');
  assert.equal(results[0].url, 'https://en.wikipedia.org/');
});

test('the active tab is never offered as a switch target', () => {
  const { results } = rank('hacker', ctx);
  assert.ok(!results.some((r) => r.kind === KIND.TAB && r.tabId === 't0'));
});

test('multi-word queries search first when nothing navigational matches', () => {
  const { results } = rank('best hiking boots', ctx);
  assert.equal(results[0].kind, KIND.SEARCH);
  assert.equal(results[0].url, 'https://duckduckgo.com/?q=best%20hiking%20boots');
});

test('commands only appear on deliberate matches in address mode', () => {
  assert.ok(!rank('o', ctx).results.some((r) => r.kind === KIND.COMMAND));
  assert.ok(rank('settings', ctx).results.some((r) => r.kind === KIND.COMMAND && r.commandId === 'settings'));
});

test('command mode lists commands and finds moments by name', () => {
  const withMoment = { ...ctx, mode: 'command', moments: [{ id: 'm1', name: 'Website redesign', tabs: [{}, {}] }] };
  assert.equal(rank('', withMoment).results[0].kind, KIND.COMMAND);
  assert.ok(rank('redesign', withMoment).results.some((r) => r.kind === KIND.MOMENT));
});

test('history entries for an open tab collapse into the tab result', () => {
  const c = { ...ctx, history: [...ctx.history, { url: 'https://www.figma.com/design/abc/Design-Review', title: 'Figma Design Review', visits: 9, lastVisit: NOW - 7200e3 }] };
  const { results } = rank('design review', c);
  const matching = results.filter((r) => r.url === 'https://www.figma.com/design/abc/Design-Review');
  assert.equal(matching.length, 1);
  assert.equal(matching[0].kind, KIND.TAB);
});

test('tidy finds duplicates, keeps the active copy, and never touches pinned tabs', () => {
  const day = 86400e3;
  const tabs = [
    { id: 'a', url: 'https://docs.rs/serde', lastActive: NOW },
    { id: 'b', url: 'https://docs.rs/serde#derive', lastActive: NOW - day },
    { id: 'c', url: 'https://example.com/old', lastActive: NOW - 20 * day },
    { id: 'd', url: 'https://example.com/pinned', lastActive: NOW - 20 * day, pinned: true },
  ];
  const s = tidySuggestions(tabs, { now: NOW, activeId: 'a' });
  assert.deepEqual(s.find((x) => x.id === 'duplicates').tabIds, ['b']);
  assert.deepEqual(s.find((x) => x.id === 'stale').tabIds, ['c']);
});

test('tidy suggests a Moment for a crowded site', () => {
  const tabs = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, url: `https://github.com/org/repo/pull/${i}`, lastActive: NOW }));
  const s = tidySuggestions(tabs, { now: NOW });
  assert.equal(s[0].kind, 'moment');
  assert.equal(s[0].host, 'github.com');
});

test('moments: create, rename, delete with undo, recency', () => {
  let { list, moment } = createMoment([], { name: '  Trip to Lisbon ', tabs: [{ url: 'https://a.com' }, { url: 'sift://newtab' }], now: NOW });
  assert.equal(moment.name, 'Trip to Lisbon');
  assert.equal(moment.tabs.length, 1, 'internal pages are not saved');
  list = renameMoment(list, moment.id, 'Lisbon');
  assert.equal(list[0].name, 'Lisbon');
  assert.equal(renameMoment(list, moment.id, '   ')[0].name, 'Lisbon');
  const del = deleteMoment(list, moment.id);
  assert.equal(del.list.length, 0);
  assert.equal(restoreDeleted(del.list, del.removed, del.index)[0].id, moment.id);
  const second = createMoment(list, { name: 'B', tabs: [], now: NOW + 10 });
  assert.equal(recentMoments(second.list)[0].name, 'B');
});

test('moment names come from the dominant site or the page title', () => {
  assert.equal(suggestName([{ url: 'https://github.com/a' }, { url: 'https://github.com/b' }, { url: 'https://x.com' }]), 'Github');
  assert.equal(suggestName([{ url: 'https://a.com', title: 'Flights to Lisbon – Example Air' }]), 'Flights to Lisbon');
});

test('bookmarks round-trip through Netscape HTML', () => {
  const html = exportBookmarksHtml([
    { url: 'https://a.com/', title: 'A & B', folder: '' },
    { url: 'https://b.com/', title: 'Docs', folder: 'Work' },
  ]);
  const parsed = parseBookmarksHtml(html);
  assert.deepEqual(parsed, [
    { url: 'https://a.com/', title: 'A & B', folder: '' },
    { url: 'https://b.com/', title: 'Docs', folder: 'Work' },
  ]);
});

test('chromium bookmarks import flattens folders', () => {
  const json = { roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
    { type: 'url', name: 'MDN', url: 'https://developer.mozilla.org/' },
    { type: 'folder', name: 'Travel', children: [{ type: 'url', name: 'Maps', url: 'https://maps.example/' }] },
    { type: 'url', name: 'JS', url: 'javascript:alert(1)' },
  ] } } };
  assert.deepEqual(parseChromiumBookmarks(json), [
    { url: 'https://developer.mozilla.org/', title: 'MDN', folder: '' },
    { url: 'https://maps.example/', title: 'Maps', folder: 'Travel' },
  ]);
});
