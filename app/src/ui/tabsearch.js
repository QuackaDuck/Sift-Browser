// Tab search (Cmd/Ctrl+Shift+A, or the tab counter in the tab row).
//
// Search every open tab by title or address, see a preview of the selected
// one, switch with Enter. Select several (Space / Shift-click) to close them
// or save them as a Moment. "Tidy" lists optional clean-up suggestions.

import { esc, favicon, h, highlight, keycaps } from './dom.js';
import { icon } from './icons.js';
import { canonicalUrl, hostOf, isInternal } from '../core/url.js';
import { matchText, terms } from '../core/match.js';
import { tidySuggestions } from '../core/cleanup.js';
import { ago } from '../core/time.js';

export class TabSearch {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.view = 'search';
    this.query = '';
    this.cursor = 0;
    this.checked = new Set();
    this.rows = [];
    this.b.subscribe((what) => {
      if (this.el && (what.has('tabs') || what.has('thumbs'))) this.render();
    });
  }

  get isOpen() { return !!this.app.layer.find('tabsearch'); }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open(view = 'search') {
    this.view = view;
    this.query = '';
    this.cursor = 0;
    this.checked.clear();
    this.el = h('div', { class: 'pop tabsearch', role: 'dialog', 'aria-label': 'Search tabs' });
    this.el.innerHTML = `
      <div class="ts-head">${icon('search')}
        <input spellcheck="false" autocomplete="off" aria-label="Search open tabs">
        <div class="seg" role="tablist">
          <button data-view="search" role="tab">All tabs</button>
          <button data-view="tidy" role="tab">Tidy <span class="n"></span></button>
        </div>
      </div>
      <div class="ts-body"></div>
      <div class="ts-foot"></div>`;
    this.input = this.el.querySelector('input');
    this.input.addEventListener('input', () => { this.query = this.input.value; this.cursor = 0; this.view = 'search'; this.render(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.el.querySelector('.seg').addEventListener('click', (e) => {
      const v = e.target.closest('[data-view]')?.dataset.view;
      if (v) { this.view = v; this.render(); this.input.focus(); }
    });
    this.app.layer.open({ id: 'tabsearch', el: this.el, scrim: true, onClose: () => { this.el = null; } });
    this.b.bridge.send('ui.focus');
    this.input.focus();
    this.render();
  }

  close() { this.app.layer.close('tabsearch'); }

  results() {
    const b = this.b;
    const list = b.tabs.slice();
    const dupKeys = new Map();
    for (const t of list) dupKeys.set(canonicalUrl(t.url), (dupKeys.get(canonicalUrl(t.url)) || 0) + 1);
    const ts = terms(this.query);
    let out;
    if (!ts.length) {
      // Most recently used first: the tab you want is usually one you just left.
      out = list.map((t) => ({ t, score: 0 })).sort((a, z) => (z.t.id === b.activeId) - (a.t.id === b.activeId) || (z.t.lastActive || 0) - (a.t.lastActive || 0));
    } else {
      out = [];
      for (const t of list) {
        const title = matchText(t.title || '', ts);
        const url = matchText(isInternal(t.url) ? t.url : `${hostOf(t.url)}${safePath(t.url)}`, ts);
        const all = matchText(`${t.title || ''} ${t.url}`, ts);
        if (!all.score) continue;
        out.push({ t, score: Math.max(title.score * 1.1, url.score) + (t.lastActive ? Math.min(1, 3600e3 / (Date.now() - t.lastActive + 1)) : 0), titleRanges: title.ranges, urlRanges: url.ranges });
      }
      out.sort((a, z) => z.score - a.score);
    }
    return out.map((r) => ({ ...r, dup: dupKeys.get(canonicalUrl(r.t.url)) > 1 && !isInternal(r.t.url) }));
  }

  render() {
    if (!this.el) return;
    const b = this.b;
    const suggestions = tidySuggestions(b.tabs, { activeId: b.activeId, visibleIds: b.visibleIds() });
    this.suggestions = suggestions;
    this.el.querySelectorAll('.seg button').forEach((btn) => btn.classList.toggle('is-on', btn.dataset.view === this.view));
    this.el.querySelector('.seg .n').textContent = suggestions.length ? String(suggestions.length) : '';
    this.input.placeholder = `Search ${b.tabs.length} open ${b.tabs.length === 1 ? 'tab' : 'tabs'}`;
    const body = this.el.querySelector('.ts-body');
    if (this.view === 'tidy') return this.renderTidy(body, suggestions);

    this.rows = this.results();
    this.cursor = Math.min(this.cursor, Math.max(0, this.rows.length - 1));
    const selecting = this.checked.size > 0;
    const group = (label, items, offset) => (items.length ? `<div class="ts-group"><span>${label}</span><span>${items.length}</span></div>${items.map((r, i) => this.rowHtml(r, offset + i)).join('')}` : '');
    let listHtml;
    if (this.query) listHtml = group('Matches', this.rows, 0);
    else {
      const pinned = this.rows.filter((r) => r.t.pinned);
      const rest = this.rows.filter((r) => !r.t.pinned);
      this.rows = [...pinned, ...rest];
      listHtml = group('Pinned', pinned, 0) + group('Recently used', rest, pinned.length);
    }
    if (!this.rows.length) listHtml = `<div class="results-empty">No open tab matches “${esc(this.query)}”. Press ${keycaps('enter')} to search the web instead.</div>`;
    body.innerHTML = `<div class="ts-list ${selecting ? 'is-selecting' : ''}" role="listbox">${listHtml}</div><div class="ts-side"></div>`;
    const list = body.querySelector('.ts-list');
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.ts-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('.x')) return this.closeIds([this.rows[i].t.id]);
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.target.closest('.check')) { this.toggleCheck(i); return; }
      this.choose(i);
    });
    list.addEventListener('pointermove', (e) => {
      const row = e.target.closest('.ts-row');
      if (row && Number(row.dataset.i) !== this.cursor) { this.cursor = Number(row.dataset.i); this.paintCursor(false); }
    });
    this.paintCursor(true);
    this.renderFoot();
  }

  rowHtml(r, i) {
    const t = r.t;
    const sub = isInternal(t.url) ? t.url : `${hostOf(t.url)}${safePath(t.url)}`;
    const flags = [
      t.id === this.b.activeId ? '<span class="tag is-current">Current</span>' : '',
      r.dup ? '<span class="tag is-dup">Duplicate</span>' : '',
      t.discarded ? '<span class="tag">Sleeping</span>' : '',
      t.pinned ? icon('pin') : '',
    ].join('');
    return `<div class="ts-row ${this.checked.has(t.id) ? 'is-checked' : ''}" data-i="${i}" role="option">
      <span class="check">${icon('check')}</span>
      <span class="fav">${favicon(t.url, t.favicon, { internalIcon: icon('sift') })}</span>
      <div class="txt"><div class="t">${highlight(t.title || hostOf(t.url) || 'New Tab', r.titleRanges)}</div><div class="s">${highlight(sub, r.urlRanges)}</div></div>
      <span class="flags">${flags}</span>
      <button class="ibtn sm x" aria-label="Close tab" tabindex="-1">${icon('close')}</button>
    </div>`;
  }

  paintCursor(scroll) {
    if (!this.el) return;
    this.el.querySelectorAll('.ts-row').forEach((row) => {
      const on = Number(row.dataset.i) === this.cursor;
      row.classList.toggle('is-cursor', on);
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    });
    this.renderSide();
  }

  renderSide() {
    const side = this.el.querySelector('.ts-side');
    const r = this.rows[this.cursor];
    if (!side) return;
    if (!r) { side.innerHTML = ''; return; }
    const t = r.t;
    const shot = t.thumbnail ? `<div class="shot" style="background-image:url('${t.thumbnail}')"></div>` : `<div class="shot"><div class="big-favicon">${favicon(t.url, t.favicon, { internalIcon: icon('sift') })}</div></div>`;
    const status = t.id === this.b.activeId ? 'Current tab' : t.discarded ? 'Sleeping (reloads when opened)' : t.loading ? 'Loading' : 'Loaded';
    side.innerHTML = `${shot}<div><h3>${esc(t.title || 'New Tab')}</h3><div class="url">${esc(t.url)}</div></div>
      <dl><dt>Last viewed</dt><dd>${t.id === this.b.activeId ? 'Now' : esc(ago(t.lastActive) || '—')}</dd>
      <dt>Opened</dt><dd>${esc(ago(t.createdAt) || '—')}</dd>
      <dt>Status</dt><dd>${esc(status)}</dd>
      ${t.blocked ? `<dt>Trackers</dt><dd>${t.blocked} requests blocked</dd>` : ''}</dl>
      <div class="actions">
        <button class="btn primary" data-a="switch">Switch ${keycaps('enter')}</button>
        <button class="btn" data-a="split" ${t.id === this.b.activeId ? 'disabled' : ''}>${icon('split')}Side by side</button>
        <button class="btn ghost" data-a="close">${icon('close')}Close</button>
      </div>`;
    side.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'switch') this.choose(this.cursor);
      if (a === 'close') this.closeIds([t.id]);
      if (a === 'split') { const active = this.b.activeId; this.close(); this.b.openSplit(active, t.id); }
    };
  }

  renderFoot() {
    const foot = this.el.querySelector('.ts-foot');
    const n = this.checked.size;
    if (n) {
      foot.innerHTML = `<span class="sel">${n} selected</span><span class="grow"></span>
        <button class="btn ghost" data-f="clear">Clear</button>
        <button class="btn" data-f="moment">${icon('momentSave')}Save as Moment</button>
        <button class="btn danger" data-f="close">${icon('close')}Close ${n}</button>`;
      foot.onclick = (e) => {
        const f = e.target.closest('[data-f]')?.dataset.f;
        if (f === 'clear') { this.checked.clear(); this.render(); }
        if (f === 'close') this.closeIds([...this.checked]);
        if (f === 'moment') { const ids = [...this.checked]; this.close(); this.app.moments.openSave({ preselect: ids, only: true }); }
      };
      return;
    }
    foot.innerHTML = `<span>${keycaps('up')}${keycaps('down')} Move</span><span>${keycaps('enter')} Switch</span><span>${keycaps('space')} Select</span><span>${keycaps('mod+backspace')} Close</span><span class="grow"></span><span>${keycaps('esc')} Done</span>`;
    foot.onclick = null;
  }

  renderTidy(body, suggestions) {
    this.el.querySelector('.ts-foot').innerHTML = '<span>Suggestions only. Nothing closes until you choose, and closed tabs stay in Recently Closed.</span>';
    if (!suggestions.length) {
      body.innerHTML = `<div class="tidy"><div class="tidy-empty">${icon('check')}<b>Nothing to tidy</b>No duplicates, no tabs left untouched for a week, no site with a pile of tabs.</div></div>`;
      return;
    }
    body.innerHTML = `<div class="tidy">${suggestions.map((s, i) => {
      const tabs = s.tabIds.map((id) => this.b.tab(id)).filter(Boolean);
      return `<div class="tidy-item" data-i="${i}">${icon(s.kind === 'moment' ? 'moments' : s.id === 'duplicates' ? 'duplicate' : 'clock')}
        <div class="body"><div class="t">${esc(s.title)}</div><div class="d">${esc(s.detail)}</div>
          <div class="favs">${tabs.slice(0, 8).map((t) => `<span class="chip">${favicon(t.url, t.favicon)}${esc(t.title || hostOf(t.url))}</span>`).join('')}${tabs.length > 8 ? `<span class="chip">+${tabs.length - 8} more</span>` : ''}</div></div>
        <div class="acts"><button class="btn ghost" data-t="review">Review</button>
          <button class="btn ${s.kind === 'moment' ? 'primary' : ''}" data-t="apply">${s.kind === 'moment' ? 'Save & close' : `Close ${tabs.length}`}</button></div>
      </div>`;
    }).join('')}</div>`;
    body.onclick = async (e) => {
      const item = e.target.closest('.tidy-item');
      const act = e.target.closest('[data-t]')?.dataset.t;
      if (!item || !act) return;
      const s = suggestions[Number(item.dataset.i)];
      if (act === 'review') {
        this.view = 'search';
        this.query = '';
        this.input.value = '';
        this.checked = new Set(s.tabIds);
        this.render();
        return;
      }
      if (s.kind === 'moment') {
        const name = s.host.split('.').slice(-2, -1)[0] || s.host;
        await this.b.saveMoment({ name: name[0].toUpperCase() + name.slice(1), tabIds: s.tabIds, closeAfter: true });
      } else {
        this.b.closeTabs(s.tabIds, `${s.id === 'duplicates' ? 'Closed duplicates' : 'Closed old tabs'} (${s.tabIds.length})`);
      }
      this.render();
    };
  }

  toggleCheck(i) {
    const id = this.rows[i]?.t.id;
    if (!id) return;
    if (this.checked.has(id)) this.checked.delete(id);
    else this.checked.add(id);
    this.cursor = i;
    this.render();
  }

  choose(i) {
    const r = this.rows[i];
    if (!r) return;
    this.close();
    this.b.activate(r.t.id);
    this.app.focusContent();
  }

  closeIds(ids) {
    this.checked.clear();
    this.b.closeTabs(ids);
    if (!this.b.tabs.length) this.close();
    else this.render();
  }

  onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.rows.length;
      if (!n) return;
      this.cursor = (this.cursor + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      if (e.shiftKey) { this.checked.add(this.rows[this.cursor].t.id); this.render(); return; }
      this.paintCursor(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.rows.length && this.view === 'search') this.choose(this.cursor);
      else if (this.query.trim()) { this.close(); this.b.navigate(this.query, { newTab: true }); }
    } else if (e.key === ' ' && (this.checked.size || !this.query)) {
      e.preventDefault();
      this.toggleCheck(this.cursor);
    } else if (e.key === 'Backspace' && mod) {
      e.preventDefault();
      const ids = this.checked.size ? [...this.checked] : [this.rows[this.cursor]?.t.id].filter(Boolean);
      this.closeIds(ids);
    } else if (e.key === 'a' && mod && !this.input.value) {
      e.preventDefault();
      this.checked = new Set(this.rows.map((r) => r.t.id));
      this.render();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.view = this.view === 'search' ? 'tidy' : 'search';
      this.render();
    }
  }
}

function safePath(url) {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '' : u.pathname;
  } catch {
    return '';
  }
}
