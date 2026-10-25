// Small anchored panels: main menu, site information (security, blocked
// trackers, permissions), permission prompts and downloads.

import { $, esc, favicon, h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { mainMenuItems } from './toolbar.js';
import { hostOf, isInternal, safeParse } from '../core/url.js';
import { formatBytes } from '../core/time.js';

const PERM = {
  location: { icon: 'location', label: 'Location', verb: 'know your location' },
  notifications: { icon: 'bell', label: 'Notifications', verb: 'show notifications' },
  camera: { icon: 'camera', label: 'Camera', verb: 'use your camera' },
  microphone: { icon: 'mic', label: 'Microphone', verb: 'use your microphone' },
  clipboard: { icon: 'clipboard', label: 'Clipboard', verb: 'read your clipboard' },
  screen: { icon: 'window', label: 'Screen sharing', verb: 'share your screen' },
  midi: { icon: 'keyboard', label: 'MIDI devices', verb: 'use MIDI devices' },
  downloads: { icon: 'download', label: 'Multiple downloads', verb: 'download several files' },
  windows: { icon: 'window', label: 'Window management', verb: 'manage windows on your displays' },
  fonts: { icon: 'file', label: 'Local fonts', verb: 'use fonts installed on this device' },
  storage: { icon: 'database', label: 'Storage access', verb: 'use its cookies while embedded on other sites' },
  files: { icon: 'folder', label: 'Files', verb: 'edit files on this device' },
  sensors: { icon: 'location', label: 'Motion sensors', verb: 'use motion sensors' },
  idle: { icon: 'clock', label: 'Idle detection', verb: 'know when you are away' },
  other: { icon: 'info', label: 'Other', verb: 'use another browser feature' },
};

export class Panels {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.b.subscribe((what, data) => {
      if (what.has('ui:permission')) this.nextPermission();
      if (what.has('ui:downloadStarted') && !this.app.layer.find('downloads')) this.pulseDownloads();
      if (what.has('downloads') && this.app.layer.find('downloads')) this.renderDownloads();
      void data;
    });
  }

  mainMenu(anchor) {
    openMenu(this.app, mainMenuItems(this.app), { anchor, align: 'right' }, { id: 'main-menu' });
  }

  // ---- site info ------------------------------------------------------

  siteInfo(anchor) {
    const t = this.b.focused;
    if (!t || isInternal(t.url)) { this.app.omnibox.focus(); return; }
    const u = safeParse(t.url);
    const origin = u?.origin || '';
    const host = hostOf(t.url);
    const perms = this.b.sitePerms[origin] || {};
    const secure = t.secure && !t.certError;
    const el = h('div', { class: 'pop siteinfo from-right' });
    el.innerHTML = `
      <div class="siteinfo-head"><span class="icon">${favicon(t.url, t.favicon)}</span>
        <div><div class="host">${esc(host)}</div>
        <div class="sec ${secure ? 'ok' : 'warn'}">${icon(secure ? 'lock' : 'unlock')}${secure ? 'Connection is encrypted' : t.certError ? 'Certificate problem' : 'Connection is not encrypted'}</div></div></div>
      <div class="si-block">
        <div class="si-row">${icon(this.b.settings.trackers ? 'shieldCheck' : 'shieldOff')}<span class="label">Tracker blocking</span>
          <button class="switch" role="switch" aria-checked="${!!this.b.settings.trackers}" data-a="trackers"></button></div>
        ${this.b.settings.trackers ? `<div class="si-note">${t.blocked ? `Blocked ${t.blocked} ${t.blocked === 1 ? 'request' : 'requests'} to ${t.blockedDomains.length} known tracking ${t.blockedDomains.length === 1 ? 'domain' : 'domains'} on this page.` : 'No requests to known trackers on this page so far.'}
          Sift checks requests against a bundled list of ${this.b.info?.trackerDomains || 'known'} tracking domains. It is not a complete ad blocker.</div>
          ${t.blockedDomains.length ? `<div class="si-domains">${t.blockedDomains.slice(0, 12).map((d) => `<span>${esc(d)}</span>`).join('')}</div>` : ''}` : '<div class="si-note">Tracker blocking is off for all sites.</div>'}
      </div>
      <div class="si-block">
        ${Object.keys(perms).length ? Object.entries(perms).map(([k, v]) => `
          <div class="si-row">${icon(PERM[k]?.icon || 'info')}<span class="label">${esc(PERM[k]?.label || k)}</span>
            <span class="pill ${v}">${v === 'allow' ? 'Allowed' : 'Blocked'}</span>
            <button class="ibtn sm" data-forget="${esc(k)}" data-tip="Ask again next time" aria-label="Reset">${icon('reload')}</button></div>`).join('')
          : '<div class="si-note" style="margin:0">This site hasn’t asked for any permissions.</div>'}
      </div>
      <div class="si-block"><div class="si-row" style="gap:6px">
        <button class="btn ghost" data-a="settings">${icon('sliders')}Site settings</button>
        <span style="flex:1"></span>
        <button class="btn ghost" data-a="copy">${icon('link')}Copy link</button></div></div>`;
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const forget = e.target.closest('[data-forget]')?.dataset.forget;
      if (a === 'trackers') {
        this.b.setSetting('trackers', !this.b.settings.trackers);
        this.app.layer.close('siteinfo');
        this.b.reload(t.id);
      }
      if (a === 'settings') { this.app.layer.close('siteinfo'); this.app.openInternal('sift://settings/permissions'); }
      if (a === 'copy') { navigator.clipboard?.writeText(t.url); this.app.layer.close('siteinfo'); this.b.showNotice({ text: 'Link copied', icon: 'link' }); }
      if (forget) { this.b.forgetPermission(origin, forget); this.app.layer.close('siteinfo'); }
    });
    this.app.layer.open({ id: 'siteinfo', el, anchor });
    const r = anchor.getBoundingClientRect();
    el.style.left = `${Math.max(8, r.left - 4)}px`;
    el.style.top = `${r.bottom + 10}px`;
  }

  // ---- permissions ----------------------------------------------------

  nextPermission() {
    if (this.app.layer.find('permission')) return;
    const p = this.b.pendingPermissions[0];
    if (!p) return;
    const tab = this.b.tab(p.tabId);
    if (tab && !this.b.visibleIds().includes(tab.id)) this.b.activate(tab.id);
    const host = hostOf(p.origin) || p.origin;
    const kinds = p.kinds.map((k) => PERM[k] || PERM.other);
    const verbs = kinds.map((k) => k.verb);
    const sentence = verbs.length > 1 ? `${verbs.slice(0, -1).join(', ')} and ${verbs[verbs.length - 1]}` : verbs[0];
    const el = h('div', { class: 'pop permission', role: 'alertdialog', tabindex: '-1' });
    el.innerHTML = `<div class="q"><b>${esc(host)}</b> wants to ${esc(sentence)}.</div>
      <div class="kinds">${kinds.map((k) => `<span>${icon(k.icon)}${esc(k.label)}</span>`).join('')}</div>
      <div class="row"><button class="btn ghost" data-r="dismiss">Not now</button><button class="btn" data-r="deny">Block</button><button class="btn primary" data-r="allow">Allow</button></div>`;
    let answered = false;
    const answer = (r) => {
      if (answered) return;
      answered = true;
      this.b.respondPermission(p, r, r !== 'dismiss');
      this.app.layer.close('permission', { reason: 'choose' });
      setTimeout(() => this.nextPermission(), 150);
    };
    el.addEventListener('click', (e) => { const r = e.target.closest('[data-r]')?.dataset.r; if (r) answer(r); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer('allow'); } });
    this.app.layer.open({ id: 'permission', el, dismissOnOutside: false, onClose: (reason) => { if (reason === 'escape') answer('dismiss'); } });
    const site = $('#omnibox .site-btn').getBoundingClientRect();
    el.style.left = `${Math.max(8, site.left - 4)}px`;
    el.style.top = `${site.bottom + 10}px`;
    this.b.bridge.send('ui.focus');
    el.focus();
  }

  // ---- downloads ------------------------------------------------------

  pulseDownloads() {
    const btn = $('#toolbar [data-act="downloads"]');
    btn?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.34,1.32,.64,1)' });
  }

  downloads(anchor) {
    const el = h('div', { class: 'pop downloads from-right' });
    this.dlEl = el;
    this.app.layer.open({ id: 'downloads', el, anchor });
    const r = anchor.getBoundingClientRect();
    el.style.left = `${Math.max(8, r.right - 380)}px`;
    el.style.top = `${r.bottom + 8}px`;
    this.renderDownloads();
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-d]');
      if (!a) return;
      const d = this.b.downloads.find((x) => String(x.id) === a.closest('.dl')?.dataset.id);
      const act = a.dataset.d;
      if (act === 'all') { this.app.layer.close('downloads'); this.app.openInternal('sift://downloads'); return; }
      if (!d) return;
      if (act === 'open') this.b.bridge.send('download.open', { path: d.path });
      if (act === 'reveal') this.b.bridge.send('download.reveal', { path: d.path });
      if (act === 'cancel') this.b.bridge.send('download.cancel', { downloadId: d.id });
      if (act === 'pause') this.b.bridge.send(d.state === 'paused' ? 'download.resume' : 'download.pause', { downloadId: d.id });
    });
  }

  renderDownloads() {
    const el = this.dlEl;
    if (!el) return;
    const list = this.b.downloads.slice(0, 8);
    el.innerHTML = `<div class="moments-head"><div><h2>Downloads</h2><p>Saved to ${esc(this.b.info?.downloadsDir || 'Downloads')}</p></div>
      <button class="btn ghost" data-d="all">Show all</button></div>
      <div class="dl-list">${list.map((d) => downloadRow(d)).join('') || '<div class="moments-empty">Nothing downloaded in this session.</div>'}</div>`;
  }
}

export function downloadRow(d) {
  const ext = (d.name.split('.').pop() || '').slice(0, 4);
  const pct = d.total ? Math.round((d.received / d.total) * 100) : d.percent || 0;
  const meta = {
    progress: `${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}${d.speed ? ` · ${formatBytes(d.speed)}/s` : ''}`,
    paused: `Paused · ${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}`,
    complete: `${formatBytes(d.total || d.received)} · ${hostOf(d.url)}`,
    canceled: 'Canceled',
    interrupted: 'Failed: the download was interrupted',
  }[d.state] || '';
  const acts = d.state === 'complete'
    ? `<button class="ibtn sm" data-d="reveal" data-tip="Show in folder" aria-label="Show in folder">${icon('folder')}</button>`
    : d.state === 'progress' || d.state === 'paused'
      ? `<button class="ibtn sm" data-d="pause" aria-label="${d.state === 'paused' ? 'Resume' : 'Pause'}">${icon(d.state === 'paused' ? 'play' : 'pause')}</button><button class="ibtn sm" data-d="cancel" aria-label="Cancel">${icon('close')}</button>`
      : '';
  return `<div class="dl" data-id="${d.id}">
    <span class="ficon">${esc(ext)}</span>
    <div class="info" ${d.state === 'complete' ? 'data-d="open" style="cursor:pointer"' : ''}><div class="name">${esc(d.name)}</div>
      <div class="meta ${d.state === 'interrupted' ? 'is-error' : ''}">${esc(meta)}</div>
      ${d.state === 'progress' || d.state === 'paused' ? `<div class="bar"><i style="--p:${pct}%"></i></div>` : ''}</div>
    <div class="acts">${acts}</div></div>`;
}
