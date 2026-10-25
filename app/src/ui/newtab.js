// The New Tab page: a search field, a few frequent sites, recent Moments.
// No feeds, no widgets, no greeting.

import { $, esc, favicon, h, keycaps } from './dom.js';
import { icon } from './icons.js';
import { recentMoments } from '../core/moments.js';
import { ago } from '../core/time.js';

export function renderNewTab(app, page) {
  const b = app.browser;
  const s = b.settings;
  const priv = !!b.info?.incognito;
  const sites = s.ntpFrequent && !priv ? b.topSites(8) : [];
  const moments = s.ntpMoments && !priv ? recentMoments(b.moments, 3) : [];
  const welcome = s.showWelcome && !b.info?.incognito;
  page.innerHTML = `
    <div class="ntp bg-${esc(s.ntpBackground)}">
      <div class="ntp-top"></div>
      <button class="ntp-search" id="ntp-box" type="button" aria-label="Search or enter address">
        ${icon('search')}
        <span class="ntp-placeholder">${b.info?.incognito ? 'Search privately' : `Search ${esc(b.engine.name)}`} or type an address</span>
      </button>
      ${welcome ? `<section class="welcome">
        <div><h3>Welcome to Sift</h3><p>Bring your bookmarks over, or just start browsing. A few things worth knowing:</p></div>
        <div class="acts"><button class="btn primary" data-a="import">${icon('import')}Import bookmarks</button><button class="btn ghost" data-a="dismiss">Dismiss</button></div>
        <div class="tips">
          <span>${keycaps('mod+l')} Address bar finds tabs, history and actions</span>
          <span>${keycaps('mod+shift+a')} Search your open tabs</span>
          <span>${keycaps('mod+shift+s')} Save tabs as a Moment</span>
          <span>${keycaps('mod+\\')} Side by side</span>
        </div></section>` : ''}
      ${priv ? `<section class="ntp-section private-note">${icon('eyeOff')}<div><b>This is a private window.</b> Pages you visit here aren't added to history, and cookies and site data are deleted when you close the window. Downloads and bookmarks you make are kept. Your network and the sites you visit can still see your activity.</div></section>` : ''}
      ${sites.length ? `<section class="ntp-section"><h4>Frequently visited</h4><div class="tiles">
        ${sites.map((x) => `<a class="tile" data-url="${esc(x.url)}" title="${esc(x.title || x.host)}">
          <span class="ic">${favicon(x.url, x.favicon)}</span><span class="lbl">${esc(tileLabel(x))}</span>
          <button class="ibtn sm rm" data-hide="${esc(x.host)}" aria-label="Remove from frequent sites">${icon('close')}</button></a>`).join('')}
      </div></section>` : ''}
      ${moments.length ? `<section class="ntp-section"><h4>Moments <button data-a="moments">See all</button></h4><div class="ntp-moments">
        ${moments.map((m) => `<button class="ntp-moment" data-moment="${m.id}">
          <span class="stack">${m.tabs.slice(0, 2).map((t) => `<span>${favicon(t.url, t.favicon)}</span>`).join('')}</span>
          <div><div class="n">${esc(m.name)}</div><div class="m">${m.tabs.length} ${m.tabs.length === 1 ? 'page' : 'pages'} · ${esc(ago(Math.max(m.updatedAt, m.openedAt || 0)))}</div></div>
        </button>`).join('')}
      </div></section>` : ''}
      <footer class="ntp-foot">
        <nav><a data-go="sift://history">${icon('history')}History</a><a data-go="sift://bookmarks">${icon('bookmark')}Bookmarks</a><a data-go="sift://downloads">${icon('download')}Downloads</a></nav>
        <button data-a="customize">${icon('paint')}Customize</button>
      </footer>
    </div>`;

  // The box is a doorway to the address bar (one place to type), like Chrome's.
  $('#ntp-box', page).addEventListener('click', () => app.omnibox.focus());
  page.onclick = (e) => {
    const hide = e.target.closest('[data-hide]');
    if (hide) {
      e.preventDefault();
      e.stopPropagation();
      b.setSetting('hiddenTiles', [...(b.settings.hiddenTiles || []), hide.dataset.hide]);
      return;
    }
    const tile = e.target.closest('.tile');
    if (tile) return b.navigate(tile.dataset.url, { newTab: e.metaKey || e.ctrlKey });
    const m = e.target.closest('[data-moment]');
    if (m) return b.restoreMoment(m.dataset.moment);
    const go = e.target.closest('[data-go]');
    if (go) return b.navigate(go.dataset.go);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'dismiss') b.setSetting('showWelcome', false);
    if (a === 'import') { b.setSetting('showWelcome', false); b.navigate('sift://settings/import'); }
    if (a === 'moments') app.moments.open();
    if (a === 'customize') customize(app, e.target.closest('[data-a]'));
  };
}

function tileLabel(site) {
  // A short root-page title ("The Verge", "Hacker News") beats a host fragment.
  const t = (site.root && site.title ? site.title.split(/\s[-|–—·:]\s/)[0] : '').trim();
  return t && t.length <= 16 ? t : label(site.host);
}

function label(host) {
  // The site's own name: the label before the public suffix.
  const parts = host.replace(/:\d+$/, '').split('.');
  const twoPartSuffix = parts.length > 2 && /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2]);
  const name = parts[parts.length - (twoPartSuffix ? 3 : 2)] || parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function customize(app, anchor) {
  const b = app.browser;
  const el = h('div', { class: 'pop customize' });
  const render = () => {
    const s = b.settings;
    el.innerHTML = `<h4>Customize New Tab</h4>
      <div class="opt"><span>Appearance</span><div class="seg">
        ${['dark', 'light', 'system'].map((t) => `<button class="${s.theme === t ? 'is-on' : ''}" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="opt"><span>Background</span><div class="seg">
        ${[['plain', 'Plain'], ['grain', 'Grain'], ['tint', 'Tint']].map(([v, l]) => `<button class="${s.ntpBackground === v ? 'is-on' : ''}" data-bg="${v}">${l}</button>`).join('')}</div></div>
      <div class="opt"><div class="si-row"><span class="label">Frequently visited</span><button class="switch" role="switch" aria-checked="${s.ntpFrequent}" data-k="ntpFrequent"></button></div>
      <div class="si-row"><span class="label">Recent Moments</span><button class="switch" role="switch" aria-checked="${s.ntpMoments}" data-k="ntpMoments"></button></div>
      ${(s.hiddenTiles || []).length ? `<div class="si-row"><span class="label">${s.hiddenTiles.length} hidden ${s.hiddenTiles.length === 1 ? 'site' : 'sites'}</span><button class="btn ghost" data-reset>Show again</button></div>` : ''}</div>`;
  };
  render();
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme]')?.dataset.theme;
    const bg = e.target.closest('[data-bg]')?.dataset.bg;
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (t) b.setSetting('theme', t);
    if (bg) b.setSetting('ntpBackground', bg);
    if (k) b.setSetting(k, !b.settings[k]);
    if (e.target.closest('[data-reset]')) b.setSetting('hiddenTiles', []);
    render();
  });
  app.layer.open({ id: 'customize', el, anchor, cover: false });
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, r.right - 300)}px`;
  el.style.top = `${Math.max(8, r.top - el.offsetHeight - 8)}px`;
}
