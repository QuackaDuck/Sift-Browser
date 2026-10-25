// macOS smoke test (CI), driven with real OS input (`cliclick`, from brew).
// Sift must be running with --remote-debugging-port=9222 and two web tabs.
//
// Checks:
// 1. The native traffic lights are vertically centred on Sift's tab row.
// 2. A click on a tab in the title bar selects it.
// 3. A click in the web page focuses the page, and the window still looks
//    active (web content lives in a child window on macOS).
// 4. Typing in the address bar shows results over the page.
// Screenshots are saved for people to look at.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };
const click = (x, y) => execFileSync('cliclick', [`c:${Math.round(x)},${Math.round(y)}`]);
const shot = (name) => execFileSync('screencapture', ['-x', name]);

// A 24/32-bit BMP from `screencapture -t bmp`, as { width, height, px(x, y) }.
// Coordinates are in screen pixels, which may be 2x screen points.
function grab() {
  execFileSync('screencapture', ['-x', '-t', 'bmp', 'grab.bmp']);
  const b = readFileSync('grab.bmp');
  const offset = b.readUInt32LE(10), width = b.readInt32LE(18), rawH = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
  const height = Math.abs(rawH), stride = Math.ceil((width * bpp) / 4) * 4;
  return {
    width, height,
    px(x, y) {
      const row = rawH > 0 ? height - 1 - y : y;
      const i = offset + row * stride + x * bpp;
      return [b[i + 2], b[i + 1], b[i]];
    },
  };
}

// Vertical centre (in points) of the red close button inside a box, or null.
function closeButtonY(img, scale, box) {
  let sum = 0, n = 0;
  for (let y = Math.round(box.y * scale); y < (box.y + box.h) * scale; y++) {
    for (let x = Math.round(box.x * scale); x < (box.x + box.w) * scale; x++) {
      const [r, g, b] = img.px(x, y);
      if (r > 200 && g < 130 && b < 130) { sum += y; n++; }
    }
  }
  return n > 10 ? sum / n / scale : null;
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('sift://app'));
if (!page) throw new Error('Sift UI page not found');
await page.waitForFunction(() => window.sift?.browser?.tabs?.length >= 2, null, { timeout: 30000 });
await sleep(1500);

const geo = await page.evaluate(() => {
  const b = window.sift.browser;
  const target = b.tabs.find((t) => t.id !== b.activeId);
  const r = document.querySelector(`.tab[data-id="${target.id}"]`).getBoundingClientRect();
  const row = document.getElementById('tabrow').getBoundingClientRect();
  const addr = document.getElementById('address').getBoundingClientRect();
  return {
    target: target.id, sx: window.screenX, sy: window.screenY, dpr: window.devicePixelRatio,
    tab: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
    rowMid: row.top + row.height / 2, chrome: b.chromeHeight,
    addr: { x: addr.left + 60, y: addr.top + addr.height / 2 },
    w: innerWidth, h: innerHeight,
  };
});
console.log('window at', geo.sx, geo.sy, 'size', geo.w, geo.h, 'dpr', geo.dpr);

// 1. Traffic lights centred on the tab row.
let img = grab();
const scale = img.width / (await page.evaluate(() => screen.width));
const lightsY = closeButtonY(img, scale, { x: geo.sx, y: geo.sy, w: 60, h: 70 });
check(lightsY !== null, 'native close button is visible and red (window active)');
if (lightsY !== null) {
  const off = lightsY - (geo.sy + geo.rowMid);
  check(Math.abs(off) <= 2, `traffic lights centred on the tab row (off by ${off.toFixed(1)}pt)`);
}

// 2. Clicking a tab in the title bar selects it.
click(geo.sx + geo.tab.x, geo.sy + geo.tab.y);
await sleep(800);
check((await page.evaluate(() => window.sift.browser.activeId)) === geo.target, 'tab click in the title bar selects the tab');
shot('click.png');

// 3. Clicking the page focuses it, and the window still looks active.
click(geo.sx + geo.w / 2, geo.sy + geo.chrome + 300);
await sleep(600);
const webPages = browser.contexts()[0].pages().filter((p) => !p.url().startsWith('sift://'));
const focused = await Promise.all(webPages.map((p) => p.evaluate(() => document.hasFocus()).catch(() => false)));
check(focused.some(Boolean), 'a click in the page gives the page focus');
img = grab();
check(closeButtonY(img, scale, { x: geo.sx, y: geo.sy, w: 60, h: 70 }) !== null, 'window still looks active while the page has focus');

// 4. Address bar results appear over the page. CI machines sometimes show a
// system prompt that takes keyboard focus, so make sure the address bar has
// it before typing.
let addressFocused = false;
for (let i = 0; i < 3 && !addressFocused; i++) {
  click(geo.sx + geo.addr.x, geo.sy + geo.addr.y);
  await sleep(400);
  addressFocused = await page.evaluate(() => document.hasFocus() && document.activeElement?.id === 'address');
}
check(addressFocused, 'a click in the address bar focuses it');
execFileSync('cliclick', ['t:exam']);
await sleep(900);
const results = await page.evaluate(() => ({
  surface: document.documentElement.dataset.surface,
  rows: document.querySelectorAll('#layer .omni-row, #layer [role="option"]').length,
}));
check(results.surface === 'cover' && results.rows > 0, `address bar results shown over the page (${results.rows} rows, ${results.surface})`);
shot('omnibox.png');
execFileSync('cliclick', ['kp:esc', 'kp:esc', 'kp:esc']);
await sleep(600);

// Hover the close button so the native glyphs show, for a person to check.
execFileSync('cliclick', [`m:${Math.round(geo.sx + 20)},${Math.round(lightsY ?? geo.sy + geo.rowMid)}`]);
await sleep(700);
shot('lights-hover.png');

await browser.close();
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('all macOS checks passed');
