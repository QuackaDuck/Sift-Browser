# Sift design notes

## Principles

1. **Don't make people learn a new way to browse.** Tabs are on top, the address bar is an address bar, back is back. Everything new is reachable from something familiar: tab search from the tab counter, Moments from the toolbar, split view from a tab's menu.
2. **One place to type.** The address bar does navigation, switching and actions. Ctrl/Cmd+K is the same field in Actions mode, not a second palette.
3. **Suggest, never act.** Tidy proposes and explains; Sift never closes, groups or sleeps tabs unless you ask (tab sleeping is opt-in). Every destructive action has an Undo or a confirmation.
4. **Chrome steps back.** Web pages get the space: 82 px of chrome by default. Sift's toasts live inside the toolbar, not over the page.
5. **Say what's true.** Privacy copy describes what the code does, including its limits ("It's a domain list, not a full content blocker").

## Visual language

- **Palette.** Neutral greys in five value steps (`--bg-0` to `--bg-4`) in both appearances, and no colour accent. Focus, selection, the active tab and primary buttons are shown with contrast (a lighter surface, a darker hairline, a heavier weight), the way macOS does it.
- **Lines over shadows.** Structure comes from hairlines and value steps. Shadows appear only on things that float: the active tab, menus, previews, tab search.
- **Rounded, not bubbly.** Fields, buttons, segmented controls and toggles are pills; icon buttons are circles; tabs use 11px corners; panels 18px.
- **Type.** The system font: SF Pro on macOS, Segoe UI Variable on Windows, and bundled Inter on Linux. There is no monospace anywhere. Chrome text stays at 13px or below; headings are sentence case at weight 600.
- **Icons.** A custom 16px set (`app/src/ui/icons.js`) with 1.4px strokes and round joins. The Sift mark is three bars of narrowing width, like a sieve.
- **A real Mac window** with native traffic lights, corners and shadow. Sift's tab row sits in the transparent title bar.

## Motion

- **The active tab is one surface that slides.** Switching tabs springs the highlight across (340 ms), rather than blinking one tab off and another on.
- **Tabs open by growing and close by collapsing,** and their neighbours slide over to make room.
- **The New Tab page settles in:** the search box, sections and site tiles fade up in a short stagger. It only animates when you arrive, not when its data refreshes.
- **Panels and the address bar results** scale in from just under their anchor (220 ms) and fade out faster than they arrive. Tab search grows from the centre.
- **Never in the way.** Nothing animates on navigation, and keyboard input is never delayed. Reduced-motion users get 1 ms durations.
- **Previews feel warm.** The first hover waits 520 ms; moving to the next tab within 700 ms shows its preview immediately.

## The states (see `screenshots/`)

| # | State | What to notice |
| --- | --- | --- |
| 01 | Normal browsing | compact tab strip with real favicons, host in white and path dimmed, shield showing blocked trackers |
| 02 | Address bar | inline completion ("fig" becomes figma.com), the search row one arrow-key away, "Switch to tab" pill, keyboard hints |
| 03 | Actions (Ctrl/Cmd+K) | same field, Actions chip, commands with their shortcuts |
| 04 | Tab search | recency-ordered list, highlighted matches, live thumbnail, Switch / Side by side / Close |
| 05 | Tidy | one suggestion per row, an explanation of what it will do, Review before acting |
| 06 | Tab preview | thumbnail, title, host, when last viewed |
| 07 | Split view | joined split tab in the strip, pane bar with the focused pane underlined, swap and exit |
| 08 | Save a Moment | suggested name, tabs to include, "close after saving" |
| 09 | Moments | stacked favicons, page count, sites, time; restore on click |
| 10 | Site panel | encryption state, the exact tracker domains blocked, permissions |
| 11 | New Tab | search field, frequently visited sites, recent Moments, quiet links. No feed, no clock |
| 12–15 | Settings and light appearance | |
| 16 | First run | import bookmarks, plus four shortcuts worth knowing |

## Key transitions

- **Address bar.** Focus selects the URL. Typing shows results. Arrows move through them (and show the URL in the field). Enter navigates and returns focus to the page. Escape first restores what you typed, then closes, then hands focus back to the page.
- **Actions.** Ctrl/Cmd+K, or typing `>` in an empty address bar, switches to Actions. Escape or Backspace in an empty field returns to the address bar.
- **Tab search.** The tab counter or Ctrl/Cmd+Shift+A opens it. Tab switches to Tidy. Review moves Tidy's tabs back into the list, preselected.
- **Into split view.** Drag a tab below the strip and drop zones appear. Drop, and the dragged tab takes that side with your most recent other tab beside it. Exit by closing a side or pressing Ctrl/Cmd+\\.
- **Moments.** Save with "close after saving" and the tabs disappear, with a toolbar notice and Undo. Restore and they come back in order, replacing a lone New Tab instead of leaving it behind.
