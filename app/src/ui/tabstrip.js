// The tab row: pinned tabs, the scrolling tab strip, new-tab button, the tab
// counter (opens tab search) and window controls.
//
// Rendering is keyed by tab id so 100 tabs update cheaply. Dragging a tab
// reorders it; dragging it down into the page offers "side by side" drop
// zones. Hovering shows a preview card after a short delay.

import { $, esc, favicon, h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { hostOf, isInternal } from '../core/url.js';
import { ago } from '../core/time.js';

const MIN_TAB = 92;
const MAX_TAB = 220;
const NARROW = 64;

export class TabStrip {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.root = $('#tabrow');
    this.els = new Map();
    this.build();
    this.b.subscribe((what) => {
      if (what.has('tabs') || what.has('active') || what.has('all') || what.has('split') || what.has('layout') || what.has('thumbs')) this.render();
    });
    window.addEventListener('resize', () => this.render());
  }

  build() {
    const mac = document.documentElement.dataset.platform === 'mac';
    this.root.innerHTML = `
      ${this.b.info?.incognito ? `<div class="private-pill" data-tip="Private window: history, cookies and site data are kept in memory and erased when the window closes.">${icon('eyeOff')}Private</div>` : ''}
      <div id="pinned"></div>
      <div class="tabs-wrap"><div class="tabs-scroll"><div id="tabs" role="tablist"></div></div></div>
      <button class="ibtn tabrow-btn" data-act="newTab" data-tip="New tab" data-keys="mod+t" aria-label="New tab">${icon('plus')}</button>
      <div class="drag-fill"></div>
      <button class="tab-count" data-act="tabSearch" data-tip="Search tabs" data-keys="mod+shift+a" aria-label="Search tabs"><span class="n"></span>${icon('search')}</button>
      ${mac ? '' : `<div class="winctl">
        <button data-act="min" aria-label="Minimize">${icon('minimize')}</button>
        <button data-act="max" aria-label="Maximize">${icon('maximize')}</button>
        <button class="close" data-act="close" aria-label="Close window">${icon('close')}</button>
      </div>`}`;
    this.pinnedEl = $('#pinned', this.root);
    this.tabsEl = $('#tabs', this.root);
    this.wrap = $('.tabs-wrap', this.root);
    this.scroller = $('.tabs-scroll', this.root);

    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'newTab') { this.b.newTab(); this.app.omnibox.focus(); }
      else if (act === 'tabSearch') this.app.tabSearch.open();
      else if (act === 'min') this.b.bridge.send('window.minimize');
      else if (act === 'max') this.b.bridge.send('window.maximize');
      else if (act === 'close') this.app.closeWindow();
    });
    this.root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.drag-fill') || e.target === this.tabsEl) this.b.newTab();
    });
    this.scroller.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this.scroller.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    this.scroller.addEventListener('scroll', () => this.updateFades());
  }

  tabEl(tab) {
    let el = this.els.get(tab.id);
    if (!el) {
      el = h('div', { class: 'tab is-new', role: 'tab', dataset: { id: tab.id } });
      el.innerHTML = `<span class="tab-favicon"></span><span class="split-glyph">${icon('split')}</span><span class="tab-title"></span><span class="tab-indicators"></span><button class="tab-close" aria-label="Close tab" tabindex="-1">${icon('close')}</button>`;
      el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
      this.bindTab(el);
      this.els.set(tab.id, el);
    }
    return el;
  }

  render() {
    const b = this.b;
    const live = new Set(b.tabs.map((t) => t.id));
    let changing = false;
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      // Closed tabs collapse away while their neighbours slide over.
      this.els.delete(id);
      changing = true;
      if (el.parentNode && !el.classList.contains('is-closing')) {
        el.classList.add('is-closing');
        setTimeout(() => el.remove(), 210);
      } else if (!el.classList.contains('is-closing')) el.remove();
    }

    const pinned = b.pinnedTabs;
    const regular = b.regularTabs;
    // Width: share the space, clamp, and scroll beyond the minimum.
    const avail = this.availableWidth(pinned.length);
    const w = Math.max(MIN_TAB, Math.min(MAX_TAB, Math.floor(avail / Math.max(1, regular.length)) - 1));
    const narrow = w < NARROW;

    for (const t of b.tabs) if (!this.els.has(t.id)) changing = true;
    this.place(this.pinnedEl, pinned);
    this.place(this.tabsEl, regular);
    const split = b.split;
    const focusedId = b.focusedId;
    for (const t of b.tabs) {
      const el = this.els.get(t.id);
      el.style.setProperty('--w', `${w}px`);
      const inSplit = !!split && (t.id === split.left || t.id === split.right);
      el.className = [
        'tab', el.classList.contains('is-new') && 'is-new', t.pinned && 'is-pinned', narrow && 'is-narrow',
        (t.id === b.activeId || (inSplit && b.isSplitVisible)) && 'is-active', t.loading && 'is-loading',
        t.discarded && 'is-discarded', inSplit && 'in-split', inSplit && (t.id === split.left ? 'split-left' : 'split-right'),
        inSplit && b.isSplitVisible && t.id === focusedId && 'is-focused-pane', t.pinned && t.unread && 'has-update',
      ].filter(Boolean).join(' ');
      el.setAttribute('aria-selected', String(t.id === b.activeId));
      const fav = favicon(t.url, t.favicon, { internalIcon: icon('sift') }) + (t.loading ? '<i class="tab-spinner"></i>' : '');
      if (el._fav !== fav) { el.querySelector('.tab-favicon').innerHTML = fav; el._fav = fav; }
      const title = t.title || (t.loading ? 'Loading…' : hostOf(t.url) || 'Untitled');
      if (el._title !== title) { el.querySelector('.tab-title').textContent = title; el._title = title; }
      const ind = [
        t.camera || t.microphone ? `<span class="is-live" title="Using your ${t.camera ? 'camera' : 'microphone'}">${icon(t.camera ? 'camera' : 'mic')}</span>` : '',
        t.muted ? `<span title="Muted">${icon('mute')}</span>` : '',
        t.crashed ? `<span title="This page crashed">${icon('warning')}</span>` : '',
      ].join('');
      if (el._ind !== ind) { el.querySelector('.tab-indicators').innerHTML = ind; el._ind = ind; }
    }
    $('.tab-count .n', this.root).textContent = String(b.tabs.length);
    this.updateFades();
    this.revealActive();
    this.movePill(changing);
  }

  /** Slide the active-tab surface to the active tab. While tabs are opening or
   * closing it follows their animated layout frame by frame. */
  movePill(follow) {
    if (!this.pill) {
      this.pill = h('div', { class: 'tab-pill is-instant' });
      this.tabsEl.prepend(this.pill);
    }
    const b = this.b;
    const target = () => {
      const el = this.els.get(b.activeId);
      if (!el || el.parentNode !== this.tabsEl || el.classList.contains('in-split')) return null;
      return el;
    };
    const apply = (instant) => {
      const el = target();
      this.pill.style.opacity = el ? '1' : '0';
      if (!el) return;
      this.pill.classList.toggle('is-instant', instant);
      this.pill.style.transform = `translateX(${el.offsetLeft}px)`;
      this.pill.style.width = `${el.offsetWidth}px`;
    };
    cancelAnimationFrame(this.pillFrame);
    if (!follow) {
      apply(!this.pillPlaced);
      this.pillPlaced = true;
      return;
    }
    const start = performance.now();
    const step = () => {
      apply(true);
      const t = performance.now() - start;
      const animating = this.tabsEl.querySelector('.tab.is-new, .tab.is-closing');
      if (t < 1500 && (t < 320 || animating)) this.pillFrame = requestAnimationFrame(step);
    };
    step();
  }

  place(container, tabs) {
    // Keep the DOM order equal to the tab order, skipping the pill and tabs
    // that are animating closed.
    const skip = (n) => {
      while (n && (n === this.pill || n.classList?.contains('is-closing'))) n = n.nextSibling;
      return n;
    };
    let prev = null;
    for (const t of tabs) {
      const el = this.tabEl(t);
      const want = skip(prev ? prev.nextSibling : container.firstChild);
      if (el.parentNode !== container || want !== el) container.insertBefore(el, want);
      prev = el;
    }
  }

  availableWidth(pinnedCount) {
    const total = this.root.clientWidth;
    const fixed = 8 + pinnedCount * 36 + 34 + 70 + 24 + (document.documentElement.dataset.platform === 'mac' ? 80 : 120) + 8;
    return Math.max(200, total - fixed);
  }

  updateFades() {
    const s = this.scroller;
    this.wrap.classList.toggle('fade-l', s.scrollLeft > 2);
    this.wrap.classList.toggle('fade-r', s.scrollLeft + s.clientWidth < s.scrollWidth - 2);
  }

  revealActive() {
    const el = this.els.get(this.b.activeId);
    if (!el || el.parentNode !== this.tabsEl) return;
    const s = this.scroller;
    const l = el.offsetLeft;
    const r = l + el.offsetWidth;
    if (l < s.scrollLeft + 16) s.scrollLeft = l - 24;
    else if (r > s.scrollLeft + s.clientWidth - 16) s.scrollLeft = r - s.clientWidth + 24;
  }

  // ---- interaction --------------------------------------------------------

  bindTab(el) {
    const id = () => el.dataset.id;
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1) { e.preventDefault(); return; }
      if (e.button !== 0 || e.target.closest('.tab-close')) return;
      this.app.preview.hide(true);
      this.b.activate(id());
      this.startDrag(e, el);
    });
    el.addEventListener('auxclick', (e) => { if (e.button === 1) this.b.closeTab(id()); });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.preview.hide(true);
      this.b.closeTab(id());
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.app.preview.hide(true);
      this.contextMenu(id(), e.clientX, e.clientY);
    });
    el.addEventListener('pointerenter', () => { if (!this.drag) this.app.preview.hover(id(), el); });
    el.addEventListener('pointerleave', () => this.app.preview.leave());
  }

  contextMenu(tabId, x, y) {
    const b = this.b;
    const t = b.tab(tabId);
    if (!t) return;
    const inSplit = b.split && (b.split.left === tabId || b.split.right === tabId);
    const others = b.tabs.filter((o) => o.id !== tabId && !o.pinned);
    const toRight = b.tabs.slice(b.tabs.indexOf(t) + 1).filter((o) => !o.pinned);
    openMenu(this.app, [
      { label: 'New Tab to the Right', icon: 'plus', run: () => { const n = b.newTab(undefined, { background: true }); b.moveTab(n.id, b.tabs.indexOf(t) + 1); b.activate(n.id); } },
      '-',
      inSplit
        ? { label: 'Exit Split View', icon: 'split', run: () => b.exitSplit(tabId) }
        : { label: tabId === b.activeId ? 'Open Side by Side with New Tab' : 'Open Side by Side', icon: 'split', hint: tabId === b.activeId ? 'mod+\\' : undefined,
            run: () => (tabId === b.activeId ? b.splitWithNew() : b.openSplit(b.activeId, tabId)) },
      { label: t.pinned ? 'Unpin Tab' : 'Pin Tab', icon: t.pinned ? 'unpin' : 'pin', run: () => b.setPinned(tabId, !t.pinned) },
      { label: 'Duplicate', icon: 'copy', run: () => b.duplicate(tabId) },
      { label: t.muted ? 'Unmute Site' : 'Mute Site', icon: t.muted ? 'volume' : 'mute', disabled: isInternal(t.url), run: () => b.setMuted(tabId, !t.muted) },
      { label: 'Reload', icon: 'reload', disabled: isInternal(t.url), run: () => b.reload(tabId) },
      { label: 'Copy Link', icon: 'link', disabled: isInternal(t.url), run: () => navigator.clipboard?.writeText(t.url) },
      { label: 'Save Tabs as Moment…', icon: 'momentSave', run: () => this.app.moments.openSave({ preselect: [tabId] }) },
      '-',
      { label: 'Close Tab', icon: 'close', hint: 'mod+w', run: () => b.closeTab(tabId) },
      { label: 'Close Other Tabs', icon: 'tabs', disabled: !others.length, run: () => this.app.confirmClose(others.map((o) => o.id)) },
      { label: 'Close Tabs to the Right', icon: 'arrowRight', disabled: !toRight.length, run: () => this.app.confirmClose(toRight.map((o) => o.id)) },
    ], { x, y });
  }

  startDrag(e, el) {
    const startX = e.clientX;
    const startY = e.clientY;
    const tabId = el.dataset.id;
    const tab = this.b.tab(tabId);
    const container = el.parentNode;
    const grabOffset = startX - el.getBoundingClientRect().left;
    let moved = false;
    let ghost = null;
    let zones = null;
    let hot = null;
    const chromeBottom = $('#chrome').getBoundingClientRect().bottom;
    // Listen on the window: growing the UI surface during the drag cancels
    // pointer capture on the tab element.

    const siblings = () => [...container.children].filter((c) => c !== el);
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) {
        moved = true;
        this.drag = true;
        el.classList.add('is-dragging');
        if (this.pill) this.pill.style.opacity = '0';
        this.app.preview.hide(true);
      }
      const below = ev.clientY > chromeBottom + 24 && !tab.pinned && this.b.tabs.length > 1;
      if (below) {
        // Drag into the page: show side-by-side drop zones.
        el.style.transform = '';
        if (!ghost) {
          ghost = h('div', { class: 'drag-ghost', html: `${favicon(tab.url, tab.favicon)}<span>${esc(tab.title || hostOf(tab.url))}</span>` });
          zones = h('div', { class: 'dropzones', html: `<div class="dropzone" data-side="left"><div>${icon('split')}Left side</div></div><div class="dropzone" data-side="right"><div>${icon('split')}Right side</div></div>` });
          Object.assign(zones.style, { left: '0px', right: '0px', top: `${chromeBottom}px`, bottom: '0px' });
          $('#layer').append(zones, ghost);
          this.app.dragging = true;
          this.app.layer.updateSurface();
        }
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 10}px`;
        hot = ev.clientX < window.innerWidth / 2 ? 'left' : 'right';
        for (const z of zones.children) z.classList.toggle('is-hot', z.dataset.side === hot);
        return;
      }
      if (ghost) { ghost.remove(); zones.remove(); ghost = zones = null; hot = null; this.app.dragging = false; this.app.layer.updateSurface(); }
      // Reorder: the tab follows the pointer; siblings reflow around it.
      el.style.transform = '';
      const width = el.offsetWidth;
      const targetLeft = ev.clientX - grabOffset;
      const center = targetLeft + width / 2;
      const before = siblings().find((sib) => {
        const r = sib.getBoundingClientRect();
        return r.left + r.width / 2 > center;
      });
      if (before) { if (el.nextSibling !== before) container.insertBefore(el, before); }
      else if (container.lastChild !== el) container.append(el);
      el.style.transform = `translateX(${targetLeft - el.getBoundingClientRect().left}px)`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('blur', onUp);
      el.classList.remove('is-dragging');
      el.style.transform = '';
      this.drag = false;
      requestAnimationFrame(() => this.movePill(false));
      if (ghost) {
        ghost.remove();
        zones.remove();
        this.app.dragging = false;
        // Put the dragged tab on the chosen side next to the previous tab.
        const other = this.b.tabs.filter((t) => t.id !== tabId && !t.pinned).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
        if (other && hot) this.b.openSplit(hot === 'left' ? tabId : other.id, hot === 'left' ? other.id : tabId);
        this.app.layer.updateSurface();
        return;
      }
      if (moved) {
        const order = [...this.pinnedEl.children, ...this.tabsEl.children].map((c) => c.dataset.id);
        this.b.moveTab(tabId, order.indexOf(tabId));
      }
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('blur', onUp);
  }
}

// ---------------------------------------------------------------------------

/** Hover previews: title, address, when you last looked, and a thumbnail when one exists. */
export class TabPreview {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.timer = 0;
    this.leaveTimer = 0;
    this.shownAt = 0;
    this.currentId = null;
    // Growing the UI surface makes Chromium send a synthetic leave (and drop
    // :hover), so the pointer position is tracked here instead.
    document.addEventListener('pointermove', (e) => {
      if (Date.now() < this.settleUntil) return;
      this.px = e.clientX;
      this.py = e.clientY;
      if (this.currentId && !this.pointerOnAnchor()) this.leave();
    }, true);
  }

  pointerOnAnchor() {
    if (!this.anchorEl?.isConnected || this.px === undefined) return false;
    const r = this.anchorEl.getBoundingClientRect();
    return this.px >= r.left && this.px <= r.right && this.py >= r.top && this.py <= r.bottom;
  }

  hover(tabId, el) {
    if (!this.b.settings.previews) return;
    clearTimeout(this.leaveTimer);
    clearTimeout(this.timer);
    const warm = Date.now() - this.shownAt < 700 || this.currentId;
    this.timer = setTimeout(() => this.show(tabId, el, warm), warm ? 40 : 520);
  }

  leave() {
    if (Date.now() < this.settleUntil) return;
    clearTimeout(this.timer);
    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => {
      if (this.pointerOnAnchor()) return;
      this.hide();
    }, 140);
  }

  show(tabId, el, instant) {
    const t = this.b.tab(tabId);
    if (!t || !el.isConnected || document.querySelector('#layer .pop:not(.preview)')) return;
    this.currentId = tabId;
    this.anchorEl = el;
    this.shownAt = Date.now();
    // The resize to the cover surface produces synthetic pointer events.
    this.settleUntil = Date.now() + 400;
    const internal = isInternal(t.url);
    const status = t.loading ? 'Loading' : t.discarded ? 'Sleeping' : tabId === this.b.activeId ? 'Current' : `Viewed ${ago(t.lastActive)}`;
    const shot = t.thumbnail
      ? `<div class="shot" style="background-image:url('${t.thumbnail}')"></div>`
      : `<div class="shot"><div class="big-favicon">${favicon(t.url, t.favicon, { internalIcon: icon('sift') })}</div></div>`;
    const card = h('div', { class: `preview${instant ? ' is-instant' : ''}`, html: `${shot}
      <div class="meta"><div class="title">${esc(t.title || hostOf(t.url))}</div>
      <div class="sub"><span class="host">${esc(internal ? t.url : hostOf(t.url))}</span><span class="sep">·</span><span>${esc(status)}</span></div></div>` });
    const r = el.getBoundingClientRect();
    card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 296))}px`;
    card.style.top = `${r.bottom + 8}px`;
    this.app.layer.open({ id: 'preview', el: card, dismissOnOutside: false });
  }

  hide(now) {
    clearTimeout(this.timer);
    clearTimeout(this.leaveTimer);
    if (!this.currentId) return;
    this.currentId = null;
    this.app.layer.close('preview', { silent: !!now, immediate: true });
    if (now) this.app.layer.updateSurface();
  }
}
