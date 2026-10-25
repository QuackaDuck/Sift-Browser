// Tab row and toolbar rendering.

import { $, esc, favicon } from './dom.js';
import { icon } from './icons.js';
import { displayParts, isInternal } from '../core/url.js';

export function renderTabRow(app) {
  const b = app.browser;
  const row = $('#tabrow');
  const tabHtml = (t) => {
    const cls = ['tab', t.id === b.activeId && 'is-active', t.pinned && 'is-pinned', t.loading && 'is-loading', t.discarded && 'is-discarded'].filter(Boolean).join(' ');
    return `<div class="${cls}" data-id="${t.id}" title="${esc(t.title)}">
      <span class="tab-favicon">${favicon(t.url, t.favicon, { internalIcon: icon('sift') })}${t.loading ? '<i class="tab-spinner"></i>' : ''}</span>
      <span class="tab-title">${esc(t.title || 'Loading…')}</span>
      <button class="tab-close" aria-label="Close tab">${icon('close')}</button>
    </div>`;
  };
  const priv = b.info?.incognito ? `<div class="private-pill">${icon('eyeOff')}Private</div>` : '';
  row.innerHTML = `${priv}
    <div id="pinned">${b.pinnedTabs.map(tabHtml).join('')}</div>
    <div class="tabs-wrap"><div class="tabs-scroll"><div id="tabs">${b.regularTabs.map(tabHtml).join('')}</div></div></div>
    <button class="ibtn tabrow-btn" data-act="newTab" title="New tab">${icon('plus')}</button>
    <div class="drag-fill"></div>
    <button class="tab-count" data-act="tabSearch" title="Search tabs">${icon('tabs')}${b.tabs.length}</button>
    <div class="winctl">
      <button data-act="min">${icon('minimize')}</button><button data-act="max">${icon('maximize')}</button><button class="close" data-act="close">${icon('close')}</button>
    </div>`;
  row.onclick = (e) => {
    const close = e.target.closest('.tab-close');
    const tab = e.target.closest('.tab');
    if (close && tab) return b.closeTab(tab.dataset.id);
    if (tab) return b.activate(tab.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'newTab') b.newTab();
  };
}

export function renderToolbar(app) {
  const b = app.browser;
  const t = b.focused;
  const internal = t && isInternal(t.url);
  let display = '';
  if (t && !internal) {
    const q = b.displayQuery(t);
    const p = displayParts(t.url);
    display = q ? `<span class="query">${esc(q)}</span><span class="engine">${esc(b.engine.name)}</span>`
      : `<span class="host">${esc(p.host)}</span><span class="rest">${esc(p.rest)}</span>`;
  }
  const site = !t || internal ? icon('search')
    : t.blocked ? `${icon('shieldCheck')}<span class="count">${t.blocked}</span>` : icon(t.secure ? 'lock' : 'shield');
  $('#toolbar').innerHTML = `
    <div class="toolbar-group">
      <button class="ibtn ${t?.canBack ? '' : 'is-disabled'}" title="Back">${icon('back')}</button>
      <button class="ibtn ${t?.canForward ? '' : 'is-disabled'}" title="Forward">${icon('forward')}</button>
      <button class="ibtn ${internal ? 'is-disabled' : ''}" title="Reload">${icon(t?.loading ? 'stop' : 'reload')}</button>
    </div>
    <div class="omnibox">
      <button class="site-btn" title="Site information">${site}</button>
      <div class="omni-field">
        <input class="omni-input ${display ? 'has-display' : ''}" spellcheck="false" placeholder="Search or enter address" value="${esc(internal ? '' : t?.url || '')}">
        <div class="omni-display">${display}</div>
      </div>
      <div class="omni-actions">
        ${internal ? '' : `<button class="ibtn" title="Bookmark">${icon(b.isBookmarked(t?.url) ? 'starFill' : 'star')}</button>`}
      </div>
      <div class="progress ${t?.loading ? 'is-on' : ''}" style="--p:${t?.progress || 0}"><i></i></div>
    </div>
    <div class="toolbar-group">
      <button class="ibtn" title="Split view">${icon('split')}</button>
      <button class="ibtn" title="Moments">${icon('moments')}</button>
      <button class="ibtn" title="Downloads">${icon('download')}</button>
      <button class="ibtn" title="Menu">${icon('more')}</button>
    </div>`;
}
