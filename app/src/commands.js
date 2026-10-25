// Every browser action in one registry. The address bar finds them by name
// (strong matches only), Cmd/Ctrl+K lists them, and keyboard shortcuts call
// them by id. One implementation per action.

import { isInternal } from './core/url.js';
import { tidySuggestions } from './core/cleanup.js';

export class Commands {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
  }

  list() {
    const b = this.b;
    const app = this.app;
    const t = b.focused;
    const web = t && !isInternal(t.url);
    const dupes = tidySuggestions(b.tabs, { activeId: b.activeId, visibleIds: b.visibleIds() }).find((s) => s.id === 'duplicates');
    const cmds = [
      { id: 'newTab', title: 'New Tab', icon: 'plus', shortcut: 'mod+t', keywords: ['open tab'], priority: 9, run: () => b.newTab() },
      { id: 'tabSearch', title: 'Search Tabs', icon: 'tabs', shortcut: 'mod+shift+a', keywords: ['find tab', 'switch', 'open tabs'], priority: 8, run: () => app.tabSearch.open() },
      { id: 'saveMoment', title: 'Save Tabs as Moment', icon: 'momentSave', shortcut: 'mod+shift+s', keywords: ['moment', 'session', 'save tabs', 'snapshot'], priority: 8, run: () => app.moments.openSave() },
      { id: 'moments', title: 'Show Moments', icon: 'moments', keywords: ['restore', 'sessions', 'saved'], priority: 7, run: () => app.moments.open() },
      b.isSplitVisible
        ? { id: 'exitSplit', title: 'Exit Split View', icon: 'split', shortcut: 'mod+\\', keywords: ['side by side', 'close split'], priority: 7, run: () => b.exitSplit() }
        : { id: 'split', title: 'Open Side by Side', icon: 'split', shortcut: 'mod+\\', hint: 'Split view with another tab', keywords: ['split view', 'compare', 'two pages'], priority: 7, run: () => app.toggleSplit() },
      b.isSplitVisible && { id: 'swapSplit', title: 'Swap Split Sides', icon: 'swap', keywords: ['split', 'flip'], run: () => b.swapSplit() },
      { id: 'tidy', title: 'Tidy Tabs', icon: 'tidy', hint: dupes ? dupes.title : 'Find duplicates and old tabs', keywords: ['clean up', 'duplicates', 'close old tabs'], priority: 5, run: () => app.tabSearch.open('tidy') },
      dupes && { id: 'closeDuplicates', title: 'Close Duplicate Tabs', icon: 'duplicate', hint: dupes.title, keywords: ['dedupe', 'duplicates'], run: () => b.closeTabs(dupes.tabIds, 'Closed duplicates') },
      { id: 'reopenTab', title: 'Reopen Closed Tab', icon: 'undo', shortcut: 'mod+shift+t', keywords: ['undo close', 'restore tab'], run: () => b.reopenClosed() },
      { id: 'closeTab', title: 'Close Tab', icon: 'close', shortcut: 'mod+w', run: () => app.closeActive() },
      { id: 'newWindow', title: 'New Window', icon: 'window', shortcut: 'mod+n', run: () => b.bridge.send('window.new', {}) },
      { id: 'privateWindow', title: 'New Private Window', icon: 'eyeOff', shortcut: 'mod+shift+n', keywords: ['incognito', 'private browsing'], run: () => b.bridge.send('window.new', { incognito: true }) },
      web && { id: 'bookmark', title: b.isBookmarked(t.url) ? 'Remove Bookmark' : 'Bookmark This Page', icon: 'star', shortcut: 'mod+d', keywords: ['favorite', 'save page'], run: () => b.toggleBookmark() },
      web && { id: 'pin', title: t.pinned ? 'Unpin Tab' : 'Pin Tab', icon: 'pin', keywords: ['pin'], run: () => b.setPinned(t.id, !t.pinned) },
      web && { id: 'duplicate', title: 'Duplicate Tab', icon: 'copy', run: () => b.duplicate(t.id) },
      web && { id: 'mute', title: t.muted ? 'Unmute Tab' : 'Mute Tab', icon: t.muted ? 'volume' : 'mute', keywords: ['sound', 'audio'], run: () => b.setMuted(t.id, !t.muted) },
      web && { id: 'copyUrl', title: 'Copy Page Link', icon: 'link', keywords: ['copy url', 'share'], run: () => { navigator.clipboard?.writeText(t.url); b.showNotice({ text: 'Link copied', icon: 'link' }); } },
      web && { id: 'find', title: 'Find in Page', icon: 'find', shortcut: 'mod+f', run: () => app.find() },
      web && { id: 'reload', title: 'Reload Page', icon: 'reload', shortcut: 'mod+r', run: () => b.reload() },
      web && { id: 'hardReload', title: 'Reload Ignoring Cache', icon: 'reload', shortcut: 'mod+shift+r', run: () => b.reload(undefined, true) },
      web && { id: 'zoomIn', title: 'Zoom In', icon: 'zoomIn', shortcut: 'mod+=', run: () => b.zoom(1) },
      web && { id: 'zoomOut', title: 'Zoom Out', icon: 'zoomIn', shortcut: 'mod+-', run: () => b.zoom(-1) },
      web && { id: 'zoomReset', title: 'Actual Size', icon: 'zoomIn', shortcut: 'mod+0', run: () => b.zoom(0) },
      web && { id: 'print', title: 'Print…', icon: 'print', shortcut: 'mod+p', run: () => b.bridge.send('tab.print', { id: t.id }) },
      web && { id: 'devtools', title: 'Developer Tools', icon: 'code', shortcut: 'mod+shift+i', keywords: ['inspect', 'console'], run: () => b.bridge.send('tab.devtools', { id: t.id }) },
      web && { id: 'viewSource', title: 'View Page Source', icon: 'code', shortcut: 'mod+u', run: () => b.newTab(`view-source:${t.url}`, { afterId: t.id }) },
      { id: 'history', title: 'History', icon: 'history', shortcut: 'mod+y', keywords: ['visited', 'past'], run: () => app.openInternal('sift://history') },
      { id: 'bookmarks', title: 'Bookmarks', icon: 'bookmark', keywords: ['favorites', 'saved pages'], run: () => app.openInternal('sift://bookmarks') },
      { id: 'downloads', title: 'Downloads', icon: 'download', shortcut: 'mod+j', run: () => app.openInternal('sift://downloads') },
      { id: 'settings', title: 'Settings', icon: 'sliders', shortcut: 'mod+,', keywords: ['preferences', 'options'], priority: 6, run: () => app.openInternal('sift://settings') },
      { id: 'privacy', title: 'Privacy Settings', icon: 'shield', keywords: ['trackers', 'cookies', 'clear data'], run: () => app.openInternal('sift://settings/privacy') },
      { id: 'clearData', title: 'Clear Browsing Data…', icon: 'trash', keywords: ['delete history', 'cookies', 'cache'], run: () => app.openInternal('sift://settings/privacy') },
      { id: 'import', title: 'Import Bookmarks', icon: 'import', keywords: ['chrome', 'safari', 'firefox', 'edge', 'migrate'], run: () => app.openInternal('sift://settings/import') },
      { id: 'theme', title: document.documentElement.dataset.theme === 'dark' ? 'Switch to Light Appearance' : 'Switch to Dark Appearance', icon: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', keywords: ['theme', 'dark mode', 'light mode', 'appearance'], run: () => b.setSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
      { id: 'trackers', title: b.settings.trackers ? 'Turn Off Tracker Blocking' : 'Turn On Tracker Blocking', icon: 'shield', keywords: ['privacy', 'ads'], run: () => b.setSetting('trackers', !b.settings.trackers) },
      { id: 'shortcuts', title: 'Keyboard Shortcuts', icon: 'keyboard', keywords: ['keys', 'hotkeys'], run: () => app.openInternal('sift://settings/shortcuts') },
      ...b.profiles.filter((p) => p.id !== b.info?.profile).map((p) => ({ id: `profile:${p.id}`, title: `Switch to ${p.name} Profile`, icon: 'user', hint: 'Opens a window for that profile', keywords: ['profile', 'account'], run: () => b.openProfile(p.id) })),
    ];
    return cmds.filter(Boolean);
  }

  run(id) {
    const cmd = this.list().find((c) => c.id === id);
    cmd?.run();
  }
}
