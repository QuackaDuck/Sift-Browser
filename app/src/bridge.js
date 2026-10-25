// The bridge between Sift's UI and whatever hosts it.
//
//  * NativeBridge: the CEF host (native/). Commands go out through
//    window.siftQuery (CEF message router); events come back through
//    window.__siftHost(). Tabs are real Chromium browsers.
//  * PreviewBridge: a plain browser tab, for working on the UI without
//    building the host. Pages render in iframes, which many sites refuse;
//    it exists for UI development only and says so in the chrome.

export function createBridge() {
  return typeof window.siftQuery === 'function' ? new NativeBridge() : new PreviewBridge();
}

class Emitter {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, data) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(data); } catch (err) { console.error(`[sift] handler for ${type} failed`, err); }
    }
  }
}

class NativeBridge extends Emitter {
  constructor() {
    super();
    this.native = true;
    window.__siftHost = (msg) => this.emit(msg.type, msg.data);
  }

  send(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      window.siftQuery({
        request: JSON.stringify({ cmd, args }),
        persistent: false,
        onSuccess: (res) => {
          try { resolve(res === '' ? null : JSON.parse(res)); } catch { resolve(res); }
        },
        onFailure: (code, message) => reject(new Error(`${cmd}: ${message} (${code})`)),
      });
    });
  }
}

// ---------------------------------------------------------------------------

const PREVIEW_KEY = 'sift-preview:';

class PreviewBridge extends Emitter {
  constructor() {
    super();
    this.native = false;
    this.frames = new Map();
    this.panes = [];
    this.ratio = 0.5;
    this.zoom = new Map();
  }

  host() { return document.getElementById('frames'); }

  async send(cmd, args = {}) {
    const fn = this[`cmd_${cmd.replace(/\./g, '_')}`];
    return fn ? fn.call(this, args) : null;
  }

  cmd_ready() {
    const ua = navigator.userAgent;
    return {
      windowId: 'w1', profile: 'Default', incognito: new URLSearchParams(location.search).has('private'),
      platform: /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'win' : 'linux',
      engine: 'Preview (iframes)', chromium: (ua.match(/Chrome\/([\d.]+)/) || [])[1] || 'n/a',
      trackerDomains: 0, downloadsDir: '~/Downloads', dataDir: 'localStorage', openUrls: [], liveTabs: [], preview: true,
    };
  }

  cmd_tab_create({ id, url, lazy }) {
    const frame = document.createElement('iframe');
    frame.dataset.id = id;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.addEventListener('load', () => this.frameLoaded(id, frame));
    this.frames.set(id, { frame, url, started: !lazy, history: [], index: -1 });
    this.host().append(frame);
    if (!lazy) this.load(id, url);
    return true;
  }

  load(id, url, push = true) {
    const f = this.frames.get(id);
    if (!f) return;
    f.started = true;
    f.url = url;
    if (push) {
      f.history = f.history.slice(0, f.index + 1);
      f.history.push(url);
      f.index = f.history.length - 1;
    }
    this.emit('tab.state', { id, url, loading: true, progress: 0.2, canBack: f.index > 0, canForward: f.index < f.history.length - 1, title: '' });
    f.frame.src = url;
  }

  frameLoaded(id, frame) {
    const f = this.frames.get(id);
    if (!f || !frame.src) return;
    let title = '';
    let url = f.url;
    try {
      title = frame.contentDocument?.title || '';
      url = frame.contentWindow.location.href || url;
    } catch { /* cross-origin */ }
    if (!title) {
      try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = url; }
    }
    let favicon = null;
    try { favicon = `${new URL(url).origin}/favicon.ico`; } catch { /* ignore */ }
    this.emit('tab.state', { id, url, title, loading: false, progress: 1, favicon, secure: url.startsWith('https:'), canBack: f.index > 0, canForward: f.index < f.history.length - 1, loaded: true });
  }

  cmd_tab_navigate({ id, url }) { this.load(id, url); }
  cmd_tab_back({ id }) {
    const f = this.frames.get(id);
    if (f && f.index > 0) { f.index--; this.load(id, f.history[f.index], false); }
  }
  cmd_tab_forward({ id }) {
    const f = this.frames.get(id);
    if (f && f.index < f.history.length - 1) { f.index++; this.load(id, f.history[f.index], false); }
  }
  cmd_tab_reload({ id }) { const f = this.frames.get(id); if (f) this.load(id, f.url, false); }
  cmd_tab_stop() {}
  cmd_tab_close({ id }) {
    const f = this.frames.get(id);
    if (f) { f.frame.remove(); this.frames.delete(id); }
    this.panes = this.panes.filter((p) => p !== id);
  }
  cmd_tab_discard({ id }) {
    const f = this.frames.get(id);
    if (f) { f.frame.removeAttribute('src'); f.started = false; }
  }
  cmd_tab_zoom({ id, delta }) {
    const steps = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
    let z = this.zoom.get(id) || 100;
    let i = steps.indexOf(z);
    if (delta === 0) z = 100;
    else z = steps[Math.max(0, Math.min(steps.length - 1, i + (delta > 0 ? 1 : -1)))];
    this.zoom.set(id, z);
    return String(z);
  }
  cmd_tab_scroll() { return 0; }
  cmd_tab_find({ id, text }) {
    this.emit('find', { tabId: id, count: text ? 0 : 0, active: 0, final: true });
  }

  cmd_layout({ panes, ratio }) {
    this.panes = panes;
    this.ratio = ratio;
    const host = this.host();
    host.classList.toggle('is-split', panes.length === 2);
    let gap = host.querySelector('.gap');
    if (!gap) { gap = document.createElement('div'); gap.className = 'gap'; host.append(gap); }
    for (const [id, f] of this.frames) {
      const idx = panes.indexOf(id);
      f.frame.classList.toggle('is-visible', idx >= 0);
      if (idx >= 0) {
        if (!f.started) this.load(id, f.url);
        f.frame.style.order = String(idx * 2);
        f.frame.style.flex = panes.length === 2 ? `${idx === 0 ? ratio : 1 - ratio} 1 0` : '1 1 0';
      }
    }
    gap.style.order = '1';
    return true;
  }

  cmd_surface() { return true; }
  cmd_snapshot() { return []; }
  cmd_thumbnail() { return null; }

  cmd_store_read({ key, scope }) {
    try { return localStorage.getItem(PREVIEW_KEY + (scope || 'p') + ':' + key); } catch { return null; }
  }
  cmd_store_write({ key, value, scope }) {
    try { localStorage.setItem(PREVIEW_KEY + (scope || 'p') + ':' + key, value); return true; } catch { return false; }
  }

  cmd_fetch() { throw new Error('suggestions need the native host'); }
  cmd_import_sources() { return []; }
  cmd_file_save({ name, content }) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = name || 'export.txt';
    a.click();
    return { path: name, ok: true };
  }
  cmd_file_open() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files[0];
        resolve(file ? { path: file.name, content: await file.text() } : null);
      };
      input.click();
    });
  }
  cmd_window_new({ urls, incognito }) {
    window.open(`${location.pathname}${incognito ? '?private=1' : ''}`, '_blank');
  }
  cmd_window_close() { window.close(); }
}
