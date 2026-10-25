// Sift's browser controller: the single source of truth for a window's
// tabs and the profile's history, bookmarks, Moments and settings. Views
// subscribe to changes; every mutation goes through a method here.

import { canonicalUrl, classifyInput, hostOf, isInternal, queryFromSearchUrl, SEARCH_ENGINES, searchUrl } from './core/url.js';
import { createMoment, deleteMoment, markOpened, renameMoment, restoreDeleted, snapshotTab, updateMomentTabs } from './core/moments.js';
import { debounce } from './ui/dom.js';

const MAX_HISTORY = 6000;
const MAX_CLOSED = 30;
const SPLIT_GAP = 6;

export const DEFAULT_SETTINGS = {
  theme: 'dark',              // dark | light | system
  density: 'compact',         // compact | comfortable
  engine: 'duckduckgo',
  suggestions: false,         // remote search suggestions send keystrokes to the engine: opt-in
  trackers: true,
  thirdPartyCookies: 'block', // block | allow
  doNotTrack: false,
  startup: 'restore',         // restore | newtab
  previews: true,
  sleepTabs: 0,               // minutes; 0 = never
  confirmCloseMany: true,
  ntpBackground: 'grain',     // plain | grain | tint
  ntpFrequent: true,
  ntpMoments: true,
  showWelcome: true,
  hiddenTiles: [],
};

let tabSeq = 0;

export class Browser {
  constructor(bridge) {
    this.bridge = bridge;
    this.listeners = new Set();
    this.info = null;
    this.tabs = [];
    this.activeId = null;
    this.split = null;            // { left, right, ratio, focus: 'left' | 'right' }
    this.closed = [];
    this.history = [];
    this.bookmarks = [];
    this.moments = [];
    this.downloads = [];
    this.sitePerms = {};          // origin -> { kind: 'allow' | 'deny' }
    this.profiles = [{ id: 'Default', name: 'Personal' }];
    this.settings = { ...DEFAULT_SETTINGS };
    this.find = null;             // { query, count, active }
    this.fullscreen = false;
    this.chromeHeight = 0;
    this.pendingPermissions = [];
    this.notice = null;

    this.saveSession = debounce(() => this.persistSession(), 500);
    this.saveHistory = debounce(() => this.write('history', this.history), 1500);
    this.thumbTimers = new Map();
  }

  // ---- subscription ------------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(...what) {
    if (!this._pending) {
      this._pending = new Set();
      queueMicrotask(() => {
        const set = this._pending;
        this._pending = null;
        for (const fn of this.listeners) fn(set);
      });
    }
    for (const w of what) this._pending.add(w);
  }

  // ---- startup -----------------------------------------------------------

  async init() {
    this.info = await this.bridge.send('ready');
    if (this.info.height) this.windowHeight = this.info.height;
    const html = document.documentElement;
    html.dataset.platform = this.info.platform;
    html.dataset.private = String(!!this.info.incognito);
    if (!this.bridge.native) html.dataset.preview = 'true';

    const [settings, history, bookmarks, moments, closed, perms, profiles, session] = await Promise.all([
      this.read('settings'), this.read('history'), this.read('bookmarks'), this.read('moments'),
      this.read('closed'), this.read('permissions'), this.read('profiles', 'app'),
      this.read(`session-${this.info.windowId}`),
    ]);
    this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    this.history = Array.isArray(history) ? history : [];
    this.bookmarks = Array.isArray(bookmarks) ? bookmarks : [];
    this.moments = Array.isArray(moments) ? moments : [];
    this.closed = Array.isArray(closed) ? closed : [];
    this.sitePerms = perms || {};
    if (Array.isArray(profiles) && profiles.length) this.profiles = profiles;
    this.applySettings();

    this.wireHost();

    const urls = this.info.openUrls || [];
    const restore = !this.info.incognito && this.settings.startup === 'restore' && session?.tabs?.length;
    if (restore) this.restoreSession(session);
    for (const url of urls) this.newTab(url);
    if (!this.tabs.length) this.newTab();
    this.changed('all');
  }

  async read(key, scope) {
    try {
      const raw = await this.bridge.send('store.read', { key, scope });
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn(`[sift] could not read ${key}`, err);
      return null;
    }
  }

  write(key, value, scope) {
    return this.bridge.send('store.write', { key, scope, value: JSON.stringify(value) }).catch((err) => {
      console.warn(`[sift] could not save ${key}`, err);
    });
  }

  /** Re-read profile data another window may have changed. */
  async refreshShared() {
    const [bookmarks, moments, settings] = await Promise.all([this.read('bookmarks'), this.read('moments'), this.read('settings')]);
    if (Array.isArray(bookmarks)) this.bookmarks = bookmarks;
    if (Array.isArray(moments)) this.moments = moments;
    if (settings) { this.settings = { ...DEFAULT_SETTINGS, ...settings }; this.applySettings(); }
    this.changed('bookmarks', 'moments', 'settings');
  }

  restoreSession(session) {
    // Restored tabs stay unloaded until shown: fast startup, low memory.
    const idMap = new Map();
    for (const t of session.tabs) {
      const id = this.nextId();
      idMap.set(t.id, id);
      this.tabs.push({ ...this.blankTab(id, t.url), title: t.title, favicon: t.favicon, pinned: !!t.pinned, lastActive: t.lastActive || 0, createdAt: t.createdAt || t.lastActive || Date.now(), discarded: !isInternal(t.url), scroll: t.scroll });
      if (!isInternal(t.url)) this.bridge.send('tab.create', { id, url: t.url, lazy: true, scroll: t.scroll || -1 });
    }
    this.activeId = idMap.get(session.activeId) || this.tabs[this.tabs.length - 1]?.id;
    if (session.split && idMap.get(session.split.left) && idMap.get(session.split.right)) {
      this.split = { ...session.split, left: idMap.get(session.split.left), right: idMap.get(session.split.right) };
    }
    // Whatever is visible loads now.
    for (const id of this.visibleIds()) { const t = this.tab(id); if (t) t.discarded = false; }
    this.layout();
  }

  persistSession() {
    if (this.info?.incognito) return;
    const tabs = this.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon && t.favicon.length < 12000 ? t.favicon : null, pinned: t.pinned, lastActive: t.lastActive, createdAt: t.createdAt }));
    this.write(`session-${this.info.windowId}`, { tabs, activeId: this.activeId, split: this.split, savedAt: Date.now() });
  }

  // ---- settings ----------------------------------------------------------

  setSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    this.write('settings', this.settings);
    this.applySettings(key);
    this.changed('settings');
  }

  get engine() {
    return SEARCH_ENGINES.find((e) => e.id === this.settings.engine) || SEARCH_ENGINES[0];
  }

  applySettings(key) {
    const s = this.settings;
    const html = document.documentElement;
    const dark = s.theme === 'system' ? !window.matchMedia('(prefers-color-scheme: light)').matches : s.theme !== 'light';
    html.dataset.theme = dark ? 'dark' : 'light';
    html.dataset.density = s.density;
    if (!this.bridge.native) return;
    if (!key || key === 'trackers') this.bridge.send('trackers.enabled', { enabled: !!s.trackers });
    if (!key || key === 'thirdPartyCookies') {
      this.bridge.send('pref.set', { name: 'profile.cookie_controls_mode', value: s.thirdPartyCookies === 'block' ? 1 : 0 }).catch(() => {});
    }
    if (!key || key === 'doNotTrack') {
      this.bridge.send('pref.set', { name: 'enable_do_not_track', value: !!s.doNotTrack }).catch(() => {});
    }
    if (key === 'density') this.layout();
  }

  // ---- tabs --------------------------------------------------------------

  nextId() { return `t${Date.now().toString(36)}${(tabSeq++).toString(36)}`; }

  blankTab(id, url) {
    return {
      id, url, title: '', favicon: null, loading: false, progress: 0, canBack: false, canForward: false,
      pinned: false, lastActive: Date.now(), createdAt: Date.now(), secure: false, blocked: 0, blockedDomains: [],
      zoom: 100, discarded: false, thumbnail: null, error: null, crashed: false, muted: false, backUrl: null,
    };
  }

  get active() { return this.tab(this.activeId); }
  tab(id) { return this.tabs.find((t) => t.id === id); }
  get pinnedTabs() { return this.tabs.filter((t) => t.pinned); }
  get regularTabs() { return this.tabs.filter((t) => !t.pinned); }

  /** The tab the address bar and toolbar act on: the focused pane in split view. */
  get focusedId() {
    if (this.split && (this.activeId === this.split.left || this.activeId === this.split.right)) {
      return this.split.focus === 'right' ? this.split.right : this.split.left;
    }
    return this.activeId;
  }
  get focused() { return this.tab(this.focusedId); }

  newTab(input, opts = {}) {
    const url = input ? this.resolveInput(input) : 'sift://newtab';
    const id = opts.id || this.nextId();
    const tab = { ...this.blankTab(id, url), ...(opts.extra || {}) };
    if (opts.title) tab.title = opts.title;
    if (opts.favicon) tab.favicon = opts.favicon;
    if (isInternal(url)) tab.title = internalTitle(url);
    else if (!opts.adopted) this.bridge.send('tab.create', { id, url, lazy: !!opts.background, scroll: opts.scroll ?? -1 });
    if (opts.background) tab.discarded = false;

    let index = this.tabs.length;
    if (opts.afterId) {
      const after = this.tabs.findIndex((t) => t.id === opts.afterId);
      if (after >= 0) {
        // Open next to the opener, after any siblings it already opened.
        index = after + 1;
        while (index < this.tabs.length && this.tabs[index].openerId === opts.afterId) index++;
        tab.openerId = opts.afterId;
      }
    }
    if (opts.pinned) { tab.pinned = true; index = this.pinnedTabs.length; }
    this.tabs.splice(index, 0, tab);
    if (!opts.background) this.activate(id);
    else this.changed('tabs');
    this.saveSession();
    return tab;
  }

  resolveInput(input) {
    const c = classifyInput(input);
    if (c.type === 'search') return searchUrl(this.engine, c.query);
    return c.url;
  }

  activate(id) {
    const tab = this.tab(id);
    if (!tab) return;
    if (this.split && id !== this.split.left && id !== this.split.right) {
      // Leaving the split pair keeps it intact; coming back restores it.
    }
    if (this.split && (id === this.split.left || id === this.split.right)) this.split.focus = id === this.split.left ? 'left' : 'right';
    const prev = this.active;
    if (prev && prev.id !== id) prev.lastActive = Date.now();
    this.activeId = id;
    tab.lastActive = Date.now();
    tab.discarded = false;
    tab.unread = false;
    this.find = null;
    this.layout();
    this.changed('tabs', 'active');
    this.saveSession();
    if (!isInternal(tab.url)) this.bridge.send('tab.focus', { id: this.focusedId });
    this.scheduleSleep();
  }

  closeTab(id, opts = {}) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tab = this.tabs[index];
    if (!opts.noRecord && !isInternal(tab.url) && !this.info.incognito) {
      this.closed.unshift({ url: tab.url, title: tab.title, favicon: tab.favicon, pinned: tab.pinned, index, closedAt: Date.now() });
      this.closed = this.closed.slice(0, MAX_CLOSED);
      this.write('closed', this.closed);
    }
    this.tabs.splice(index, 1);
    if (!isInternal(tab.url)) this.bridge.send('tab.close', { id });
    if (this.split && (this.split.left === id || this.split.right === id)) {
      const other = this.split.left === id ? this.split.right : this.split.left;
      this.split = null;
      if (this.activeId === id) this.activeId = other;
    }
    if (this.activeId === id) {
      // Prefer the opener, then the tab to the right, then to the left.
      const next = this.tab(tab.openerId) || this.tabs[index] || this.tabs[index - 1];
      this.activeId = next?.id ?? null;
    }
    if (!this.tabs.length && !opts.keepWindowOpen) {
      if (this.bridge.native) {
        this.bridge.send('window.close');
        return;
      }
      this.newTab();
      return;
    }
    if (this.activeId) this.activate(this.activeId);
    this.changed('tabs');
    this.saveSession();
  }

  /** Close several tabs with one undo. */
  closeTabs(ids, label) {
    const set = new Set(ids);
    const snapshot = this.tabs.filter((t) => set.has(t.id)).map((t) => ({ ...t, index: this.tabs.indexOf(t) }));
    if (!snapshot.length) return;
    const keepOpen = snapshot.length === this.tabs.length;
    for (const t of snapshot) this.closeTab(t.id, { keepWindowOpen: keepOpen });
    if (!this.tabs.length) this.newTab();
    this.showNotice({
      text: label || `Closed ${snapshot.length} ${snapshot.length === 1 ? 'tab' : 'tabs'}`,
      icon: 'tabs',
      action: 'Undo',
      run: () => {
        for (const t of snapshot.sort((a, b) => a.index - b.index)) {
          const tab = this.newTab(t.url, { background: true, title: t.title, favicon: t.favicon });
          tab.pinned = t.pinned;
          this.tabs.splice(this.tabs.indexOf(tab), 1);
          this.tabs.splice(Math.min(t.index, this.tabs.length), 0, tab);
          this.closed = this.closed.filter((c) => c.url !== t.url);
        }
        this.changed('tabs');
        this.saveSession();
      },
    });
  }

  reopenClosed(entry) {
    const c = entry || this.closed[0];
    if (!c) return;
    this.closed = this.closed.filter((x) => x !== c);
    this.write('closed', this.closed);
    const tab = this.newTab(c.url, { title: c.title, favicon: c.favicon, background: true });
    tab.pinned = !!c.pinned;
    const from = this.tabs.indexOf(tab);
    this.tabs.splice(from, 1);
    this.tabs.splice(Math.min(c.index ?? this.tabs.length, this.tabs.length), 0, tab);
    this.activate(tab.id);
  }

  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    // Pinned tabs stay ahead of regular tabs.
    const pinnedCount = this.pinnedTabs.length;
    const bounded = tab.pinned ? Math.min(toIndex, pinnedCount) : Math.max(toIndex, pinnedCount);
    this.tabs.splice(Math.max(0, Math.min(bounded, this.tabs.length)), 0, tab);
    this.changed('tabs');
    this.saveSession();
  }

  setPinned(id, pinned) {
    const tab = this.tab(id);
    if (!tab || tab.pinned === pinned) return;
    tab.pinned = pinned;
    this.moveTab(id, pinned ? this.pinnedTabs.length - 1 : this.pinnedTabs.length);
  }

  duplicate(id) {
    const tab = this.tab(id);
    if (tab) this.newTab(tab.url, { afterId: id, title: tab.title, favicon: tab.favicon });
  }

  setMuted(id, muted) {
    const tab = this.tab(id);
    if (!tab) return;
    tab.muted = muted;
    this.bridge.send('tab.mute', { id, muted });
    this.changed('tabs');
  }

  /** Unload a background tab; it reloads when shown. */
  discard(id) {
    const tab = this.tab(id);
    if (!tab || isInternal(tab.url) || this.visibleIds().includes(id)) return;
    tab.discarded = true;
    tab.loading = false;
    this.bridge.send('tab.discard', { id, url: tab.url });
    this.changed('tabs');
  }

  scheduleSleep() {
    clearTimeout(this.sleepTimer);
    const minutes = this.settings.sleepTabs;
    if (!minutes) return;
    this.sleepTimer = setTimeout(() => {
      const cutoff = Date.now() - minutes * 60e3;
      for (const t of this.tabs) if (!t.discarded && !t.pinned && t.lastActive < cutoff) this.discard(t.id);
    }, 60e3);
  }

  // ---- navigation --------------------------------------------------------

  navigate(input, opts = {}) {
    const id = opts.tabId || this.focusedId;
    const url = this.resolveInput(input);
    if (opts.newTab) return this.newTab(url, { afterId: this.activeId, background: opts.background });
    const tab = this.tab(id);
    if (!tab) return this.newTab(url);
    this.loadInTab(tab, url);
  }

  loadInTab(tab, url) {
    const wasInternal = isInternal(tab.url);
    const nowInternal = isInternal(url);
    if (nowInternal) {
      if (!wasInternal) {
        tab.backUrl = tab.url;
        this.bridge.send('tab.close', { id: tab.id });
      }
      Object.assign(tab, { url, title: internalTitle(url), favicon: null, loading: false, canBack: !!tab.backUrl, canForward: false, error: null });
    } else if (wasInternal) {
      tab.backUrl = null;
      Object.assign(tab, { url, title: '', favicon: null, loading: true, progress: 0.1, error: null, crashed: false });
      this.bridge.send('tab.create', { id: tab.id, url });
    } else {
      Object.assign(tab, { url, loading: true, progress: 0.1, error: null, crashed: false });
      this.bridge.send('tab.navigate', { id: tab.id, url });
    }
    tab.discarded = false;
    this.layout();
    this.changed('tabs', 'active');
    this.saveSession();
  }

  goBack(id = this.focusedId) {
    const tab = this.tab(id);
    if (!tab) return;
    if (isInternal(tab.url) && tab.backUrl) return this.loadInTab(tab, tab.backUrl);
    this.bridge.send('tab.back', { id });
  }
  goForward(id = this.focusedId) { this.bridge.send('tab.forward', { id }); }
  reload(id = this.focusedId, hard = false) {
    const tab = this.tab(id);
    if (!tab || isInternal(tab.url)) return;
    tab.crashed = false;
    tab.error = null;
    this.bridge.send('tab.reload', { id, hard });
  }
  stop(id = this.focusedId) { this.bridge.send('tab.stop', { id }); }

  async zoom(delta) {
    const tab = this.focused;
    if (!tab || isInternal(tab.url)) return;
    const z = await this.bridge.send('tab.zoom', { id: tab.id, delta });
    tab.zoom = Number(z) || 100;
    this.changed('tabs');
  }

  /** The text the address bar shows for a tab: a search query rather than a results URL. */
  displayQuery(tab) {
    if (!tab || isInternal(tab.url)) return null;
    return queryFromSearchUrl(SEARCH_ENGINES, tab.url);
  }

  // ---- split view --------------------------------------------------------

  openSplit(leftId, rightId) {
    if (!leftId || !rightId || leftId === rightId) return;
    for (const id of [leftId, rightId]) {
      const t = this.tab(id);
      if (t?.pinned) t.pinned = false;
    }
    // Place the pair next to each other in the strip.
    const li = this.tabs.findIndex((t) => t.id === leftId);
    const right = this.tabs.splice(this.tabs.findIndex((t) => t.id === rightId), 1)[0];
    this.tabs.splice(this.tabs.findIndex((t) => t.id === leftId) + 1, 0, right);
    void li;
    this.split = { left: leftId, right: rightId, ratio: 0.5, focus: 'right' };
    this.activate(rightId);
  }

  splitWithNew(side = 'right') {
    const current = this.activeId;
    const tab = this.newTab(undefined, { afterId: current, background: true });
    if (side === 'right') this.openSplit(current, tab.id);
    else this.openSplit(tab.id, current);
    return tab;
  }

  exitSplit(keep) {
    if (!this.split) return;
    const keepId = keep || this.focusedId;
    this.split = null;
    this.activate(keepId);
    this.changed('split');
  }

  swapSplit() {
    if (!this.split) return;
    const { left, right } = this.split;
    this.split = { ...this.split, left: right, right: left, focus: this.split.focus === 'left' ? 'right' : 'left', ratio: 1 - this.split.ratio };
    const li = this.tabs.findIndex((t) => t.id === left);
    const ri = this.tabs.findIndex((t) => t.id === right);
    [this.tabs[li], this.tabs[ri]] = [this.tabs[ri], this.tabs[li]];
    this.layout();
    this.changed('tabs', 'split');
    this.saveSession();
  }

  setSplitRatio(ratio) {
    if (!this.split) return;
    this.split.ratio = Math.max(0.2, Math.min(0.8, ratio));
    this.layout();
    this.changed('split');
  }

  focusPane(side) {
    if (!this.split) return;
    this.split.focus = side;
    this.activeId = side === 'left' ? this.split.left : this.split.right;
    this.bridge.send('tab.focus', { id: this.activeId });
    this.changed('active', 'split', 'tabs');
  }

  get isSplitVisible() {
    return !!this.split && (this.activeId === this.split.left || this.activeId === this.split.right);
  }

  visibleIds() {
    if (this.isSplitVisible) return [this.split.left, this.split.right];
    return this.activeId ? [this.activeId] : [];
  }

  /** Pane rectangles in window coordinates, matching the host's box layout. */
  paneRects() {
    const w = window.innerWidth;
    const top = this.chromeHeight;
    const h = Math.max(0, (this.windowHeight || window.innerHeight) - top);
    if (!this.isSplitVisible) return [{ id: this.activeId, x: 0, y: top, w, h }];
    const avail = w - SPLIT_GAP;
    const lw = Math.round(avail * this.split.ratio);
    return [
      { id: this.split.left, x: 0, y: top, w: lw, h },
      { id: this.split.right, x: lw + SPLIT_GAP, y: top, w: avail - lw, h },
    ];
  }

  /** Tell the host what to show: web panes for web tabs, nothing for internal pages. */
  layout() {
    const chrome = document.getElementById('chrome');
    if (chrome) this.chromeHeight = Math.round(chrome.getBoundingClientRect().height);
    const panes = this.visibleIds().filter((id) => {
      const t = this.tab(id);
      return t && !isInternal(t.url);
    });
    this.bridge.send('layout', { top: this.chromeHeight, panes, ratio: this.split?.ratio ?? 0.5 });
    this.changed('layout');
  }

  // ---- host events -------------------------------------------------------

  wireHost() {
    const b = this.bridge;
    b.on('tab.state', (d) => this.onTabState(d));
    b.on('tab.opened', (d) => {
      const opener = this.tab(d.openerId);
      this.newTab('about:blank', { id: d.id, afterId: d.openerId || this.activeId, background: d.background, adopted: true });
      const tab = this.tab(d.id);
      if (tab) { tab.url = ''; tab.loading = true; tab.discarded = false; }
      if (d.background && opener) this.changed('tabs');
    });
    b.on('tab.closed', ({ id }) => this.closeTab(id));
    b.on('tab.focused', ({ id }) => {
      if (this.split && (id === this.split.left || id === this.split.right)) this.focusPane(id === this.split.left ? 'left' : 'right');
    });
    b.on('download', (d) => this.onDownload(d));
    b.on('permission', (d) => this.onPermission(d));
    b.on('find', (d) => {
      if (!this.find) return;
      this.find = { ...this.find, count: d.count, active: d.active };
      this.changed('find');
    });
    b.on('fullscreen', ({ fullscreen }) => { this.fullscreen = fullscreen; this.changed('fullscreen'); });
    b.on('window.state', (d) => {
      if (d.height) this.windowHeight = d.height;
      if (d.active === true) this.refreshShared();
      if ('maximized' in d) this.maximized = d.maximized;
      this.changed('window');
    });
    b.on('internalNavigation', ({ url, tabId }) => {
      const tab = this.tab(tabId);
      if (tab) this.loadInTab(tab, url.replace(/^sift:\/*/i, 'sift://'));
    });
    b.on('contextAction', (d) => this.onContextAction(d));
  }

  onTabState(d) {
    const tab = this.tab(d.id);
    if (!tab) return;
    const prevUrl = tab.url;
    const { id, ...rest } = d;
    if (rest.url !== undefined && isInternal(tab.url) && !isInternal(rest.url)) tab.backUrl = null;
    Object.assign(tab, rest);
    if ('error' in d && d.error) tab.loading = false;
    if (d.url && d.url !== prevUrl) {
      tab.error = null;
      if (hostOf(d.url) !== hostOf(prevUrl)) tab.favicon = d.favicon || null;
      if (this.find) this.find = null;
    }
    // Sift sets tab.url optimistically when navigating, so compare against the
    // last URL recorded for this tab rather than the previous tab.url.
    if (d.url && d.url !== tab.recordedUrl) {
      tab.recordedUrl = d.url;
      this.recordVisit(tab);
    }
    if (d.title !== undefined) this.updateHistoryTitle(tab);
    if (d.favicon) this.updateHistoryFavicon(tab);
    if (d.loaded) {
      this.scheduleThumbnail(tab.id);
      if (!this.visibleIds().includes(tab.id)) tab.unread = true;
    }
    this.changed('tabs', ...(d.id === this.focusedId ? ['active'] : []));
    if (d.url || d.title) this.saveSession();
  }

  scheduleThumbnail(id) {
    clearTimeout(this.thumbTimers.get(id));
    this.thumbTimers.set(id, setTimeout(async () => {
      if (!this.visibleIds().includes(id)) return;
      const data = await this.bridge.send('thumbnail', { id, scale: 0.35 }).catch(() => null);
      const tab = this.tab(id);
      if (data && tab) { tab.thumbnail = data; tab.thumbAt = Date.now(); this.changed('thumbs'); }
    }, 900));
  }

  /** Snapshots taken for overlays double as fresh thumbnails. */
  adoptSnapshots(shots) {
    for (const s of shots || []) {
      const tab = this.tab(s.id);
      if (tab) { tab.thumbnail = s.data; tab.thumbAt = Date.now(); }
    }
  }

  onContextAction(d) {
    switch (d.action) {
      case 'openTab': this.newTab(d.url, { afterId: d.tabId, background: true }); break;
      case 'openSideBySide': {
        const tab = this.newTab(d.url, { afterId: d.tabId, background: true });
        this.openSplit(d.tabId, tab.id);
        break;
      }
      case 'search': this.newTab(searchUrl(this.engine, d.text), { afterId: d.tabId }); break;
      case 'saveMoment': this.emitUi('saveMoment'); break;
    }
  }

  emitUi(name, data) {
    for (const fn of this.listeners) fn(new Set([`ui:${name}`]), data);
  }

  // ---- history -----------------------------------------------------------

  recordVisit(tab) {
    if (this.info.incognito || !tab.url || isInternal(tab.url) || !/^https?:/.test(tab.url)) return;
    const now = Date.now();
    const key = canonicalUrl(tab.url);
    const existing = this.history.find((h) => canonicalUrl(h.url) === key);
    if (existing) {
      existing.visits = (existing.visits || 0) + 1;
      existing.lastVisit = now;
      existing.url = tab.url;
      this.history.splice(this.history.indexOf(existing), 1);
      this.history.unshift(existing);
    } else {
      this.history.unshift({ url: tab.url, title: tab.title || '', favicon: null, visits: 1, lastVisit: now, firstVisit: now });
      if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    }
    this.saveHistory();
    this.changed('history');
  }

  updateHistoryTitle(tab) {
    const entry = this.history[0];
    if (entry && entry.url === tab.url && tab.title) {
      entry.title = tab.title;
      this.saveHistory();
    }
  }

  updateHistoryFavicon(tab) {
    const host = hostOf(tab.url);
    let touched = false;
    for (const h of this.history.slice(0, 200)) {
      if (!h.favicon && hostOf(h.url) === host && tab.favicon.length < 12000) { h.favicon = tab.favicon; touched = true; }
    }
    for (const b of this.bookmarks) {
      if (!b.favicon && hostOf(b.url) === host && tab.favicon.length < 12000) { b.favicon = tab.favicon; touched = true; }
    }
    if (touched) { this.saveHistory(); this.write('bookmarks', this.bookmarks); }
  }

  deleteHistory(urls) {
    const set = new Set(urls);
    this.history = this.history.filter((h) => !set.has(h.url));
    this.saveHistory.flush();
    this.changed('history');
  }

  clearHistory(sinceMs = Infinity) {
    const cutoff = Date.now() - sinceMs;
    this.history = sinceMs === Infinity ? [] : this.history.filter((h) => h.lastVisit < cutoff);
    this.closed = [];
    this.write('closed', this.closed);
    this.saveHistory.flush();
    this.changed('history');
  }

  /** Frequently visited sites for the new tab page: one per host, by frecency. */
  topSites(n = 8) {
    const byHost = new Map();
    const hidden = new Set(this.settings.hiddenTiles || []);
    for (const h of this.history) {
      const host = hostOf(h.url);
      if (!host || hidden.has(host)) continue;
      const age = (Date.now() - h.lastVisit) / 86400e3;
      const score = (h.visits || 1) / (1 + age / 7);
      const cur = byHost.get(host);
      if (!cur) byHost.set(host, { host, url: h.url, title: h.title, favicon: h.favicon, score, root: new URL(h.url).pathname === '/' });
      else {
        cur.score += score;
        if (!cur.favicon && h.favicon) cur.favicon = h.favicon;
        if (new URL(h.url).pathname === '/' && !cur.root) { cur.url = h.url; cur.root = true; }
      }
    }
    return [...byHost.values()].sort((a, b) => b.score - a.score).slice(0, n);
  }

  // ---- bookmarks ---------------------------------------------------------

  isBookmarked(url) {
    const key = canonicalUrl(url || '');
    return this.bookmarks.some((b) => canonicalUrl(b.url) === key);
  }

  toggleBookmark(tab = this.focused) {
    if (!tab || isInternal(tab.url)) return;
    const key = canonicalUrl(tab.url);
    const existing = this.bookmarks.find((b) => canonicalUrl(b.url) === key);
    if (existing) {
      this.bookmarks = this.bookmarks.filter((b) => b !== existing);
      this.showNotice({ text: 'Bookmark removed', icon: 'bookmark', action: 'Undo', run: () => { this.bookmarks.unshift(existing); this.write('bookmarks', this.bookmarks); this.changed('bookmarks'); } });
    } else {
      this.bookmarks.unshift({ id: `b${Date.now().toString(36)}`, url: tab.url, title: tab.title || hostOf(tab.url), favicon: tab.favicon && tab.favicon.length < 12000 ? tab.favicon : null, folder: '', createdAt: Date.now() });
      this.showNotice({ text: 'Bookmarked', icon: 'bookmarkFill' });
    }
    this.write('bookmarks', this.bookmarks);
    this.changed('bookmarks');
  }

  addBookmarks(list, source) {
    const known = new Set(this.bookmarks.map((b) => canonicalUrl(b.url)));
    let added = 0;
    for (const b of list) {
      const key = canonicalUrl(b.url);
      if (known.has(key)) continue;
      known.add(key);
      this.bookmarks.push({ id: `b${Date.now().toString(36)}${added}`, url: b.url, title: b.title, folder: b.folder || source || '', favicon: null, createdAt: Date.now() });
      added++;
    }
    this.write('bookmarks', this.bookmarks);
    this.changed('bookmarks');
    return added;
  }

  updateBookmark(id, patch) {
    this.bookmarks = this.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    this.write('bookmarks', this.bookmarks);
    this.changed('bookmarks');
  }

  removeBookmark(id) {
    const index = this.bookmarks.findIndex((b) => b.id === id);
    if (index < 0) return;
    const [removed] = this.bookmarks.splice(index, 1);
    this.write('bookmarks', this.bookmarks);
    this.changed('bookmarks');
    this.showNotice({ text: 'Bookmark removed', icon: 'bookmark', action: 'Undo', run: () => { this.bookmarks.splice(index, 0, removed); this.write('bookmarks', this.bookmarks); this.changed('bookmarks'); } });
  }

  // ---- moments -----------------------------------------------------------

  async saveMoment({ name, tabIds, closeAfter }) {
    const tabs = this.tabs.filter((t) => tabIds.includes(t.id) && !isInternal(t.url));
    if (!tabs.length) return null;
    // Scroll positions are captured where the page is loaded (best effort).
    const snaps = await Promise.all(tabs.map(async (t) => {
      let scroll = null;
      if (!t.discarded) scroll = await this.bridge.send('tab.scroll', { id: t.id }).catch(() => null);
      return snapshotTab(t, { scroll: typeof scroll === 'number' && scroll > 0 ? scroll : null });
    }));
    const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === this.activeId));
    const split = this.split && tabIds.includes(this.split.left) && tabIds.includes(this.split.right)
      ? { left: tabs.findIndex((t) => t.id === this.split.left), right: tabs.findIndex((t) => t.id === this.split.right), ratio: this.split.ratio }
      : null;
    const { list, moment } = createMoment(this.moments, { name, tabs: snaps, activeIndex, split });
    this.moments = list;
    this.write('moments', this.moments);
    this.changed('moments');
    if (closeAfter) this.closeTabs(tabs.map((t) => t.id), `Saved “${moment.name}” and closed ${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'}`);
    else this.showNotice({ text: `Saved “${moment.name}”`, icon: 'moments' });
    return moment;
  }

  restoreMoment(id, opts = {}) {
    const moment = this.moments.find((m) => m.id === id);
    if (!moment) return;
    if (opts.newWindow) {
      this.bridge.send('window.new', { urls: moment.tabs.map((t) => t.url) });
    } else {
      // A lone new-tab page is replaced rather than left behind.
      const lone = this.tabs.length === 1 && this.tabs[0].url === 'sift://newtab' ? this.tabs[0] : null;
      const created = moment.tabs.map((t) => this.newTab(t.url, { background: true, title: t.title, favicon: t.favicon, scroll: t.scroll }));
      for (const [i, t] of moment.tabs.entries()) if (t.pinned) this.setPinned(created[i].id, true);
      if (lone) this.closeTab(lone.id, { noRecord: true, keepWindowOpen: true });
      if (moment.split && created[moment.split.left] && created[moment.split.right]) {
        this.openSplit(created[moment.split.left].id, created[moment.split.right].id);
        this.setSplitRatio(moment.split.ratio || 0.5);
      } else {
        this.activate(created[Math.min(moment.activeIndex || 0, created.length - 1)]?.id);
      }
    }
    this.moments = markOpened(this.moments, id);
    this.write('moments', this.moments);
    this.changed('moments');
  }

  renameMoment(id, name) {
    this.moments = renameMoment(this.moments, id, name);
    this.write('moments', this.moments);
    this.changed('moments');
  }

  updateMoment(id) {
    const tabs = this.regularTabs.filter((t) => !isInternal(t.url)).map((t) => snapshotTab(t));
    this.moments = updateMomentTabs(this.moments, id, tabs);
    this.write('moments', this.moments);
    this.changed('moments');
    const m = this.moments.find((x) => x.id === id);
    this.showNotice({ text: `Updated “${m.name}” with ${tabs.length} tabs`, icon: 'moments' });
  }

  deleteMoment(id) {
    const { list, removed, index } = deleteMoment(this.moments, id);
    if (!removed) return;
    this.moments = list;
    this.write('moments', this.moments);
    this.changed('moments');
    this.showNotice({
      text: `Deleted “${removed.name}”`, icon: 'trash', action: 'Undo',
      run: () => { this.moments = restoreDeleted(this.moments, removed, index); this.write('moments', this.moments); this.changed('moments'); },
    });
  }

  // ---- downloads ---------------------------------------------------------

  onDownload(d) {
    const i = this.downloads.findIndex((x) => x.id === d.id);
    const prev = this.downloads[i];
    if (i >= 0) this.downloads[i] = { ...prev, ...d };
    else this.downloads.unshift({ ...d, startedAt: Date.now() });
    if (d.state === 'complete' && prev?.state !== 'complete') {
      this.showNotice({ text: `Downloaded ${d.name}`, icon: 'download', action: 'Open', run: () => this.bridge.send('download.open', { path: d.path }) });
    }
    if (i < 0) {
      this.emitUi('downloadStarted');
      // A navigation that turned into a download leaves nothing to show:
      // close a tab that never displayed a page, else go back to its page.
      const tab = this.tab(d.tabId);
      if (tab && !tab.recordedUrl) {
        this.closeTab(tab.id, { noRecord: true, keepWindowOpen: true });
        if (!this.tabs.length) this.newTab();
      }
      else if (tab && tab.url !== tab.recordedUrl) Object.assign(tab, { url: tab.recordedUrl, loading: false });
      this.saveSession();
    }
    this.changed('downloads');
  }

  // ---- permissions -------------------------------------------------------

  onPermission(d) {
    const origin = d.origin.replace(/\/$/, '');
    const remembered = this.sitePerms[origin] || {};
    const decisions = d.kinds.map((k) => remembered[k]);
    if (decisions.length && decisions.every((x) => x === 'allow')) return this.respondPermission(d, 'allow', false);
    if (decisions.some((x) => x === 'deny')) return this.respondPermission(d, 'deny', false);
    this.pendingPermissions.push({ ...d, origin });
    this.emitUi('permission');
    this.changed('permissions');
  }

  respondPermission(prompt, result, remember = true) {
    this.bridge.send('permission.respond', { promptId: prompt.promptId, result });
    this.pendingPermissions = this.pendingPermissions.filter((p) => p.promptId !== prompt.promptId);
    if (remember && (result === 'allow' || result === 'deny')) {
      const origin = prompt.origin.replace(/\/$/, '');
      const entry = { ...(this.sitePerms[origin] || {}) };
      for (const k of prompt.kinds) entry[k] = result;
      this.sitePerms = { ...this.sitePerms, [origin]: entry };
      this.write('permissions', this.sitePerms);
    }
    this.changed('permissions');
  }

  forgetPermission(origin, kind) {
    const entry = { ...(this.sitePerms[origin] || {}) };
    if (kind) delete entry[kind];
    const next = { ...this.sitePerms };
    if (!kind || !Object.keys(entry).length) delete next[origin];
    else next[origin] = entry;
    this.sitePerms = next;
    this.write('permissions', this.sitePerms);
    this.changed('permissions');
  }

  // ---- find in page ------------------------------------------------------

  openFind() {
    const tab = this.focused;
    if (!tab || isInternal(tab.url)) return false;
    this.find = this.find || { query: '', count: 0, active: 0 };
    this.changed('find');
    return true;
  }

  findText(query, opts = {}) {
    if (!this.find) return;
    const tab = this.focused;
    const next = query === this.find.query && !!query;
    this.find = { ...this.find, query };
    if (!query) this.find.count = this.find.active = 0;
    this.bridge.send('tab.find', { id: tab.id, text: query, next: opts.next ?? next, backward: !!opts.backward });
    this.changed('find');
  }

  closeFind() {
    if (!this.find) return;
    this.bridge.send('tab.findStop', { id: this.focusedId, keepSelection: true });
    this.find = null;
    this.changed('find');
  }

  // ---- notices -----------------------------------------------------------

  showNotice(notice) {
    this.notice = { ...notice, at: Date.now() };
    this.changed('notice');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.notice = null; this.changed('notice'); }, notice.action ? 6500 : 3200);
  }

  dismissNotice() {
    clearTimeout(this.noticeTimer);
    this.notice = null;
    this.changed('notice');
  }

  // ---- profiles ----------------------------------------------------------

  addProfile(name) {
    const id = `P${Date.now().toString(36)}`;
    this.profiles = [...this.profiles, { id, name: name.trim() || 'New profile' }];
    this.write('profiles', this.profiles, 'app');
    this.changed('profiles');
    return id;
  }

  openProfile(id) { this.bridge.send('window.new', { profile: id }); }
}

export function internalTitle(url) {
  const page = url.replace(/^sift:\/\//, '').split(/[/?#]/)[0];
  return { newtab: 'New Tab', settings: 'Settings', history: 'History', bookmarks: 'Bookmarks', downloads: 'Downloads', moments: 'Moments' }[page] || 'Sift';
}
