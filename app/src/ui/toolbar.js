// Toolbar row (navigation, address field, tools), plus the two optional
// strip rows: find in page and the split-view pane bar.

import { $, esc, favicon, h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { displayParts, hostOf, isInternal } from '../core/url.js';

export class Toolbar {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.root = $('#toolbar');
    this.build();
    this.b.subscribe((what) => this.update(what));
  }

  build() {
    this.root.innerHTML = `
      <div class="toolbar-group">
        <button class="ibtn" data-act="back" data-tip="Back" data-keys="alt+left" aria-label="Back">${icon('back')}</button>
        <button class="ibtn" data-act="forward" data-tip="Forward" data-keys="alt+right" aria-label="Forward">${icon('forward')}</button>
        <button class="ibtn" data-act="reload" data-tip="Reload" data-keys="mod+r" aria-label="Reload">${icon('reload')}</button>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="omnibox" id="omnibox">
        <button class="site-btn" data-act="site" aria-label="Site information"></button>
        <span class="mode-chip" hidden>${icon('command')}Actions</span>
        <div class="omni-field">
          <input class="omni-input" id="address" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Address and search" placeholder="Search or enter address">
          <div class="omni-display" aria-hidden="true"></div>
        </div>
        <div class="omni-actions">
          <button class="zoom-chip" data-act="zoomReset" data-tip="Reset zoom" hidden></button>
          <button class="ibtn" data-act="bookmark" data-tip="Bookmark this page" data-keys="mod+d" aria-label="Bookmark">${icon('star')}</button>
        </div>
        <div class="progress"><i></i></div>
      </div>
      <div class="toolbar-group tools">
        <span class="notice-slot"></span>
        <button class="ibtn" data-act="split" data-tip="Split view" data-keys="mod+\\" aria-label="Split view">${icon('split')}</button>
        <button class="ibtn" data-act="moments" data-tip="Moments" aria-label="Moments">${icon('moments')}</button>
        <button class="ibtn" data-act="downloads" data-tip="Downloads" data-keys="mod+j" aria-label="Downloads" hidden>${icon('download')}<svg class="dl-ring" viewBox="0 0 22 22"><circle class="track" cx="11" cy="11" r="10"/><circle class="bar" cx="11" cy="11" r="10" stroke-dasharray="62.8" stroke-dashoffset="62.8" transform="rotate(-90 11 11)"/></svg></button>
        <button class="ibtn" data-act="menu" data-tip="Menu" aria-label="Menu">${icon('more')}</button>
      </div>`;
    this.input = $('#address');
    this.box = $('#omnibox');
    this.display = $('.omni-display', this.root);
    this.site = $('.site-btn', this.root);

    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const b = this.b;
      switch (btn.dataset.act) {
        case 'back': b.goBack(); break;
        case 'forward': b.goForward(); break;
        case 'reload': b.focused?.loading ? b.stop() : b.reload(undefined, e.shiftKey); break;
        case 'bookmark': b.toggleBookmark(); break;
        case 'zoomReset': b.zoom(0); break;
        case 'split': this.app.toggleSplit(); break;
        case 'moments': this.app.moments.toggle(btn); break;
        case 'downloads': this.app.panels.downloads(btn); break;
        case 'menu': this.app.panels.mainMenu(btn); break;
        case 'site': this.app.panels.siteInfo(btn); break;
      }
    });
    // Find bar and pane bar live inside #chrome so they push content down.
    this.findRow = h('div', { class: 'findbar', hidden: true });
    this.paneRow = h('div', { class: 'panebar', hidden: true });
    $('#chrome').append(this.findRow, this.paneRow);
    this.buildFind();
  }

  update(what) {
    const b = this.b;
    const t = b.focused;
    const all = what.has('all');
    if (all || what.has('tabs') || what.has('active') || what.has('bookmarks') || what.has('split')) {
      const internal = !t || isInternal(t.url);
      this.btn('back').classList.toggle('is-disabled', !(t?.canBack || (internal && t?.backUrl)));
      this.btn('forward').classList.toggle('is-disabled', !t?.canForward);
      const reload = this.btn('reload');
      reload.classList.toggle('is-disabled', internal);
      reload.innerHTML = icon(t?.loading ? 'stop' : 'reload');
      reload.dataset.tip = t?.loading ? 'Stop' : 'Reload';
      const bm = this.btn('bookmark');
      bm.hidden = internal;
      const marked = !internal && b.isBookmarked(t.url);
      bm.innerHTML = icon(marked ? 'starFill' : 'star');
      bm.classList.toggle('is-on', marked);
      bm.dataset.tip = marked ? 'Remove bookmark' : 'Bookmark this page';
      const zoom = this.btn('zoomReset');
      zoom.hidden = internal || !t.zoom || t.zoom === 100;
      zoom.textContent = `${t?.zoom || 100}%`;
      this.btn('split').classList.toggle('is-on', b.isSplitVisible);
      this.renderSite(t);
      if (!this.app.omnibox?.editing) this.renderDisplay(t);
      const p = $('.progress', this.root);
      p.classList.toggle('is-on', !!t?.loading);
      p.style.setProperty('--p', String(t?.loading ? Math.max(0.08, t.progress || 0) : 1));
    }
    if (all || what.has('downloads')) this.renderDownloads();
    if (all || what.has('notice')) this.renderNotice();
    if (all || what.has('find') || what.has('active')) this.renderFind();
    if (all || what.has('split') || what.has('tabs') || what.has('active') || what.has('layout')) this.renderPanes();
  }

  btn(act) { return this.root.querySelector(`[data-act="${act}"]`); }

  renderSite(t) {
    const s = this.site;
    s.className = 'site-btn';
    if (!t || isInternal(t.url)) {
      s.innerHTML = t?.url?.startsWith('sift://newtab') || !t ? icon('search') : icon('sift');
      s.dataset.tip = '';
      return;
    }
    if (t.certError) {
      s.classList.add('is-danger');
      s.innerHTML = `${icon('warning')}<span>Not secure</span>`;
    } else if (!t.secure && /^http:/.test(t.url)) {
      s.classList.add('is-insecure');
      s.innerHTML = `${icon('unlock')}<span>Not secure</span>`;
    } else {
      s.innerHTML = `${icon(this.b.settings.trackers ? 'shieldCheck' : 'lock')}${t.blocked ? `<span class="count">${t.blocked}</span>` : ''}`;
    }
    s.dataset.tip = t.blocked ? `${t.blocked} tracking requests blocked on this page` : 'Site information';
  }

  /** The resting address: host emphasised, path quiet; a search shows its query. */
  renderDisplay(t) {
    const input = this.input;
    if (!t || isInternal(t.url)) {
      input.value = t && !t.url.startsWith('sift://newtab') ? t.url : '';
      this.display.innerHTML = '';
      input.classList.remove('has-display');
      input.placeholder = this.b.info?.incognito ? 'Search privately or enter address' : `Search ${this.b.engine.name} or enter address`;
      return;
    }
    const q = this.b.displayQuery(t);
    if (q) {
      input.value = q;
      this.display.innerHTML = `<span class="query">${esc(q)}</span><span class="engine">— ${esc(this.b.engine.name)}</span>`;
    } else {
      input.value = t.url;
      const p = displayParts(t.url);
      this.display.innerHTML = `<span class="host">${esc(p.host)}</span><span class="rest">${esc(p.rest)}</span>`;
    }
    input.classList.add('has-display');
  }

  renderDownloads() {
    const d = this.b.downloads;
    const btn = this.btn('downloads');
    btn.hidden = !d.length;
    const active = d.filter((x) => x.state === 'progress');
    const ring = btn.querySelector('.dl-ring');
    ring.style.display = active.length ? '' : 'none';
    if (active.length) {
      const total = active.reduce((s, x) => s + (x.total || 0), 0);
      const got = active.reduce((s, x) => s + (x.received || 0), 0);
      const pct = total ? got / total : 0.1;
      ring.querySelector('.bar').setAttribute('stroke-dashoffset', String(62.8 * (1 - pct)));
    }
  }

  renderNotice() {
    const slot = $('.notice-slot', this.root);
    const n = this.b.notice;
    const current = slot.firstElementChild;
    if (!n) {
      if (current) { current.classList.add('is-leaving'); setTimeout(() => current.remove(), 160); }
      return;
    }
    if (current?._at === n.at) return;
    const el = h('div', { class: 'notice', role: 'status', html: `${icon(n.icon || 'check')}<span>${esc(n.text)}</span>` });
    el._at = n.at;
    if (n.action) {
      el.append(h('button', { onclick: () => { this.b.dismissNotice(); n.run?.(); } }, n.action));
    }
    slot.replaceChildren(el);
  }

  // ---- find -----------------------------------------------------------

  buildFind() {
    this.findRow.innerHTML = `
      <div class="field">${icon('find')}<input placeholder="Find in page" spellcheck="false" aria-label="Find in page"><span class="count"></span></div>
      <button class="ibtn sm" data-f="prev" data-tip="Previous" aria-label="Previous match">${icon('chevronUp')}</button>
      <button class="ibtn sm" data-f="next" data-tip="Next" aria-label="Next match">${icon('chevronDown')}</button>
      <button class="ibtn sm" data-f="close" data-tip="Close" aria-label="Close find">${icon('close')}</button>`;
    const input = $('input', this.findRow);
    input.addEventListener('input', () => this.b.findText(input.value, { next: false }));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.b.findText(input.value, { next: true, backward: e.shiftKey }); }
      if (e.key === 'Escape') { e.preventDefault(); this.b.closeFind(); }
    });
    this.findRow.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]')?.dataset.f;
      if (f === 'close') this.b.closeFind();
      if (f === 'next' || f === 'prev') this.b.findText(input.value, { next: true, backward: f === 'prev' });
    });
  }

  renderFind() {
    const f = this.b.find;
    const wasHidden = this.findRow.hidden;
    this.findRow.hidden = !f;
    if (wasHidden !== this.findRow.hidden) this.b.layout();
    if (!f) return;
    const input = $('input', this.findRow);
    if (input.value !== f.query) input.value = f.query;
    const count = $('.count', this.findRow);
    count.textContent = f.query ? (f.count ? `${Math.max(1, f.active)}/${f.count}` : 'No matches') : '';
    count.classList.toggle('is-none', !!f.query && !f.count);
  }

  focusFind() {
    const input = $('input', this.findRow);
    input.focus();
    input.select();
  }

  // ---- split pane bar -------------------------------------------------

  renderPanes() {
    const b = this.b;
    const show = b.isSplitVisible && !b.fullscreen;
    const wasHidden = this.paneRow.hidden;
    this.paneRow.hidden = !show;
    if (wasHidden !== this.paneRow.hidden) requestAnimationFrame(() => b.layout());
    if (!show) return;
    const [l, r] = b.paneRects();
    if (this.gripDragging) {
      // Keep the grip element alive while it holds pointer capture.
      const segs = this.paneRow.querySelectorAll('.pane-seg');
      segs[0].style.width = `${l.w - 8}px`;
      segs[1].style.width = `${r.w - 8}px`;
      $('.pane-grip', this.paneRow).style.left = `${l.w + 3}px`;
      return;
    }
    const seg = (side, rect) => {
      const t = b.tab(side === 'left' ? b.split.left : b.split.right);
      const focused = b.split.focus === side;
      return `<div class="pane-seg ${focused ? 'is-focused' : ''}" data-side="${side}" style="width:${rect.w - 8}px">
        ${favicon(t.url, t.favicon, { internalIcon: icon('sift') })}
        <span class="label">${esc(t.title || hostOf(t.url) || 'New Tab')}</span>
        <span class="host">${esc(isInternal(t.url) ? '' : hostOf(t.url))}</span>
        <span class="spacer"></span>
        ${side === 'right' ? `<button class="ibtn sm" data-p="swap" data-tip="Swap sides" aria-label="Swap sides">${icon('swap')}</button>` : ''}
        <button class="ibtn sm" data-p="close" data-tip="${side === 'left' ? 'Keep only the right side' : 'Keep only the left side'}" aria-label="Close this side">${icon('close')}</button>
      </div>`;
    };
    this.paneRow.innerHTML = `${seg('left', l)}<div style="width:${6 - 8 + 8}px"></div>${seg('right', r)}<div class="pane-grip" style="left:${l.w + 3}px" data-tip="Drag to resize · double-click to even out"><i></i></div>`;
    this.paneRow.onclick = (e) => {
      const segEl = e.target.closest('.pane-seg');
      const p = e.target.closest('[data-p]')?.dataset.p;
      if (p === 'swap') return b.swapSplit();
      if (p === 'close' && segEl) return b.exitSplit(segEl.dataset.side === 'left' ? b.split.right : b.split.left);
      if (segEl) b.focusPane(segEl.dataset.side);
    };
    const grip = $('.pane-grip', this.paneRow);
    grip.ondblclick = () => b.setSplitRatio(0.5);
    grip.onpointerdown = (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('is-dragging');
      this.gripDragging = true;
      let raf = 0;
      grip.onpointermove = (ev) => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => b.setSplitRatio(ev.clientX / window.innerWidth));
      };
      grip.onpointerup = () => {
        grip.onpointermove = null;
        grip.classList.remove('is-dragging');
        this.gripDragging = false;
        b.saveSession();
        this.renderPanes();
      };
    };
  }
}

/** The main "⋯" menu. */
export function mainMenuItems(app) {
  const b = app.browser;
  const t = b.focused;
  const web = t && !isInternal(t.url);
  const zoomRow = h('div', { class: 'menu-zoom', html: `<span class="label">${icon('zoomIn')}Zoom</span>` });
  const out = h('button', { class: 'ibtn sm', 'aria-label': 'Zoom out', html: icon('minimize') });
  const val = h('span', { class: 'val' }, `${t?.zoom || 100}%`);
  const inn = h('button', { class: 'ibtn sm', 'aria-label': 'Zoom in', html: icon('plus') });
  out.onclick = async () => { await b.zoom(-1); val.textContent = `${b.focused?.zoom || 100}%`; };
  inn.onclick = async () => { await b.zoom(1); val.textContent = `${b.focused?.zoom || 100}%`; };
  zoomRow.append(out, val, inn);
  if (!web) zoomRow.style.opacity = '0.4';
  return [
    { label: 'New Tab', icon: 'plus', hint: 'mod+t', run: () => b.newTab() },
    { label: 'New Window', icon: 'window', hint: 'mod+n', run: () => b.bridge.send('window.new', {}) },
    { label: 'New Private Window', icon: 'eyeOff', hint: 'mod+shift+n', run: () => b.bridge.send('window.new', { incognito: true }) },
    '-',
    { label: 'Moments', icon: 'moments', run: () => b.newTab('sift://moments') },
    { label: 'History', icon: 'history', hint: 'mod+y', run: () => app.openInternal('sift://history') },
    { label: 'Bookmarks', icon: 'bookmark', run: () => app.openInternal('sift://bookmarks') },
    { label: 'Downloads', icon: 'download', hint: 'mod+j', run: () => app.openInternal('sift://downloads') },
    '-',
    { custom: zoomRow },
    { label: 'Find in Page…', icon: 'find', hint: 'mod+f', disabled: !web, run: () => app.find() },
    { label: 'Print…', icon: 'print', hint: 'mod+p', disabled: !web, run: () => b.bridge.send('tab.print', { id: t.id }) },
    { label: 'Developer Tools', icon: 'code', hint: 'mod+shift+i', disabled: !web, run: () => b.bridge.send('tab.devtools', { id: t.id }) },
    '-',
    { label: 'Settings', icon: 'sliders', hint: 'mod+,', run: () => app.openInternal('sift://settings') },
    { label: 'Keyboard Shortcuts', icon: 'keyboard', run: () => app.openInternal('sift://settings/shortcuts') },
  ];
}

export { openMenu };
