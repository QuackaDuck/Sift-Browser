// The overlay layer and the UI "surface".
//
// In the native host the UI fills the window and web content floats over it
// below the chrome strip. When something must float over the page (results,
// menus, tab search, previews) the layer asks the host for a snapshot of the
// visible panes, paints it as a backdrop, then has the host hide the web
// content ("cover"). Internal pages (New Tab, Settings, Library) hide it with
// no snapshot ("full"). The UI itself never resizes.

import { $, h } from './dom.js';
import { isInternal } from '../core/url.js';

export class Layer {
  constructor(app) {
    this.app = app;
    this.browser = app.browser;
    this.bridge = app.browser.bridge;
    this.root = $('#layer');
    this.backdrop = $('#backdrop');
    this.stack = [];
    this.surface = 'strip';
    this.coverToken = 0;

    document.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    window.addEventListener('blur', () => this.closeWhere((o) => o.closeOnBlur));
  }

  get isOpen() { return this.stack.length > 0; }
  top() { return this.stack[this.stack.length - 1]; }
  find(id) { return this.stack.find((o) => o.id === id); }

  /**
   * Open an overlay.
   * spec: { id, el, anchor, cover = true, dismissOnOutside = true, onClose,
   *         keepWithin: [elements that don't count as outside], modal }
   */
  open(spec) {
    this.close(spec.id, { silent: true });
    const o = { cover: true, dismissOnOutside: true, closeOnBlur: false, ...spec };
    if (o.scrim) {
      o.scrimEl = h('div', { class: `scrim ${o.scrim === 'clear' ? 'is-clear' : ''}` });
      this.root.append(o.scrimEl);
    }
    this.root.append(o.el);
    this.stack.push(o);
    if (o.cover) {
      // Keep the element invisible until the surface covers the window, so it
      // never flashes half-drawn.
      // The scrim waits too: compositor animations started while the UI is
      // strip-sized don't resume after the resize.
      // Clipped rather than hidden so inputs inside can take focus at once.
      o.el.classList.add('is-pending');
      if (o.scrimEl) o.scrimEl.style.display = 'none';
      this.updateSurface().then(() => {
        if (!this.stack.includes(o)) return;
        o.el.classList.remove('is-pending');
        if (o.scrimEl) o.scrimEl.style.display = '';
      });
    }
    return o;
  }

  close(id, opts = {}) {
    const o = this.find(id);
    if (!o) return;
    this.stack = this.stack.filter((x) => x !== o);
    const remove = () => { o.el.remove(); o.scrimEl?.remove(); };
    if (opts.silent || o.cover === false) remove();
    else {
      o.el.classList.add('is-leaving');
      o.scrimEl?.remove();
      setTimeout(remove, 110);
    }
    if (!opts.silent) o.onClose?.(opts.reason);
    if (!opts.silent) setTimeout(() => this.updateSurface(), opts.immediate ? 0 : 100);
  }

  closeAll(reason) {
    for (const o of [...this.stack].reverse()) this.close(o.id, { reason });
  }

  closeWhere(pred) {
    for (const o of [...this.stack].reverse()) if (pred(o)) this.close(o.id, { reason: 'outside' });
  }

  /** Escape: close the top overlay. Returns true when something closed. */
  escape() {
    const o = this.top();
    if (!o) return false;
    if (o.onEscape && o.onEscape() === false) return true;
    this.close(o.id, { reason: 'escape' });
    return true;
  }

  onPointerDown(e) {
    if (!this.stack.length) return;
    const t = e.target;
    for (const o of [...this.stack].reverse()) {
      if (!o.dismissOnOutside) continue;
      if (o.el.contains(t)) return;
      if ((o.keepWithin || []).some((el) => el && el.contains(t))) return;
      if (o.anchor && o.anchor.contains(t) && o.toggleAnchor !== false) {
        // Clicking the anchor again toggles it closed.
        this.close(o.id, { reason: 'anchor' });
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      this.close(o.id, { reason: 'outside' });
    }
  }

  /** Decide which surface the host should use and apply it. */
  async updateSurface() {
    const tab = this.browser.active;
    const internalVisible = tab && isInternal(tab.url) && !this.browser.isSplitVisible;
    const needsCover = this.stack.some((o) => o.cover) || this.app.dragging;
    let want = internalVisible ? 'full' : needsCover ? 'cover' : 'strip';
    if (this.browser.fullscreen) want = 'strip';
    if (want === this.surface) return;
    const token = ++this.coverToken;
    if (want === 'cover' && this.surface === 'strip' && this.bridge.native) {
      const shots = await this.bridge.send('snapshot').catch(() => []);
      if (token !== this.coverToken) return;
      await this.paintBackdrop(shots);
      // Let the backdrop reach the screen before the content is hidden.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (token !== this.coverToken) return;
      this.browser.adoptSnapshots(shots);
    }
    this.surface = want;
    document.documentElement.dataset.surface = want;
    await this.bridge.send('surface', { mode: want });
    if (want === 'strip') this.backdrop.replaceChildren();
  }

  async paintBackdrop(shots) {
    const rects = this.browser.paneRects();
    const imgs = [];
    for (const r of rects) {
      const shot = (shots || []).find((s) => s.id === r.id);
      // A capture can fail (e.g. the window is covered); the tab's last
      // thumbnail is a better backdrop than an empty pane.
      const data = shot?.data || this.browser.tab(r.id)?.thumbnail;
      if (!data) continue;
      const img = new Image();
      img.src = data;
      // Height follows the capture's aspect ratio: while the UI is only the
      // strip, it can't measure the window height itself.
      Object.assign(img.style, { left: `${r.x}px`, top: `${r.y - this.browser.chromeHeight}px`, width: `${r.w}px`, height: 'auto' });
      imgs.push(img);
    }
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    this.backdrop.replaceChildren(...imgs);
  }
}

/** Position `el` under `anchor`, kept inside the window. */
export function placeBelow(el, anchor, opts = {}) {
  const r = anchor.getBoundingClientRect();
  const gap = opts.gap ?? 6;
  const width = opts.width ?? el.offsetWidth;
  let left = opts.align === 'right' ? r.right - width : opts.align === 'center' ? r.left + r.width / 2 - width / 2 : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  el.style.left = `${Math.round(left + (opts.dx || 0))}px`;
  el.style.top = `${Math.round(r.bottom + gap)}px`;
  if (opts.width) el.style.width = `${width}px`;
}
