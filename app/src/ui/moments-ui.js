// The Moments panel: browse, restore, rename and delete saved sets of tabs,
// and the "Save Moment" sheet. Opened from the toolbar, Cmd/Ctrl+Shift+S,
// the command list, tab search, or a tab's context menu.

import { $, esc, favicon, h, keycaps } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { suggestName } from '../core/moments.js';
import { ago } from '../core/time.js';
import { hostOf, isInternal } from '../core/url.js';

export class MomentsPanel {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.b.subscribe((what) => {
      if (what.has('moments') && this.el && this.mode === 'list') this.renderList();
    });
  }

  anchor() { return $('#toolbar [data-act="moments"]'); }

  toggle(anchor) {
    if (this.app.layer.find('moments')) this.app.layer.close('moments');
    else this.open(anchor);
  }

  open(anchor = this.anchor()) {
    this.mode = 'list';
    this.cursor = 0;
    this.el = h('div', { class: 'pop moments from-right', role: 'dialog', 'aria-label': 'Moments', tabindex: '-1' });
    this.app.layer.open({ id: 'moments', el: this.el, anchor, onClose: () => { this.el = null; } });
    this.place(anchor);
    this.renderList();
    this.b.bridge.send('ui.focus');
    this.el.focus();
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  place(anchor) {
    const r = (anchor || this.anchor()).getBoundingClientRect();
    this.el.style.left = `${Math.max(8, Math.min(r.right - 380, window.innerWidth - 388))}px`;
    this.el.style.top = `${r.bottom + 8}px`;
  }

  renderList() {
    const list = this.b.moments;
    const saveable = this.b.regularTabs.filter((t) => !isInternal(t.url)).length;
    this.el.innerHTML = `
      <div class="moments-head">
        <div><h2>Moments</h2><p>Saved sets of tabs you can come back to.</p></div>
        <button class="btn primary" data-a="save" ${saveable ? '' : 'disabled'}>${icon('momentSave')}Save tabs</button>
      </div>
      ${list.length ? `<div class="moments-list" role="listbox">${list.map((m, i) => `
        <div class="moment ${i === this.cursor ? 'is-active' : ''}" data-id="${m.id}" data-i="${i}" role="option">
          <span class="stack">${m.tabs.slice(0, 3).map((t) => `<span>${favicon(t.url, t.favicon)}</span>`).join('')}</span>
          <div class="info"><div class="name">${esc(m.name)}</div>
            <div class="meta">${m.tabs.length} ${m.tabs.length === 1 ? 'page' : 'pages'} · ${esc(siteSummary(m))} · ${esc(ago(Math.max(m.updatedAt, m.openedAt || 0)))}</div></div>
          <div class="acts">
            <button class="ibtn sm" data-a="restore" data-tip="Open these tabs" aria-label="Open">${icon('arrowUpRight')}</button>
            <button class="ibtn sm" data-a="more" aria-label="More">${icon('more')}</button>
          </div>
        </div>`).join('')}</div>`
      : `<div class="moments-empty"><b>No Moments yet</b>Working on something you'll come back to, like a trip, an assignment or a redesign? Save its tabs as a Moment, close them, and reopen the whole set later. ${keycaps('mod+shift+s')}</div>`}`;
    this.el.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const row = e.target.closest('.moment');
      if (a === 'save') return this.renderSave({});
      if (!row) return;
      const id = row.dataset.id;
      if (a === 'more') return this.more(id, e.target.closest('[data-a]'));
      if (row.querySelector('input')) return;
      this.app.layer.close('moments', { reason: 'choose' });
      this.b.restoreMoment(id);
    };
    this.el.ondblclick = (e) => {
      const row = e.target.closest('.moment');
      if (row && e.target.closest('.name')) this.rename(row.dataset.id);
    };
  }

  more(id, anchor) {
    const m = this.b.moments.find((x) => x.id === id);
    openMenu(this.app, [
      { label: 'Open', icon: 'arrowUpRight', run: () => { this.app.layer.close('moments'); this.b.restoreMoment(id); } },
      { label: 'Open in New Window', icon: 'window', run: () => { this.app.layer.close('moments'); this.b.restoreMoment(id, { newWindow: true }); } },
      '-',
      { label: 'Rename', icon: 'pencil', run: () => this.rename(id) },
      { label: `Replace with Current Tabs`, icon: 'reload', run: () => this.b.updateMoment(id) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: () => this.b.deleteMoment(id) },
    ], { anchor, align: 'right' }, { id: 'moment-menu' });
    void m;
  }

  rename(id) {
    const row = this.el?.querySelector(`.moment[data-id="${id}"] .name`);
    if (!row) return;
    const m = this.b.moments.find((x) => x.id === id);
    const input = h('input', { value: m.name, 'aria-label': 'Moment name', spellcheck: 'false' });
    row.replaceChildren(input);
    input.focus();
    input.select();
    const commit = (save) => {
      if (save) this.b.renameMoment(id, input.value);
      this.renderList();
      this.el?.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true), { once: true });
  }

  /** Save sheet. preselect: tab ids to tick; only: offer just those tabs. */
  openSave(opts = {}) {
    if (!this.app.layer.find('moments')) this.open();
    this.renderSave(opts);
  }

  renderSave({ preselect, only }) {
    this.mode = 'save';
    const b = this.b;
    let candidates = b.tabs.filter((t) => !isInternal(t.url));
    if (only && preselect) candidates = candidates.filter((t) => preselect.includes(t.id));
    const picked = new Set(preselect?.length ? preselect : candidates.filter((t) => !t.pinned).map((t) => t.id));
    const suggested = suggestName(candidates.filter((t) => picked.has(t.id)), b.active);
    let closeAfter = true;
    this.el.innerHTML = `
      <div class="moments-head"><div><h2>Save a Moment</h2><p>Saves these pages and their order. Nothing leaves this device.</p></div></div>
      <div class="sheet">
        <label class="field-label" for="moment-name">Name</label>
        <input class="text-input" id="moment-name" value="${esc(suggested)}" spellcheck="false">
        <div class="pick-list">${candidates.map((t) => `
          <div class="pick ${picked.has(t.id) ? '' : 'is-off'}" data-id="${t.id}">
            <span class="checkbox ${picked.has(t.id) ? 'is-on' : ''}">${icon('check')}</span>
            ${favicon(t.url, t.favicon)}<span class="t">${esc(t.title || hostOf(t.url))}</span>
          </div>`).join('')}</div>
        <div class="sheet-foot">
          <div class="toggle-line" data-a="closeAfter"><span class="checkbox is-on">${icon('check')}</span>Close these tabs after saving</div>
          <span class="grow"></span>
          <button class="btn ghost" data-a="cancel">Cancel</button>
          <button class="btn primary" data-a="confirm">Save</button>
        </div>
      </div>`;
    const name = this.el.querySelector('#moment-name');
    const confirm = this.el.querySelector('[data-a="confirm"]');
    const sync = () => {
      confirm.textContent = picked.size ? `Save ${picked.size} ${picked.size === 1 ? 'tab' : 'tabs'}` : 'Save';
      confirm.disabled = !picked.size || !name.value.trim();
    };
    sync();
    name.addEventListener('input', sync);
    name.focus();
    name.select();
    const save = async () => {
      if (confirm.disabled) return;
      const ids = candidates.filter((t) => picked.has(t.id)).map((t) => t.id);
      this.app.layer.close('moments', { reason: 'choose' });
      await b.saveMoment({ name: name.value, tabIds: ids, closeAfter });
    };
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.mode = 'list'; this.renderList(); this.el.focus(); }
    });
    this.el.onclick = (e) => {
      const pick = e.target.closest('.pick');
      if (pick) {
        const id = pick.dataset.id;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        pick.classList.toggle('is-off', !picked.has(id));
        pick.querySelector('.checkbox').classList.toggle('is-on', picked.has(id));
        sync();
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'closeAfter') {
        closeAfter = !closeAfter;
        e.target.closest('[data-a]').querySelector('.checkbox').classList.toggle('is-on', closeAfter);
      }
      if (a === 'cancel') { this.mode = 'list'; this.renderList(); }
      if (a === 'confirm') save();
    };
  }

  onKey(e) {
    if (this.mode !== 'list' || e.target.tagName === 'INPUT') return;
    const n = this.b.moments.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault();
      this.cursor = (this.cursor + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.el.querySelectorAll('.moment').forEach((r, i) => r.classList.toggle('is-active', i === this.cursor));
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      const id = this.b.moments[this.cursor].id;
      this.app.layer.close('moments', { reason: 'choose' });
      this.b.restoreMoment(id);
    } else if (e.key === 'F2' && n) {
      this.rename(this.b.moments[this.cursor].id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && n) {
      this.b.deleteMoment(this.b.moments[this.cursor].id);
    }
  }
}

function siteSummary(m) {
  const hosts = [...new Set(m.tabs.map((t) => hostOf(t.url)).filter(Boolean))];
  if (hosts.length <= 2) return hosts.join(', ');
  return `${hosts.slice(0, 2).join(', ')} +${hosts.length - 2}`;
}
