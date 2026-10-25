// The New Tab page: a search field, frequent sites, recent Moments.

import { $, esc, favicon, keycaps } from './dom.js';
import { icon, wordmark } from './icons.js';
import { recentMoments } from '../core/moments.js';
import { ago } from '../core/time.js';

export function renderNewTab(app) {
  const b = app.browser;
  const s = b.settings;
  const sites = s.ntpFrequent ? b.topSites(8) : [];
  const moments = s.ntpMoments ? recentMoments(b.moments, 3) : [];
  $('#page').innerHTML = `
    <div class="ntp bg-${s.ntpBackground}">
      <div class="ntp-top"></div>
      <div class="ntp-mark">${wordmark()}</div>
      <label class="ntp-search">
        ${icon('search')}
        <input placeholder="Search ${esc(b.engine.name)} or enter address" spellcheck="false">
        ${keycaps('mod+l')}
      </label>
      ${sites.length ? `<section class="ntp-section"><h4>Frequent</h4><div class="tiles">
        ${sites.map((x) => `<a class="tile" data-url="${esc(x.url)}"><span class="ic">${favicon(x.url, x.favicon)}</span><span class="lbl">${esc(x.host.split('.').slice(-2, -1)[0] || x.host)}</span></a>`).join('')}
      </div></section>` : ''}
      ${moments.length ? `<section class="ntp-section"><h4>Moments <button>View all</button></h4><div class="ntp-moments">
        ${moments.map((m) => `<button class="ntp-moment" data-moment="${m.id}">
          <span class="stack">${m.tabs.slice(0, 2).map((t) => `<span>${favicon(t.url, t.favicon)}</span>`).join('')}</span>
          <div><div class="n">${esc(m.name)}</div><div class="m">${m.tabs.length} pages · ${ago(m.updatedAt)}</div></div>
        </button>`).join('')}
      </div></section>` : ''}
      <footer class="ntp-foot">
        <nav><a>${icon('history')}History</a><a>${icon('bookmark')}Bookmarks</a><a>${icon('download')}Downloads</a></nav>
        <button>${icon('paint')}Customize</button>
      </footer>
    </div>`;
}
