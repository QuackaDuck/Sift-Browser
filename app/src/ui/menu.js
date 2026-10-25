// Menus, tooltips and confirmation dialogs. One menu component for every
// menu in Sift so they all behave the same: arrow keys, Enter, Escape,
// type-to-jump, and sensible positioning.

import { esc, h, shortcutText } from './dom.js';
import { icon } from './icons.js';

let menuSeq = 0;

/**
 * items: [{ label, icon, hint (shortcut combo), run, danger, disabled, checked } | '-' | { head } | { custom: el }]
 * at: { x, y } or { anchor: element, align }
 */
export function openMenu(app, items, at, opts = {}) {
  const id = opts.id || `menu${menuSeq++}`;
  const el = h('div', { class: 'pop menu', role: 'menu', tabindex: '-1' });
  const rows = [];
  for (const item of items) {
    if (!item) continue;
    if (item === '-') { el.append(h('div', { class: 'menu-sep' })); continue; }
    if (item.head) { el.append(h('div', { class: 'menu-head' }, item.head)); continue; }
    if (item.custom) { el.append(item.custom); continue; }
    const row = h('div', {
      class: `menu-item${item.danger ? ' is-danger' : ''}${item.disabled ? ' is-disabled' : ''}`,
      role: 'menuitem',
      html: `${item.checked !== undefined ? `<span class="check">${item.checked ? icon('check') : ''}</span>` : icon(item.icon || 'dot')}<span class="label">${esc(item.label)}</span>${item.hint ? `<span class="hint">${esc(shortcutText(item.hint))}</span>` : ''}`,
    });
    if (!item.icon && item.checked === undefined) row.querySelector('svg')?.style.setProperty('visibility', 'hidden');
    row.addEventListener('pointerenter', () => setActive(rows.indexOf(row)));
    row.addEventListener('click', () => choose(item));
    rows.push(row);
    row._item = item;
    el.append(row);
  }
  let active = -1;
  const setActive = (i) => {
    active = i;
    rows.forEach((r, j) => r.classList.toggle('is-active', j === i));
  };
  const choose = (item) => {
    if (item.disabled) return;
    app.layer.close(id, { reason: 'choose', immediate: true });
    item.run?.();
  };
  el.addEventListener('keydown', (e) => {
    const enabled = rows.map((r, i) => (r._item.disabled ? -1 : i)).filter((i) => i >= 0);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = enabled.indexOf(active);
      const next = e.key === 'ArrowDown' ? enabled[(pos + 1) % enabled.length] : enabled[(pos - 1 + enabled.length) % enabled.length];
      setActive(next ?? enabled[0]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (active >= 0) choose(rows[active]._item);
    } else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const hit = enabled.find((i) => i > active && rows[i]._item.label.toLowerCase().startsWith(k)) ?? enabled.find((i) => rows[i]._item.label.toLowerCase().startsWith(k));
      if (hit !== undefined) setActive(hit);
    }
  });

  app.layer.open({ id, el, anchor: at.anchor, onClose: opts.onClose, closeOnBlur: true });
  // Position after insertion so we know the size.
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x;
  let y;
  if (at.anchor) {
    const r = at.anchor.getBoundingClientRect();
    x = at.align === 'right' ? r.right - w : r.left;
    y = r.bottom + 6;
  } else {
    x = at.x;
    y = at.y;
  }
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  if (y + hgt > (app.browser.windowHeight || window.innerHeight) - 8 && !at.anchor) y = Math.max(8, y - hgt);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  if (at.align === 'right') el.classList.add('from-right');
  el.focus({ preventScroll: true });
  if (opts.keyboard) setActive(rows.findIndex((r) => !r._item.disabled));
  return id;
}

/** Confirm a destructive action. Resolves true when confirmed. */
export function confirmDialog(app, { title, body, confirm = 'Continue', danger = true }) {
  return new Promise((resolve) => {
    const id = 'confirm';
    const el = h('div', { class: 'pop dialog', role: 'alertdialog', tabindex: '-1' },
      h('h3', {}, title), h('p', {}, body),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, confirm)));
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      app.layer.close(id, { reason: 'choose' });
      resolve(v);
    };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
    });
    app.layer.open({ id, el, scrim: true, onClose: () => done(false) });
    setTimeout(() => el.querySelector('.btn:last-child').focus(), 0);
  });
}

/** Tooltips for icon buttons: `data-tip` and optional `data-keys`. Quick, never in the way. */
export function installTooltips(root = document) {
  let timer = 0;
  let tip = null;
  let lastHide = 0;
  const hide = () => {
    clearTimeout(timer);
    if (tip) { tip.remove(); tip = null; lastHide = Date.now(); }
  };
  root.addEventListener('pointerover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    hide();
    // Tooltips only appear over the chrome strip, which is always visible.
    const delay = Date.now() - lastHide < 400 ? 60 : 650;
    timer = setTimeout(() => {
      if (!target.isConnected || document.querySelector('#layer .pop:not(.is-leaving)')) return;
      tip = h('div', { class: 'tooltip', html: `${esc(target.dataset.tip)}${target.dataset.keys ? `<span class="hint" style="color:var(--text-3);font:400 var(--t-xs)/1 var(--mono)">${esc(shortcutText(target.dataset.keys))}</span>` : ''}` });
      document.getElementById('layer').append(tip);
      const r = target.getBoundingClientRect();
      const w = tip.offsetWidth;
      const chromeBottom = document.getElementById('chrome').getBoundingClientRect().bottom;
      // Keep tooltips inside the strip in the native host (no cover needed).
      const below = r.bottom + 6 + tip.offsetHeight <= chromeBottom || document.documentElement.dataset.surface !== 'strip';
      tip.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6))}px`;
      tip.style.top = below ? `${r.bottom + 6}px` : `${Math.max(2, r.top + (r.height - tip.offsetHeight) / 2)}px`;
      if (!below) tip.style.left = `${Math.min(r.right + 8, window.innerWidth - w - 6)}px`;
    }, delay);
  });
  root.addEventListener('pointerout', (e) => {
    if (e.target.closest('[data-tip]')) hide();
  });
  root.addEventListener('pointerdown', hide, true);
}
