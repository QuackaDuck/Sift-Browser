// sift://history, sift://bookmarks, sift://downloads, sift://moments:
// one page with four sections and a search field.

import { esc, favicon } from './dom.js';
import { icon } from './icons.js';
import { downloadRow } from './panels.js';
import { matchText, terms } from '../core/match.js';
import { ago, clock, dayLabel } from '../core/time.js';
import { hostOf } from '../core/url.js';

const SECTIONS = [['history', 'History', 'history'], ['bookmarks', 'Bookmarks', 'bookmark'], ['moments', 'Moments', 'moments'], ['downloads', 'Downloads', 'download']];

export function renderLibrary(app, page, section, state) {
  const b = app.browser;
  const q = state.query || '';
  page.innerHTML = `<div class="shell">
    <nav class="shell-nav"><h1>Library</h1>
      ${SECTIONS.map(([id, l, ic]) => `<button class="${id === section ? 'is-on' : ''}" data-section="${id}">${icon(ic)}${l}</button>`).join('')}
    </nav>
    <div class="shell-main"><div class="inner">
      <h2>${SECTIONS.find((s) => s[0] === section)[1]}</h2>
      <div class="lib-search">${icon('search')}<input class="text-input" placeholder="Search ${section}" value="${esc(q)}" data-libsearch spellcheck="false"></div>
      <div data-list>${LIST[section](b, q)}</div>
    </div></div></div>`;
  const input = page.querySelector('[data-libsearch]');
  input.addEventListener('input', () => {
    state.query = input.value;
    page.querySelector('[data-list]').innerHTML = LIST[section](b, input.value);
  });
  page.onclick = (e) => {
    const t = e.target;
    const nav = t.closest('[data-section]')?.dataset.section;
    if (nav) { state.query = ''; return b.navigate(`sift://${nav}`); }
    const open = t.closest('[data-open]')?.dataset.open;
    if (open) return b.navigate(open, { newTab: e.metaKey || e.ctrlKey || e.button === 1 });
    const del = t.closest('[data-del-history]')?.dataset.delHistory;
    if (del) return b.deleteHistory([del]);
    const bm = t.closest('[data-del-bookmark]')?.dataset.delBookmark;
    if (bm) return b.removeBookmark(bm);
    const ren = t.closest('[data-edit-bookmark]')?.dataset.editBookmark;
    if (ren) return editBookmark(app, page, ren);
    const mo = t.closest('[data-restore]')?.dataset.restore;
    if (mo) return b.restoreMoment(mo);
    const mdel = t.closest('[data-del-moment]')?.dataset.delMoment;
    if (mdel) return b.deleteMoment(mdel);
    const dl = t.closest('.dl');
    const act = t.closest('[data-d]')?.dataset.d;
    if (dl && act) {
      const d = b.downloads.find((x) => String(x.id) === dl.dataset.id);
      if (!d) return;
      if (act === 'open') b.bridge.send('download.open', { path: d.path });
      if (act === 'reveal') b.bridge.send('download.reveal', { path: d.path });
      if (act === 'cancel') b.bridge.send('download.cancel', { downloadId: d.id });
      if (act === 'pause') b.bridge.send(d.state === 'paused' ? 'download.resume' : 'download.pause', { downloadId: d.id });
    }
  };
}

function filter(list, q, fields) {
  const ts = terms(q);
  if (!ts.length) return list;
  return list.filter((x) => matchText(fields(x), ts).score > 0);
}

const empty = (text) => `<div class="empty-note">${text}</div>`;

const LIST = {
  history(b, q) {
    const items = filter(b.history, q, (h) => `${h.title} ${h.url}`).slice().sort((a, z) => z.lastVisit - a.lastVisit).slice(0, 500);
    if (!items.length) return empty(q ? 'No history matches your search.' : b.info?.incognito ? 'Private windows don’t keep history.' : 'Pages you visit will show up here.');
    let day = '';
    return items.map((h) => {
      const d = dayLabel(h.lastVisit);
      const head = d !== day ? `<div class="day">${esc(d)}</div>` : '';
      day = d;
      return `${head}<div class="row"><span class="time">${esc(clock(h.lastVisit))}</span>${favicon(h.url, h.favicon)}
        <span class="t" data-open="${esc(h.url)}">${esc(h.title || h.url)}</span><span class="h">${esc(hostOf(h.url))}</span>
        <span class="acts"><button class="ibtn sm" data-del-history="${esc(h.url)}" data-tip="Remove from history" aria-label="Remove">${icon('close')}</button></span></div>`;
    }).join('');
  },
  bookmarks(b, q) {
    const items = filter(b.bookmarks, q, (x) => `${x.title} ${x.url} ${x.folder}`);
    if (!items.length) return empty(q ? 'No bookmarks match your search.' : 'Press <kbd>' + (document.documentElement.dataset.platform === 'mac' ? '⌘' : 'Ctrl') + '</kbd><kbd>D</kbd> on any page to bookmark it, or import from another browser in Settings.');
    return items.map((x) => `<div class="row">${favicon(x.url, x.favicon)}<span class="t" data-open="${esc(x.url)}">${esc(x.title)}</span>
      ${x.folder ? `<span class="folder">${esc(x.folder)}</span>` : ''}<span class="h">${esc(hostOf(x.url))}</span>
      <span class="acts"><button class="ibtn sm" data-edit-bookmark="${esc(x.id)}" data-tip="Rename" aria-label="Rename">${icon('pencil')}</button>
      <button class="ibtn sm" data-del-bookmark="${esc(x.id)}" data-tip="Delete" aria-label="Delete">${icon('trash')}</button></span></div>`).join('');
  },
  moments(b, q) {
    const items = filter(b.moments, q, (m) => `${m.name} ${m.tabs.map((t) => t.title).join(' ')}`);
    if (!items.length) return empty(q ? 'No Moments match your search.' : 'Save a set of tabs as a Moment with the Moments button in the toolbar.');
    return items.map((m) => `<div class="group"><div class="card">
      <div class="setting"><div class="txt"><div class="name">${esc(m.name)}</div><div class="desc">${m.tabs.length} pages · saved ${esc(ago(m.createdAt))}${m.openedAt ? ` · opened ${esc(ago(m.openedAt))}` : ''}</div></div>
        <div class="ctl"><button class="btn primary" data-restore="${m.id}">Open</button><button class="btn ghost" data-del-moment="${m.id}">${icon('trash')}</button></div></div>
      ${m.tabs.map((t) => `<div class="row" style="margin:0 6px">${favicon(t.url, t.favicon)}<span class="t" data-open="${esc(t.url)}">${esc(t.title || t.url)}</span><span class="h">${esc(hostOf(t.url))}</span></div>`).join('')}
    </div></div>`).join('');
  },
  downloads(b, q) {
    const items = filter(b.downloads, q, (d) => `${d.name} ${d.url}`);
    if (!items.length) return empty(q ? 'No downloads match.' : 'Files you download in this session appear here.');
    return `<div class="card" style="padding:6px">${items.map(downloadRow).join('')}</div>`;
  },
};

function editBookmark(app, page, id) {
  const b = app.browser;
  const bm = b.bookmarks.find((x) => x.id === id);
  const row = page.querySelector(`[data-edit-bookmark="${CSS.escape(id)}"]`)?.closest('.row');
  if (!bm || !row) return;
  const span = row.querySelector('.t');
  const input = document.createElement('input');
  input.className = 'text-input';
  input.style.height = '28px';
  input.value = bm.title;
  span.replaceWith(input);
  input.focus();
  input.select();
  const done = (save) => { if (save && input.value.trim()) b.updateBookmark(id, { title: input.value.trim() }); else b.changed('bookmarks'); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
  input.addEventListener('blur', () => done(true), { once: true });
}
