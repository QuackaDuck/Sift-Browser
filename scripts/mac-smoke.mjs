// macOS smoke test (CI): checks that Sift's UI loaded inside a real titled
// window and that a real mouse click on a tab in the title-bar area selects
// that tab. Sift must be running with --remote-debugging-port=9222 and at
// least two tabs. Needs `cliclick` (brew) for OS-level clicks.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('sift://app'));
if (!page) throw new Error('Sift UI page not found');
await page.waitForFunction(() => window.sift?.browser?.tabs?.length >= 2, null, { timeout: 30000 });
await sleep(1500);

const info = await page.evaluate(() => {
  const b = window.sift.browser;
  const target = b.tabs.find((t) => t.id !== b.activeId);
  const el = document.querySelector(`.tab[data-id="${target.id}"]`);
  const r = el.getBoundingClientRect();
  return { target: target.id, before: b.activeId, x: window.screenX + r.left + r.width / 2, y: window.screenY + r.top + r.height / 2 };
});
console.log('clicking tab at', Math.round(info.x), Math.round(info.y));
execFileSync('cliclick', [`c:${Math.round(info.x)},${Math.round(info.y)}`]);
await sleep(800);
const after = await page.evaluate(() => window.sift.browser.activeId);
execFileSync('screencapture', ['-x', 'click.png']);
await browser.close();
if (after !== info.target) {
  console.error(`Tab click did not select the tab (active ${after}, expected ${info.target})`);
  process.exit(1);
}
console.log('Tab click in the title bar selects the tab');
