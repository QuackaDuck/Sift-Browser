# Sift architecture

Sift is two programs that talk over one narrow bridge:

- **The host** (`native/`, C++ on CEF 156 / Chromium 156) owns windows, web content, networking, downloads, permissions and files.
- **The UI** (`app/`, HTML/CSS/JS modules, no framework, no build step) owns every pixel of Sift's own interface and all browser state that isn't web content: tabs, history, bookmarks, Moments, settings.

The UI is itself a Chromium page, loaded from `sift://app/index.html` into a dedicated browser in each window.

## Window layout

```
CefWindow  (frameless; vertical BoxLayout)
├── spacer            height = the UI's chrome strip (tab row + toolbar [+ find bar] [+ split bar])
├── content panel     horizontal BoxLayout: [pane A] [6px divider] [pane B]
│                     one CefBrowserView per tab; only the visible pane(s) are shown
├── overlay: UI       CefBrowserView of sift://app, CEF_DOCKING_MODE_CUSTOM, bounds set by "surface"
└── overlay: status   native label for link-hover URLs (bottom left)
```

Tabs use CEF's **Alloy** runtime style. CEF allows only one Chrome-style browser view per window, and a browser needs several (each tab, plus the UI). The cost is that Chrome-only features (extensions, Chrome's password manager and autofill UI) aren't available. Getting them back would mean one Chrome-style view per window with tab switching done by swapping its contents, which rules out side-by-side panes, or building on Chromium's content layer directly instead of CEF.

## Surfaces: how the UI floats over web pages

Web content is drawn by the content views, and the UI is an overlay above them. CEF Views can't make a windowed browser transparent (tested; the background stays opaque), so the UI overlay has three sizes:

| Surface | UI bounds | Used for |
| --- | --- | --- |
| `strip` | the chrome strip only | normal browsing |
| `cover` | the whole window | address bar results, menus, tab search, Moments, previews, prompts, tab drag |
| `full` | the whole window, content views hidden | Sift's own pages (New Tab, Settings, Library) |

Going from `strip` to `cover`:

1. The UI asks the host for a `snapshot`. The host captures each visible pane with `Page.captureScreenshot` over the DevTools protocol, which takes about 80 ms.
2. The UI paints the captures as a backdrop in the exact pane rectangles and waits for the images to decode.
3. The UI asks for `surface: cover`, and the host grows the overlay. The panel is revealed only now, so it never flashes half-drawn.

The page under a cover is a still image, which is fine for something open for a few seconds. These snapshots also double as tab thumbnails for previews and tab search.

Growing the UI view has side effects that the UI handles explicitly:

- **Compositor animations stall.** An animation that started while the view was strip-sized doesn't resume, so the scrim waits for the cover.
- **Pointer capture is lost.** Tab drags therefore listen on `window`.
- **Synthetic pointer events arrive.** Chromium sends a pointer leave and a pointer move to the window centre, so hover previews ignore pointer events for a short settle period.

## The bridge

UI → host: `window.siftQuery({request: JSON.stringify({cmd, args})})`, which is CEF's message router renamed. Each command resolves with a JSON value. Host → UI: `window.__siftHost({type, data})` via `ExecuteJavaScript`.

| Commands (UI → host) | |
| --- | --- |
| `ready` | handshake; returns window id, profile, platform, engine versions, sizes |
| `tab.create {id,url,lazy,scroll}` `tab.navigate` `tab.back` `tab.forward` `tab.reload {hard}` `tab.stop` `tab.close` `tab.discard` | tab lifecycle; tab ids are minted by the UI |
| `layout {top, panes, ratio}` | chrome height and which tab(s) are visible |
| `surface {mode}` `snapshot` `thumbnail {id, scale}` | see above |
| `tab.zoom` `tab.find` `tab.findStop` `tab.print` `tab.devtools` `tab.mute` `tab.scroll` `tab.focus` `ui.focus` | page actions |
| `window.new {incognito, profile, urls}` `window.minimize` `window.maximize` `window.fullscreen` `window.close` | windows |
| `store.read/write {key, scope}` | JSON files in the profile (or app) folder |
| `download.cancel/pause/resume/open/reveal` `permission.respond` | |
| `fetch {url}` | GET without cookies; used only for opt-in search suggestions |
| `import.sources` `file.open` `file.save` `pref.set` `trackers.enabled` `data.clear` | |

| Events (host → UI) | |
| --- | --- |
| `tab.state` | url, title, favicon (as a data URL), loading, progress, back/forward, security, blocked trackers, errors, crashes, camera/mic in use |
| `tab.opened` | a page opened a tab (link with target=_blank, etc.); the popup browser is adopted so `window.opener` keeps working |
| `tab.closed` `tab.focused` `shortcut` `download` `permission` `find` `fullscreen` `window.state` `contextAction` `internalNavigation` | |

### Security of the bridge

- **Only the UI gets the bridge.** The renderer injects `siftQuery` only into main frames whose URL starts with `sift://app/`.
- **The host checks the source.** It also verifies that each query came from that window's UI browser and its main frame.
- **Web content can't reach `sift:`.** Tabs refuse navigations to `sift:` URLs; a user-initiated one is handed to the UI to show the internal page. The UI browser refuses to navigate anywhere but `sift://app/`.
- **The UI page is locked down.** `sift://app` responses carry a strict Content-Security-Policy with no network access and no frames.
- **Storage keys are restricted.** Keys are limited to `[A-Za-z0-9._-]` and can't contain `..`.
- **File opening is restricted.** `download.open` only opens files inside the downloads folder.
- **Preferences are allow-listed.** `pref.set` accepts only third-party cookie mode and Do Not Track.

## Keyboard shortcuts in web pages

`OnPreKeyEvent` on every content browser maps browser shortcuts (Ctrl/Cmd+L, T, W, K, Shift+A, …) to names and forwards them to the UI, so a focused page can't swallow them. Shortcuts pressed while the UI has focus are handled by the same function in `main.js`.

## State and storage

All of it is in the UI's `Browser` controller (`app/src/browser.js`) and written through `store.write` as JSON files:

```
<user data>/Profiles/<profile>/Sift/settings.json, history.json, bookmarks.json, moments.json, closed.json,
                                    permissions.json, session-w1.json
<user data>/sift-profiles.json
```

- **Private windows** use a CEF request context with no cache path, so cookies, cache and storage stay in memory. The host also refuses writes to `history`, `session-*` and `closed` from a private window, even if the UI were to ask.
- **Session restore** recreates tabs lazily: only the visible tab loads. The others load when you open them.
- **Tab sleeping** (off by default) closes background tabs' browsers and keeps their place in the strip.

## Tracker blocking

`ContentClient::OnBeforeResourceLoad` (IO thread) matches each subresource's host, and its parent domains, against `app/data/trackers.txt` (98 domains). It cancels the request unless the page itself is on that domain. Counts and domain names go to the UI and appear in the site panel. This is a deliberately small, explainable list, not a filter-list engine like uBlock Origin. Sift says so in the UI.

## Things to know when changing the host

- **Closing a tab closes only its browser.** `DoClose` returns true unless the window itself is closing; returning false would make CEF close the whole window.
- **Chained DevTools calls are posted.** DevTools results arrive in an observer callback, and a continuation that issues another call there trips a re-entrancy check, so continuations run in a posted task.
- **Flex changes need an invalidate.** Changing box-layout flex values doesn't re-lay out on its own, so `ApplyLayout` invalidates the content panel.
- **Label buttons need a delegate.** `CefLabelButton` must be created with a delegate; passing null crashes.
