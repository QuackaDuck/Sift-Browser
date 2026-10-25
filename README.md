# Sift

**The web, without the mess.** Sift is a desktop web browser built on Chromium (via CEF). It keeps the browser you already know (address bar, tabs, back and forward, bookmarks, history, downloads) and makes the everyday parts faster and calmer.

![Sift with the address bar open](docs/screenshots/02-address.png)

## What's different

- **An address bar that knows your browser.** Type a few letters and one ranked list shows the site you mean (completed inline), open tabs to switch to, history, bookmarks, recently closed tabs, your Moments and browser actions. Arrow keys move, Enter goes, Escape backs out. Ctrl/Cmd+K puts the same field into **Actions** mode; there is no second command palette.
- **Tab search that works at 100 tabs.** Ctrl/Cmd+Shift+A, or click the tab counter. Search by title or address, see a live thumbnail of the selected tab, switch with Enter, select several with Space and close them or save them as a Moment. **Tidy** suggests closing duplicates and tabs you haven't opened in a week. It only suggests: nothing closes until you choose, and every close can be undone.
- **Moments.** Save a set of tabs under a name ("Website redesign", "Lisbon trip"), close them, and bring the whole set back later in the same order, with split view and scroll position where possible. Moments are local files: no account, no sync, no AI.
- **Side by side.** Ctrl/Cmd+\\, "Open Side by Side" in a tab's menu, or drag a tab down into the page. Two live pages with their own navigation, a resizable divider, a swap button and one click back to normal.
- **Hover previews.** Hover a tab for its title, address, when you last looked at it and a thumbnail.
- **Honest privacy.** Requests to a bundled list of known tracker domains are blocked, and the site panel shows exactly which domains were blocked on the page. Third-party cookies are blocked by default. Search suggestions, the only thing that would send your keystrokes anywhere, are off until you turn them on.

More screenshots are in [`docs/screenshots/`](docs/screenshots) and the design notes are in [`docs/DESIGN.md`](docs/DESIGN.md).

## Build and run

Sift is a C++ CEF host (`native/`) plus a UI written in plain HTML, CSS and JavaScript modules (`app/`) that the host loads from `sift://app/`.

```sh
scripts/build.sh            # downloads CEF 156 (~330 MB) into third_party/cef, then builds
build/Release/sift          # Linux; build/Release/sift.exe on Windows
```

Requirements: CMake 3.21+, a C++20 compiler, and on Linux the X11 development headers. CEF's binary distribution brings its own Chromium. Pass a URL to open it: `build/Release/sift https://example.com`. User data lives in `~/.config/sift` (Linux), `%LOCALAPPDATA%\Sift\User Data` (Windows) or `~/Library/Application Support/Sift` (macOS); set `SIFT_USER_DATA` to use another folder.

Other commands:

```sh
npm test                    # unit tests for the address bar ranking, tidy, Moments, URL handling, bookmark import/export
npm run preview             # serve the UI in an ordinary browser at http://localhost:4280 (see below)
```

`npm run preview` runs the same UI against a stand-in bridge that renders pages in iframes. It's for working on the interface only: many sites refuse to load in an iframe, and there are no downloads, permissions, tracker blocking or thumbnails. Real browsing needs the CEF build.

## What works, and what needs more engine work

Everything below was exercised in the CEF build on Linux (Chromium 156) while making this README, unless the table says otherwise.

| Area | Status |
| --- | --- |
| Browsing, back/forward/reload/stop, page zoom, find in page, print, view source, DevTools | Working (Chromium via CEF) |
| Address bar: inline completion, open tabs, history, bookmarks, closed tabs, Moments, actions | Working |
| Search engines (DuckDuckGo default; Google, Bing, Kagi, Startpage, Ecosia), opt-in suggestions | Working |
| Tabs: new, close, reopen closed, pin, reorder by drag, duplicate, mute, keyboard switching | Working |
| Tab search, multi-select, close/save selection, Tidy suggestions with undo | Working |
| Hover previews with page thumbnails | Working (thumbnails are captured through the DevTools protocol) |
| Moments: save, rename, restore (also into a new window), update, delete with undo, export/import | Working |
| Split view: two live panes, focus, resize, swap, exit, drag a tab into the page | Working |
| History, bookmarks, downloads (pause, resume, cancel, open, show in folder) | Working |
| Session restore (restored tabs load when you open them) and optional tab sleeping | Working |
| Permission prompts (location, camera, mic, notifications…) with per-site memory | Working |
| Tracker blocking (98-domain list), third-party cookie blocking, Do Not Track, clear data | Working |
| Private windows (separate in-memory profile) and multiple profiles | Working |
| Import bookmarks from Chrome, Edge, Brave, Arc, Vivaldi and Chromium profiles, or any bookmarks HTML file; export to HTML | Working (the browser-profile import found no profiles on the test machine, so it was only checked against the format parser) |
| Light and dark appearance, comfortable density | Working |
| Windows build | Code and CMake are in place; not built or run yet |
| macOS build (app bundle with helper apps) | CMake follows CEF's sample layout; not built or run yet |
| Chrome extensions | Not available. Sift's tabs use CEF's Alloy runtime, which CEF only allows several of in one window, and Alloy doesn't host extensions. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). |
| Built-in password manager, autofill | Not available (same reason). Third-party password managers would need extension support. |
| Importing history and saved passwords from other browsers | Not implemented |
| Sync | Not planned; Sift works without an account |

## Keyboard

| | Linux / Windows | macOS |
| --- | --- | --- |
| Address bar | Ctrl+L | ⌘L |
| Actions | Ctrl+K | ⌘K |
| Search tabs | Ctrl+Shift+A | ⇧⌘A |
| Save tabs as a Moment | Ctrl+Shift+S | ⇧⌘S |
| Side by side | Ctrl+\\ | ⌘\\ |
| New tab / close tab / reopen closed | Ctrl+T / Ctrl+W / Ctrl+Shift+T | ⌘T / ⌘W / ⇧⌘T |
| Next / previous tab, tab 1–8, last tab | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+1–8, Ctrl+9 | same with ⌘ for numbers |
| Find, bookmark, zoom | Ctrl+F, Ctrl+D, Ctrl+= / − / 0 | ⌘F, ⌘D, ⌘= / − / 0 |
| New window / private window | Ctrl+N / Ctrl+Shift+N | ⌘N / ⇧⌘N |
| Close any overlay | Esc | Esc |

Shortcuts work while a web page has focus: the host forwards them to the UI before the page sees them.

## Repository layout

```
app/          the UI: index.html, styles/, src/ (core/ is pure logic, ui/ is views), fonts, icons, tracker list
native/       the CEF host: window and layout, clients, sift:// scheme, storage, tracker matching
scripts/      fetch-cef.sh, build.sh, preview.mjs
tests/        node:test unit tests for app/src/core
docs/         ARCHITECTURE.md, DESIGN.md, screenshots/
```

Fonts: Inter and JetBrains Mono, both under the SIL Open Font License (`app/fonts/`).
