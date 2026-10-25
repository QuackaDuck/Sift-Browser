# Sift architecture

Sift is two programs that talk over one narrow bridge:

- **The host** (`native/`, C++ on CEF 156 / Chromium 156) owns windows, web content, networking, downloads, permissions and files.
- **The UI** (`app/`, HTML/CSS/JS modules, no framework, no build step) owns every pixel of Sift's own interface and all browser state that isn't web content: tabs, history, bookmarks, Moments, settings.

The UI is itself a Chromium page, loaded from `sift://app/index.html` into a dedicated browser in each window.

## Window layout

```
CefWindow
├── UI browser        sift://app; fills the window and never resizes
├── overlay: content  below the chrome strip (tab row + toolbar [+ find bar] [+ split bar])
│                     horizontal BoxLayout: [pane A] [6px divider] [pane B]
│                     one CefBrowserView per tab; only the visible pane(s) are shown
└── overlay: status   native label for link-hover URLs (bottom left)
```

On macOS the window is a standard titled `NSWindow`, so it gets the native corners, shadow, traffic lights, resizing and full screen. It is built against the macOS 26 SDK, which gives it the Liquid Glass design; Sift's own title-bar sizes switch to Liquid Glass metrics on macOS 27 and later (an `NSProcessInfo` check). `window_mac.mm` makes the title bar transparent and lets the content run underneath it. The title bar is as tall as the tab row (`GetTitlebarHeight`), so the traffic lights centre on the tabs, and the UI is told where the lights end so the tabs start after them. On Windows and Linux the window is frameless and Sift draws the window controls.

Tabs use CEF's **Alloy** runtime style. CEF allows only one Chrome-style browser view per window, and a browser needs several (each tab, plus the UI). The cost is that Chrome-only features (extensions, Chrome's password manager and autofill UI) aren't available.

## Surfaces: how the UI floats over web pages

| Surface | Layout | Used for |
| --- | --- | --- |
| `strip` | web content shown below the chrome strip | normal browsing |
| `cover` | web content hidden behind a snapshot of itself | address bar results, menus, tab search, Moments, previews, prompts, tab drag |
| `full` | web content hidden | Sift's own pages (New Tab, Settings, Library) |

Going from `strip` to `cover`:

1. The UI asks the host for a `snapshot`. The host captures each visible pane with `Page.captureScreenshot` over the DevTools protocol, which takes about 80 ms.
2. The UI paints the captures as a backdrop in the exact pane rectangles.
3. After the backdrop has reached the screen, the UI asks for `surface: cover` and the host hides the content overlay. The picture is identical, so nothing visibly changes except the panel appearing.

The UI never changes size. Earlier versions resized the UI browser to switch surfaces, which cost a relayout and a stale frame each time, stalled compositor animations and dropped pointer capture. The content overlay leaves the tab row alone, so on macOS, where overlays are child windows, it never covers the traffic lights. The host keeps it hidden until the UI first reports its layout, so pages never load at the wrong size.

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
- **Focus crosses windows on macOS.** Web content is in a child window, so moving focus between the page and the UI also makes the right window key (`MakeKeyWindowFor`).
- **Flex changes need an invalidate.** Changing box-layout flex values doesn't re-lay out on its own, so `ApplyLayout` invalidates the content panel.
- **Views given a preferred size need a non-zero width.** CEF treats a size with a zero side as "no preference".
- **Label buttons need a delegate.** `CefLabelButton` must be created with a delegate; passing null crashes.
