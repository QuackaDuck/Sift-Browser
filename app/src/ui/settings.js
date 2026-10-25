// sift://settings: appearance, search, privacy, permissions, tabs, profiles,
// import/export, shortcuts, about. Each control states what it really does.

import { esc, keycaps } from './dom.js';
import { icon } from './icons.js';
import { confirmDialog } from './menu.js';
import { SEARCH_ENGINES } from '../core/url.js';
import { exportBookmarksHtml, parseBookmarksHtml, parseChromiumBookmarks } from '../core/bookmarks-io.js';

const SECTIONS = [
  ['appearance', 'Appearance', 'paint'],
  ['search', 'Search', 'search'],
  ['privacy', 'Privacy', 'shield'],
  ['permissions', 'Site permissions', 'key'],
  ['tabs', 'Tabs & Moments', 'tabs'],
  ['profiles', 'Profiles', 'users'],
  ['import', 'Import & export', 'import'],
  ['shortcuts', 'Shortcuts', 'keyboard'],
  ['about', 'About Sift', 'info'],
];

export const SHORTCUTS = [
  ['Address bar', [['Focus the address bar', 'mod+l'], ['Actions (commands)', 'mod+k'], ['Open result in a new tab', 'mod+enter'], ['Accept inline completion', 'tab']]],
  ['Tabs', [['New tab', 'mod+t'], ['Close tab', 'mod+w'], ['Reopen closed tab', 'mod+shift+t'], ['Search tabs', 'mod+shift+a'], ['Next / previous tab', 'ctrl+tab'], ['Go to tab 1–8, last tab', 'mod+1']]],
  ['Moments & split view', [['Save tabs as a Moment', 'mod+shift+s'], ['Side by side', 'mod+\\']]],
  ['Page', [['Back / forward', 'alt+left'], ['Reload', 'mod+r'], ['Find in page', 'mod+f'], ['Zoom in / out / reset', 'mod+='], ['Bookmark', 'mod+d'], ['Print', 'mod+p'], ['Developer tools', 'mod+shift+i']]],
  ['Windows', [['New window', 'mod+n'], ['New private window', 'mod+shift+n'], ['Settings', 'mod+,'], ['Close any overlay', 'esc']]],
];

export function renderSettings(app, page, section = 'appearance') {
  if (!SECTIONS.some(([id]) => id === section)) section = 'appearance';
  const b = app.browser;
  page.innerHTML = `<div class="shell">
    <nav class="shell-nav"><h1>Settings</h1>
      ${SECTIONS.map(([id, label, ic]) => `<button class="${id === section ? 'is-on' : ''}" data-section="${id}">${icon(ic)}${label}</button>`).join('')}
      <span class="grow"></span><div class="foot">Sift 0.1 · ${esc(b.info?.engine || '')}</div>
    </nav>
    <div class="shell-main"><div class="inner">${SECTION_RENDER[section](b)}</div></div></div>`;
  page.onclick = (e) => onClick(app, e, section);
  page.onchange = (e) => onChange(app, e);
}

const toggle = (key, on, disabled) => `<button class="switch" role="switch" aria-checked="${!!on}" data-toggle="${key}" ${disabled ? 'disabled' : ''}></button>`;
const setting = (name, desc, ctl) => `<div class="setting"><div class="txt"><div class="name">${name}</div>${desc ? `<div class="desc">${desc}</div>` : ''}</div><div class="ctl">${ctl}</div></div>`;
const select = (key, value, options) => `<select class="select" data-select="${key}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

const SECTION_RENDER = {
  appearance: (b) => {
    const s = b.settings;
    return `<h2>Appearance</h2><p class="lede">Sift starts dark. Both appearances are designed to be used all day.</p>
    <div class="group"><div class="card">
      <div class="setting"><div class="txt"><div class="name">Theme</div></div><div class="ctl swatches">
        ${['dark', 'light', 'system'].map((t) => `<button class="swatch ${t} ${s.theme === t ? 'is-on' : ''}" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      ${setting('Density', 'Comfortable adds a little height to the tab row and toolbar.', `<div class="seg">${['compact', 'comfortable'].map((d) => `<button class="${s.density === d ? 'is-on' : ''}" data-density="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div>`)}
      ${setting('Tab previews', 'Show a preview card when you hover a tab.', toggle('previews', s.previews))}
    </div></div>
    <div class="group"><h3>New Tab</h3><div class="card">
      ${setting('Background', '', select('ntpBackground', s.ntpBackground, [['plain', 'Plain'], ['grain', 'Grain'], ['tint', 'Tint']]))}
      ${setting('Frequently visited sites', 'Up to eight sites, worked out from your local history.', toggle('ntpFrequent', s.ntpFrequent))}
      ${setting('Recent Moments', '', toggle('ntpMoments', s.ntpMoments))}
    </div></div>`;
  },

  search: (b) => {
    const s = b.settings;
    return `<h2>Search</h2><p class="lede">What you type in the address bar that isn't an address is searched with your default engine. Sift has no sponsored results and no search deals.</p>
    <div class="group"><div class="card">
      ${setting('Default search engine', '', select('engine', s.engine, SEARCH_ENGINES.map((e) => [e.id, e.name])))}
      ${setting('Search suggestions', `As you type, send your keystrokes to ${esc(b.engine.name)} to get suggested searches. Off by default; never used in private windows.${b.engine.suggest ? '' : ` ${esc(b.engine.name)} doesn't offer suggestions.`}`, toggle('suggestions', s.suggestions, !b.engine.suggest))}
    </div></div>
    <div class="group"><h3>What the address bar searches locally</h3><div class="card"><div class="prose">
      <p>Open tabs, history, bookmarks, recently closed tabs, your Moments and Sift's commands. All of it is matched on this device; nothing about it is sent anywhere.</p></div></div></div>`;
  },

  privacy: (b) => {
    const s = b.settings;
    return `<h2>Privacy</h2><p class="lede">What Sift does and doesn't do, stated plainly.</p>
    <div class="group"><div class="card">
      ${setting('Block known trackers', `Cancels requests to ${b.info?.trackerDomains || 'a list of'} known tracking and advertising domains when they're loaded by other sites. It's a domain list, not a full content blocker: some ads and trackers will still get through.`, toggle('trackers', s.trackers))}
      ${setting('Third-party cookies', 'Blocking stops sites embedded in other sites from recognising you across them. A few sign-in flows rely on them.', select('thirdPartyCookies', s.thirdPartyCookies, [['block', 'Block'], ['allow', 'Allow']]))}
      ${setting('Send "Do Not Track"', 'Asks sites not to track you. Most sites ignore it.', toggle('doNotTrack', s.doNotTrack))}
    </div></div>
    <div class="group"><h3>Clear browsing data</h3><div class="card">
      ${setting('History', `${b.history.length.toLocaleString()} pages in history, plus recently closed tabs.`, `${select('clearRange', '3600000', [['3600000', 'Last hour'], ['86400000', 'Last 24 hours'], ['604800000', 'Last 7 days'], ['Infinity', 'All time']])}<button class="btn danger" data-a="clearHistory">Clear</button>`)}
      ${setting('Cookies and site data', 'Signs you out of most sites.', '<button class="btn danger" data-a="clearCookies">Clear</button>')}
      ${setting('Cached files', 'Pages may load a little slower the first time afterwards.', '<button class="btn" data-a="clearCache">Clear</button>')}
    </div></div>
    <div class="group"><h3>What Sift stores</h3><div class="card"><div class="prose">
      <p><b>On this device only.</b> History, bookmarks, Moments, settings and your session are files in your profile folder <span class="mono">${esc(b.info?.dataDir || '')}</span>. Sift has no account and no sync, and sends no analytics.</p>
      <p><b>Private windows</b> keep cookies, cache and site data in memory and don't write history or session files. Your network provider and the sites you visit can still see your traffic.</p>
      <p><b>Network requests Sift makes on its own:</b> none by default. Search suggestions are opt-in (Search settings).</p></div></div></div>`;
  },

  permissions: (b) => {
    const entries = Object.entries(b.sitePerms);
    return `<h2>Site permissions</h2><p class="lede">Sites ask before using your camera, microphone, location or notifications. Your answers are remembered here.</p>
    <div class="group"><div class="card">${entries.length ? entries.map(([origin, perms]) => `
      <div class="site-perm"><span class="h">${esc(origin.replace(/^https?:\/\//, ''))}</span>
        <span class="p">${Object.entries(perms).map(([k, v]) => `<span class="pill ${v}">${esc(k)} · ${v === 'allow' ? 'allowed' : 'blocked'}</span>`).join('')}</span>
        <button class="btn ghost" data-forget="${esc(origin)}">Reset</button></div>`).join('')
      : '<div class="empty-note">No site has asked for a permission yet.</div>'}</div></div>`;
  },

  tabs: (b) => {
    const s = b.settings;
    return `<h2>Tabs & Moments</h2><p class="lede">Sift never closes or groups tabs on its own. These settings only change what happens when you ask.</p>
    <div class="group"><div class="card">
      ${setting('When Sift starts', '', select('startup', s.startup, [['restore', 'Reopen the tabs from last time'], ['newtab', 'Open a new tab']]))}
      ${setting('Put inactive tabs to sleep', 'Unloads tabs you haven\'t looked at for a while to save memory. They stay in the tab strip and reload when you click them. Pinned tabs and tabs playing media are never put to sleep.', select('sleepTabs', s.sleepTabs, [[0, 'Never'], [30, 'After 30 minutes'], [60, 'After 1 hour'], [240, 'After 4 hours']]))}
      ${setting('Confirm before closing many tabs', 'Asks first when an action would close more than 5 tabs.', toggle('confirmCloseMany', s.confirmCloseMany))}
    </div></div>
    <div class="group"><h3>Moments</h3><div class="card">
      ${setting('Saved Moments', `${b.moments.length} saved on this device.`, `<button class="btn" data-a="exportMoments">${icon('export')}Export</button><button class="btn" data-a="importMoments">${icon('import')}Import</button>`)}
    </div></div>`;
  },

  profiles: (b) => `<h2>Profiles</h2><p class="lede">Each profile has its own history, cookies, bookmarks and Moments, and opens in its own windows. No account needed.</p>
    <div class="group"><div class="card">${b.profiles.map((p) => setting(`${esc(p.name)}${p.id === b.info?.profile ? ' <span class="pill">This window</span>' : ''}`, `<code>${esc(p.id)}</code>`, p.id === b.info?.profile ? '' : `<button class="btn" data-open-profile="${esc(p.id)}">${icon('window')}Open</button>`)).join('')}
    ${setting('New profile', '', `<input class="text-input" style="width:200px" placeholder="Name" data-profile-name><button class="btn primary" data-a="addProfile">Create</button>`)}</div></div>`,

  import: () => `<h2>Import & export</h2><p class="lede">Bring your bookmarks from another browser. Sift reads them from that browser's profile folder on this device; nothing is uploaded.</p>
    <div class="group"><h3>Found on this device</h3><div class="card" data-sources><div class="empty-note">Looking for other browsers…</div></div></div>
    <div class="group"><h3>From a file</h3><div class="card">
      ${setting('Bookmarks HTML file', 'Every browser can export one: Safari, Firefox, Chrome, Edge, Arc.', `<button class="btn" data-a="importHtml">${icon('import')}Choose file…</button>`)}
      ${setting('Export bookmarks', 'As a standard bookmarks HTML file any browser can import.', `<button class="btn" data-a="exportHtml">${icon('export')}Export…</button>`)}
    </div></div>
    <div class="group"><h3>Not imported yet</h3><div class="card"><div class="prose"><p>History and saved passwords aren't imported in this version. Chromium-based browsers keep them in encrypted databases that need native support Sift doesn't have yet.</p></div></div></div>`,

  shortcuts: () => `<h2>Keyboard shortcuts</h2><p class="lede">Shortcuts work wherever the focus is, including inside web pages.</p>
    <div class="group"><div class="card"><table class="shortcut-table">${SHORTCUTS.map(([cat, rows]) => `<tr class="cat"><td colspan="2">${cat}</td></tr>${rows.map(([l, k]) => `<tr><td>${esc(l)}</td><td>${keycaps(k)}</td></tr>`).join('')}`).join('')}</table></div></div>`,

  about: (b) => `<div class="about-mark"><img src="assets/icon-256.png" alt=""><div><div class="wm" style="font-size:24px;font-weight:600;letter-spacing:-0.03em">Sift</div><div class="v">Version 0.1.0 (preview)</div></div></div>
    <div class="group"><div class="card"><div class="kv">
      <div>Engine</div><div>${esc(b.info?.engine || '')}</div>
      <div>Chromium</div><div>${esc(b.info?.chromium || '')}</div>
      <div>Profile</div><div>${esc(b.info?.profile || '')}</div>
      <div>Data folder</div><div>${esc(b.info?.dataDir || '')}</div>
      <div>Downloads</div><div>${esc(b.info?.downloadsDir || '')}</div>
      <div>Tracker list</div><div>${b.info?.trackerDomains || 0} domains</div>
    </div></div></div>
    <div class="group"><h3>Known limitations</h3><div class="card"><div class="prose">
      <p>Sift renders pages with Chromium through CEF. Chrome extensions and Chrome's built-in password manager aren't available in this build, and pages are shown with CEF's Alloy runtime. See docs/ARCHITECTURE.md for the details.</p></div></div></div>`,
};

async function onClick(app, e, section) {
  const b = app.browser;
  const t = e.target;
  const nav = t.closest('[data-section]')?.dataset.section;
  if (nav) return b.navigate(`sift://settings/${nav}`);
  const tg = t.closest('[data-toggle]');
  if (tg && !tg.disabled) return b.setSetting(tg.dataset.toggle, !b.settings[tg.dataset.toggle]);
  const theme = t.closest('[data-theme]')?.dataset.theme;
  if (theme) return b.setSetting('theme', theme);
  const density = t.closest('[data-density]')?.dataset.density;
  if (density) return b.setSetting('density', density);
  const forget = t.closest('[data-forget]')?.dataset.forget;
  if (forget) return b.forgetPermission(forget);
  const prof = t.closest('[data-open-profile]')?.dataset.openProfile;
  if (prof) return b.openProfile(prof);
  const src = t.closest('[data-import-source]')?.dataset.importSource;
  if (src) return importFromSource(app, src);
  const a = t.closest('[data-a]')?.dataset.a;
  const page = document.getElementById('page');
  switch (a) {
    case 'clearHistory': {
      const range = page.querySelector('[data-select="clearRange"]').value;
      const ms = range === 'Infinity' ? Infinity : Number(range);
      if (await confirmDialog(app, { title: 'Clear history?', body: `This removes ${ms === Infinity ? 'all of your history' : 'history from the selected period'} and the list of recently closed tabs. Bookmarks and Moments are kept.`, confirm: 'Clear history' })) {
        b.clearHistory(ms);
        b.showNotice({ text: 'History cleared', icon: 'trash' });
      }
      break;
    }
    case 'clearCookies':
      if (await confirmDialog(app, { title: 'Clear cookies and site data?', body: 'You will be signed out of most websites in this profile.', confirm: 'Clear cookies' })) {
        await b.bridge.send('data.clear', { cookies: true });
        b.showNotice({ text: 'Cookies cleared', icon: 'trash' });
      }
      break;
    case 'clearCache':
      await b.bridge.send('data.clear', { cache: true });
      b.showNotice({ text: 'Cache cleared', icon: 'check' });
      break;
    case 'addProfile': {
      const input = page.querySelector('[data-profile-name]');
      if (!input.value.trim()) return input.focus();
      const id = b.addProfile(input.value);
      b.openProfile(id);
      renderSettings(app, page, section);
      break;
    }
    case 'importHtml': {
      const file = await b.bridge.send('file.open', { title: 'Import bookmarks', filters: ['.html', '.htm'] }).catch(() => null);
      if (!file?.content) return;
      const n = b.addBookmarks(parseBookmarksHtml(file.content), 'Imported');
      b.showNotice({ text: `Imported ${n} bookmarks`, icon: 'import' });
      break;
    }
    case 'exportHtml':
      await b.bridge.send('file.save', { mode: 'save', title: 'Export bookmarks', name: 'sift-bookmarks.html', content: exportBookmarksHtml(b.bookmarks) });
      break;
    case 'exportMoments':
      await b.bridge.send('file.save', { mode: 'save', title: 'Export Moments', name: 'sift-moments.json', content: JSON.stringify({ version: 1, moments: b.moments }, null, 2) });
      break;
    case 'importMoments': {
      const file = await b.bridge.send('file.open', { title: 'Import Moments', filters: ['.json'] }).catch(() => null);
      if (!file?.content) return;
      try {
        const data = JSON.parse(file.content);
        const known = new Set(b.moments.map((m) => m.id));
        const add = (data.moments || []).filter((m) => m && m.id && Array.isArray(m.tabs) && !known.has(m.id));
        b.moments = [...add, ...b.moments];
        b.write('moments', b.moments);
        b.changed('moments');
        b.showNotice({ text: `Imported ${add.length} Moments`, icon: 'moments' });
      } catch {
        b.showNotice({ text: 'That file isn’t a Sift Moments export', icon: 'warning' });
      }
      break;
    }
  }
}

function onChange(app, e) {
  const sel = e.target.closest('[data-select]');
  if (!sel || sel.dataset.select === 'clearRange') return;
  const key = sel.dataset.select;
  const value = key === 'sleepTabs' ? Number(sel.value) : sel.value;
  app.browser.setSetting(key, value);
}

/** Fill the "found on this device" list for the import section. */
export async function loadImportSources(app, page) {
  const card = page.querySelector('[data-sources]');
  if (!card) return;
  const sources = await app.browser.bridge.send('import.sources').catch(() => []);
  app.importSources = sources || [];
  card.innerHTML = app.importSources.length
    ? app.importSources.map((s) => {
      let count = 0;
      try { count = parseChromiumBookmarks(s.bookmarks).length; } catch { /* unreadable */ }
      return setting(esc(s.name), `${count} bookmarks`, `<button class="btn" data-import-source="${esc(s.id)}">${icon('import')}Import</button>`);
    }).join('')
    : '<div class="empty-note">No other Chromium-based browser profiles found. Use a bookmarks file instead.</div>';
}

function importFromSource(app, id) {
  const s = (app.importSources || []).find((x) => x.id === id);
  if (!s) return;
  const n = app.browser.addBookmarks(parseChromiumBookmarks(s.bookmarks), s.name);
  app.browser.showNotice({ text: `Imported ${n} bookmarks from ${s.name}`, icon: 'import' });
}
