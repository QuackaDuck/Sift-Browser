// Sift UI entry point: builds the views, routes internal pages, and owns
// keyboard shortcuts (from the UI itself and forwarded by the host when a
// web page has focus).

import { createBridge } from './bridge.js';
import { Browser } from './browser.js';
import { Commands } from './commands.js';
import { Layer } from './ui/layer.js';
import { TabStrip, TabPreview } from './ui/tabstrip.js';
import { Toolbar } from './ui/toolbar.js';
import { Omnibox } from './ui/omnibox.js';
import { TabSearch } from './ui/tabsearch.js';
import { MomentsPanel } from './ui/moments-ui.js';
import { Panels } from './ui/panels.js';
import { renderNewTab } from './ui/newtab.js';
import { renderSettings, loadImportSources } from './ui/settings.js';
import { renderLibrary } from './ui/library.js';
import { confirmDialog, installTooltips } from './ui/menu.js';
import { $, isMac, primary } from './ui/dom.js';
import { isInternal } from './core/url.js';

class App {
  constructor() {
    this.browser = new Browser(createBridge());
    this.dragging = false;
    this.libraryState = {};
  }

  async start() {
    const b = this.browser;
    await b.init();
    this.layer = new Layer(this);
    this.commands = new Commands(this);
    this.preview = new TabPreview(this);
    this.tabStrip = new TabStrip(this);
    this.toolbar = new Toolbar(this);
    this.omnibox = new Omnibox(this);
    this.tabSearch = new TabSearch(this);
    this.moments = new MomentsPanel(this);
    this.panels = new Panels(this);
    installTooltips(document);

    b.subscribe((what) => this.onChange(what));
    b.bridge.on('shortcut', ({ name }) => this.shortcut(name));
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('resize', () => b.layout());
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => b.applySettings('theme'));
    b.subscribe((what) => { if (what.has('ui:saveMoment')) this.moments.openSave(); });

    this.tabStrip.render();
    this.toolbar.update(new Set(['all']));
    this.renderPage(true);
    b.layout();
    if (b.active?.url === 'sift://newtab') this.omnibox.focus();
  }

  onChange(what) {
    const b = this.browser;
    const url = b.active?.url || '';
    const pageKey = b.isSplitVisible ? '' : url;
    if (pageKey !== this.pageKey || what.has('all')) return this.renderPage(true);
    if (!isInternal(url)) return;
    const relevant = ['settings', 'history', 'bookmarks', 'moments', 'downloads', 'permissions', 'profiles'];
    if (relevant.some((k) => what.has(k))) this.renderPage(false);
  }

  /** Render Sift's own page for the active tab, or clear it for web content. */
  renderPage(navigated) {
    const b = this.browser;
    const page = $('#page');
    const tab = b.active;
    const url = tab && !b.isSplitVisible && isInternal(tab.url) ? tab.url : '';
    this.pageKey = url;
    this.layer.updateSurface();
    if (!url) { page.replaceChildren(); return; }
    // Don't rebuild under the user's fingers.
    if (!navigated && page.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const [, name, sub] = url.match(/^sift:\/\/([^/?#]*)\/?([^?#]*)/) || [];
    const scroll = navigated ? 0 : page.scrollTop;
    // Entrance animations play when you arrive, not on every data refresh.
    page.classList.toggle('no-entrance', !navigated);
    if (name === 'newtab') renderNewTab(this, page);
    else if (name === 'settings') {
      renderSettings(this, page, sub || 'appearance');
      if (sub === 'import') loadImportSources(this, page);
    } else if (['history', 'bookmarks', 'downloads', 'moments'].includes(name)) {
      if (navigated) this.libraryState = {};
      renderLibrary(this, page, name, this.libraryState);
    } else {
      page.innerHTML = `<div class="ntp"><div class="ntp-top"></div><div class="empty-note">Sift has no page called “${name}”.</div></div>`;
    }
    page.scrollTop = scroll;
    document.title = tab.title || 'Sift';
  }

  openInternal(url) {
    const b = this.browser;
    const existing = b.tabs.find((t) => t.url.split('/')[2] === url.split('/')[2] && isInternal(t.url));
    if (existing) {
      b.activate(existing.id);
      if (existing.url !== url) b.navigate(url, { tabId: existing.id });
    } else if (b.active?.url === 'sift://newtab') b.navigate(url);
    else b.newTab(url, { afterId: b.activeId });
  }

  focusContent() {
    const b = this.browser;
    const t = b.focused;
    if (t && !isInternal(t.url)) b.bridge.send('tab.focus', { id: t.id });
  }

  find() {
    if (this.browser.openFind()) requestAnimationFrame(() => { this.browser.bridge.send('ui.focus'); this.toolbar.focusFind(); });
  }

  toggleSplit() {
    const b = this.browser;
    if (b.isSplitVisible) return b.exitSplit();
    if (b.split) return b.activate(b.split.focus === 'left' ? b.split.left : b.split.right);
    // Pair with the most recently used other tab, or a new tab if there isn't one.
    const other = b.tabs.filter((t) => t.id !== b.activeId && !t.pinned).sort((x, y) => (y.lastActive || 0) - (x.lastActive || 0))[0];
    if (other) b.openSplit(b.activeId, other.id);
    else { b.splitWithNew(); this.omnibox.focus(); }
  }

  closeActive() {
    const b = this.browser;
    if (b.find) return b.closeFind();
    if (b.focused) b.closeTab(b.focusedId);
  }

  async confirmClose(ids) {
    const b = this.browser;
    if (ids.length > 5 && b.settings.confirmCloseMany) {
      const ok = await confirmDialog(this, { title: `Close ${ids.length} tabs?`, body: 'You can bring them back with Undo, or from Recently Closed in the address bar.', confirm: `Close ${ids.length} tabs` });
      if (!ok) return;
    }
    b.closeTabs(ids);
  }

  async closeWindow() {
    const b = this.browser;
    const n = b.tabs.filter((t) => !isInternal(t.url)).length;
    if (n > 5 && b.settings.confirmCloseMany && (b.info?.incognito || b.settings.startup !== 'restore')) {
      const ok = await confirmDialog(this, { title: `Close window with ${n} tabs?`, body: b.info?.incognito ? 'Private windows aren’t saved. These tabs will be gone.' : 'These tabs won’t be reopened next time (Sift is set to start with a new tab).', confirm: 'Close window' });
      if (!ok) return;
    }
    b.saveSession.flush();
    b.bridge.send('window.close');
  }

  // ---- keyboard ---------------------------------------------------------

  onKey(e) {
    // On the New Tab page, typing anywhere goes to the address bar.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !this.layer.isOpen
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && this.browser.active?.url === 'sift://newtab') {
      this.omnibox.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (this.layer.escape()) { e.preventDefault(); e.stopPropagation(); return; }
      if (this.browser.find) { this.browser.closeFind(); e.preventDefault(); }
      return;
    }
    const name = keyName(e);
    if (!name) return;
    // Let text fields keep their editing keys.
    const editing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if (editing && ['zoomIn', 'zoomOut', 'zoomReset'].includes(name)) return;
    e.preventDefault();
    e.stopPropagation();
    this.shortcut(name);
  }

  shortcut(name) {
    const b = this.browser;
    const tabN = /^tab(\d)$/.exec(name);
    if (tabN) {
      const n = Number(tabN[1]);
      const t = n === 9 ? b.tabs[b.tabs.length - 1] : b.tabs[n - 1];
      if (t) b.activate(t.id);
      return;
    }
    const step = (d) => {
      const i = b.tabs.findIndex((t) => t.id === b.activeId);
      const t = b.tabs[(i + d + b.tabs.length) % b.tabs.length];
      if (t) b.activate(t.id);
    };
    switch (name) {
      case 'focusAddress': this.layer.closeAll(); this.omnibox.focus(); break;
      case 'command': this.layer.closeAll(); this.omnibox.focus({ command: true }); break;
      case 'newTab': this.layer.closeAll(); b.newTab(); requestAnimationFrame(() => this.omnibox.focus()); break;
      case 'closeTab': this.layer.isOpen ? this.layer.escape() : this.closeActive(); break;
      case 'closeWindow': this.closeWindow(); break;
      case 'reopenTab': b.reopenClosed(); break;
      case 'tabSearch': this.layer.closeAll(); this.tabSearch.toggle(); break;
      case 'saveMoment': this.layer.closeAll(); this.moments.openSave(); break;
      case 'split': this.toggleSplit(); break;
      case 'newWindow': b.bridge.send('window.new', {}); break;
      case 'privateWindow': b.bridge.send('window.new', { incognito: true }); break;
      case 'bookmark': b.toggleBookmark(); break;
      case 'find': this.find(); break;
      case 'findNext': case 'findPrev': if (b.find) b.findText(b.find.query, { next: true, backward: name === 'findPrev' }); else this.find(); break;
      case 'reload': b.reload(); break;
      case 'hardReload': b.reload(undefined, true); break;
      case 'back': b.goBack(); break;
      case 'forward': b.goForward(); break;
      case 'nextTab': step(1); break;
      case 'prevTab': step(-1); break;
      case 'zoomIn': b.zoom(1); break;
      case 'zoomOut': b.zoom(-1); break;
      case 'zoomReset': b.zoom(0); break;
      case 'downloads': this.openInternal('sift://downloads'); break;
      case 'history': this.openInternal('sift://history'); break;
      case 'settings': this.openInternal('sift://settings'); break;
      case 'print': this.commands.run('print'); break;
      case 'devtools': this.commands.run('devtools'); break;
      case 'viewSource': this.commands.run('viewSource'); break;
      case 'toggleFullscreen': b.bridge.send('window.fullscreen'); break;
    }
  }
}

/** Map a keydown in the UI to the same shortcut names the host forwards. */
function keyName(e) {
  const mod = primary(e);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.key === 'F5') return e.shiftKey ? 'hardReload' : 'reload';
  if (e.key === 'F11') return 'toggleFullscreen';
  if (e.key === 'F12') return 'devtools';
  if (e.ctrlKey && e.key === 'Tab') return e.shiftKey ? 'prevTab' : 'nextTab';
  if (e.altKey && !mod && e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') return 'back';
  if (e.altKey && !mod && e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') return 'forward';
  if (!mod || e.altKey) return '';
  if (/^[1-9]$/.test(k) && !e.shiftKey) return `tab${k}`;
  const map = {
    l: 'focusAddress', k: 'command', t: e.shiftKey ? 'reopenTab' : 'newTab', w: e.shiftKey ? 'closeWindow' : 'closeTab',
    n: e.shiftKey ? 'privateWindow' : 'newWindow', d: 'bookmark', f: 'find', g: e.shiftKey ? 'findPrev' : 'findNext',
    r: e.shiftKey ? 'hardReload' : 'reload', j: 'downloads', y: 'history', p: 'print', u: 'viewSource',
    '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoomReset', '[': 'back', ']': 'forward', ',': 'settings', '\\': 'split',
  };
  if (e.shiftKey && k === 'a') return 'tabSearch';
  if (e.shiftKey && k === 's') return 'saveMoment';
  if (e.shiftKey && k === 'i') return 'devtools';
  if (!isMac() && e.key === 'h') return 'history';
  return map[k] || '';
}

const app = new App();
window.sift = app;
app.start().catch((err) => {
  console.error('[sift] failed to start', err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:8px;left:8px;color:#ef8b80;font:12px monospace">${String(err?.stack || err)}</pre>`);
});
