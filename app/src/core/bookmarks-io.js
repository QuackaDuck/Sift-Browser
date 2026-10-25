// Import/export of bookmarks: Chromium "Bookmarks" JSON (Chrome, Edge,
// Brave, Arc, Vivaldi) and the Netscape HTML format every browser exports.

const ROOT_NAMES = new Set(['Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks', 'Mobile bookmarks', 'Favorites bar', 'Bookmarks Toolbar', 'Bookmarks Menu']);

export function parseChromiumBookmarks(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const out = [];
  const walk = (node, folder) => {
    if (!node) return;
    if (node.type === 'url' && /^https?:/i.test(node.url || '')) out.push({ url: node.url, title: node.name || node.url, folder });
    const next = node.type === 'folder' && node.name && !ROOT_NAMES.has(node.name) ? node.name : folder;
    for (const child of node.children || []) walk(child, next);
  };
  for (const root of Object.values(data.roots || {})) walk(root, '');
  return out;
}

/** Netscape bookmark file. A small tokenizer, so it runs without a DOM. */
export function parseBookmarksHtml(html) {
  const out = [];
  const folders = [];
  const re = /<(\/?)(DL|H3|A)\b([^>]*)>([^<]*)/gi;
  let pendingFolder = null;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, attrs, text] = m;
    const t = tag.toUpperCase();
    if (t === 'H3' && !close) pendingFolder = decode(text.trim());
    else if (t === 'DL' && !close) { folders.push(pendingFolder || ''); pendingFolder = null; }
    else if (t === 'DL' && close) folders.pop();
    else if (t === 'A' && !close) {
      const href = /HREF="([^"]*)"/i.exec(attrs)?.[1];
      if (href && /^https?:/i.test(href)) {
        const folder = folders.filter(Boolean).pop() || '';
        out.push({ url: decode(href), title: decode(text.trim()) || href, folder: ROOT_NAMES.has(folder) ? '' : folder });
      }
    }
  }
  return out;
}

export function exportBookmarksHtml(bookmarks) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const byFolder = new Map();
  for (const b of bookmarks) {
    const f = b.folder || '';
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(b);
  }
  const item = (b) => `    <DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.round((b.createdAt || Date.now()) / 1000)}">${esc(b.title)}</A>\n`;
  let body = '';
  for (const [folder, list] of byFolder) {
    if (!folder) { body += list.map(item).join(''); continue; }
    body += `    <DT><H3>${esc(folder)}</H3>\n    <DL><p>\n${list.map((b) => '  ' + item(b)).join('')}    </DL><p>\n`;
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${body}</DL><p>\n`;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
