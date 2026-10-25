// Sift UI entry point.

import { createBridge } from './bridge.js';
import { Browser } from './browser.js';
import { Layer } from './ui/layer.js';
import { renderTabRow, renderToolbar } from './ui/chrome-views.js';
import { renderNewTab } from './ui/newtab.js';
import { isInternal } from './core/url.js';
import { $ } from './ui/dom.js';

const browser = new Browser(createBridge());
const app = { browser };
app.layer = new Layer(app);
window.sift = app;

function render() {
  renderTabRow(app);
  renderToolbar(app);
  const tab = browser.active;
  if (tab && isInternal(tab.url) && tab.url.startsWith('sift://newtab')) renderNewTab(app);
  else $('#page').replaceChildren();
  app.layer.updateSurface();
}

browser.subscribe(render);
browser.init().then(render);
