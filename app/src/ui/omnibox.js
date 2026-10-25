// The address bar. One controller, two entry points: the toolbar field and
// the New Tab page's field. Cmd/Ctrl+K puts the same field into "actions"
// mode, so there is one place to type, not two competing command centres.

import { $, debounce, esc, favicon, h, highlight, keycaps } from './dom.js';
import { icon } from './icons.js';
import { KIND, rank } from '../core/omnibox.js';
import { hostOf } from '../core/url.js';
import { ago } from '../core/time.js';

const KIND_LABEL = {
  [KIND.NAVIGATE]: { text: 'Go to site', act: 'Open' },
  [KIND.SEARCH]: { text: '', act: 'Search' },
  [KIND.SUGGESTION]: { text: 'Search', act: 'Search' },
  [KIND.TAB]: { text: 'Switch to tab', act: 'Switch', icon: 'arrowRight' },
  [KIND.HISTORY]: { text: '', act: 'Open' },
  [KIND.BOOKMARK]: { text: 'Bookmark', act: 'Open', icon: 'bookmark' },
  [KIND.CLOSED]: { text: 'Recently closed', act: 'Reopen', icon: 'undo' },
  [KIND.MOMENT]: { text: 'Moment', act: 'Restore', icon: 'moments' },
  [KIND.COMMAND]: { text: '', act: 'Run' },
};

export class Omnibox {
  constructor(app) {
    this.app = app;
    this.b = app.browser;
    this.mode = 'address';
    this.results = [];
    this.index = 0;
    this.typed = '';
    this.suggestions = [];
    this.editing = false;
    this.fetchSuggestions = debounce((q) => this.loadSuggestions(q), 140);
    this.attach($('#address'), $('#omnibox'));
  }

  /** Bind to an input. The toolbar field is permanent; the NTP field re-binds on render. */
  attach(input, box) {
    input.addEventListener('focus', () => this.onFocus(input, box));
    input.addEventListener('blur', () => setTimeout(() => this.onBlur(input, box), 0));
    input.addEventListener('input', (e) => this.onInput(input, e));
    input.addEventListener('keydown', (e) => this.onKey(input, e));
    input.addEventListener('mousedown', () => { input._clicked = document.activeElement !== input; });
    input.addEventListener('mouseup', () => {
      // First click selects everything, like every browser does.
      if (input._clicked && input.selectionStart === input.selectionEnd) input.select();
      input._clicked = false;
    });
  }

  get isToolbar() { return this.input === $('#address'); }

  focus(opts = {}) {
    const ntpInput = $('.ntp-search input');
    const tab = this.b.active;
    const useNtp = !opts.command && ntpInput && tab?.url.startsWith('sift://newtab') && !this.b.isSplitVisible;
    const input = useNtp ? ntpInput : $('#address');
    this.setMode(opts.command ? 'command' : 'address');
    this.b.bridge.send('ui.focus');
    input.focus();
    if (opts.command) input.value = '';
    input.select();
    if (opts.command) this.update();
  }

  setMode(mode) {
    this.mode = mode;
    const box = $('#omnibox');
    $('.mode-chip', box).hidden = mode !== 'command';
    $('.site-btn', box).hidden = mode === 'command';
    $('#address').placeholder = mode === 'command'
      ? 'Type a command, or a Moment to restore…'
      : this.b.info?.incognito ? 'Search privately or enter address' : `Search ${this.b.engine.name} or enter address`;
  }

  onFocus(input, box) {
    this.input = input;
    this.box = box;
    this.editing = true;
    box.classList.add('is-focused');
    if (input === $('#address')) {
      const t = this.b.focused;
      const q = this.b.displayQuery(t);
      // Full URL while editing; the query for search pages.
      if (this.mode === 'address') input.value = q || (t && !t.url.startsWith('sift://newtab') ? t.url : '');
      input.classList.remove('has-display');
      input.select();
    }
    this.typed = input.value;
    if (this.mode === 'command') this.update();
  }

  onBlur(input, box) {
    if (document.activeElement === input) return;
    box.classList.remove('is-focused');
    if (this.input !== input) return;
    this.editing = false;
    this.close();
    if (this.mode === 'command') this.setMode('address');
    if (input === $('#address')) this.app.toolbar.renderDisplay(this.b.focused);
  }

  onInput(input, e) {
    this.typed = input.value.slice(0, input.selectionStart === input.value.length ? undefined : input.selectionStart);
    this.typed = input.value;
    // Only autocomplete while the user is adding characters at the end.
    const adding = e.inputType?.startsWith('insert') && input.selectionStart === input.value.length;
    this.update({ autocomplete: adding });
    if (this.mode === 'address' && this.b.settings.suggestions && !this.b.info?.incognito) this.fetchSuggestions(this.typed);
  }

  update(opts = {}) {
    const b = this.b;
    const { results, autocomplete } = rank(this.typed, {
      mode: this.mode,
      tabs: b.tabs,
      activeId: b.focusedId,
      history: b.history,
      bookmarks: b.bookmarks,
      closed: b.closed,
      moments: b.moments,
      commands: this.app.commands.list(),
      suggestions: this.typed.trim() ? this.suggestions.filter((s) => s.toLowerCase().startsWith(this.typed.trim().toLowerCase().slice(0, 1))) : [],
      engine: b.engine,
      limit: this.mode === 'command' ? 10 : 8,
    });
    this.results = results;
    this.index = 0;
    if (opts.autocomplete && autocomplete && this.typed.length >= 1) {
      const typedBare = this.typed.replace(/^https?:\/\//, '').replace(/^www\./, '');
      const completion = autocomplete.completion;
      if (completion.toLowerCase().startsWith(typedBare.toLowerCase()) && completion.length > typedBare.length) {
        const prefix = this.typed.slice(0, this.typed.length - typedBare.length);
        this.input.value = prefix + typedBare + completion.slice(typedBare.length);
        this.input.setSelectionRange(this.typed.length, this.input.value.length);
      }
    }
    if (!this.typed.trim() && this.mode === 'address' && !this.results.length) return this.close();
    this.render();
  }

  async loadSuggestions(q) {
    const engine = this.b.engine;
    if (!engine.suggest || !q.trim() || q.includes('://')) { this.suggestions = []; return; }
    try {
      const body = await this.b.bridge.send('fetch', { url: engine.suggest.replace('%s', encodeURIComponent(q)) });
      const data = JSON.parse(body);
      // DuckDuckGo "list" and OpenSearch formats are both [query, [suggestions...]].
      this.suggestions = Array.isArray(data?.[1]) ? data[1].slice(0, 5) : Array.isArray(data) ? data.map((x) => x.phrase).filter(Boolean).slice(0, 5) : [];
      if (this.typed === q && this.editing) {
        const keep = this.results[this.index]?.id;
        this.update();
        const i = this.results.findIndex((r) => r.id === keep);
        if (i >= 0) { this.index = i; this.render(); }
      }
    } catch {
      this.suggestions = [];
    }
  }

  // ---- rendering ------------------------------------------------------

  render() {
    if (!this.editing) return;
    let pop = this.app.layer.find('results')?.el;
    if (!pop) {
      pop = h('div', { class: 'pop results-pop', role: 'listbox' });
      pop.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the field
      pop.addEventListener('click', (e) => {
        const row = e.target.closest('.result');
        if (row) this.activate(this.results[Number(row.dataset.i)], { newTab: e.metaKey || e.ctrlKey || e.button === 1, shift: e.shiftKey });
      });
      pop.addEventListener('pointermove', (e) => {
        const row = e.target.closest('.result');
        if (row && Number(row.dataset.i) !== this.index) { this.index = Number(row.dataset.i); this.paintSelection(); }
      });
      this.app.layer.open({ id: 'results', el: pop, keepWithin: [this.box], toggleAnchor: false, onClose: () => { if (this.input && document.activeElement === this.input && this.mode !== 'command') this.input.blur(); } });
    }
    const r = this.box.getBoundingClientRect();
    const width = Math.max(r.width, Math.min(640, window.innerWidth - 16));
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    pop.style.top = `${r.bottom + 6}px`;

    if (!this.results.length) {
      pop.innerHTML = `<div class="results-empty">${this.mode === 'command' ? 'No matching command.' : 'Nothing found.'}</div>`;
      return;
    }
    let prevGroup = null;
    const rows = this.results.map((res, i) => {
      const group = groupOf(res);
      const start = prevGroup !== null && group !== prevGroup;
      prevGroup = group;
      return this.row(res, i, start);
    }).join('');
    const mac = document.documentElement.dataset.platform === 'mac';
    pop.innerHTML = `<div class="results">${rows}</div>
      <div class="results-foot">
        <span>${keycaps('up')}${keycaps('down')} Select</span>
        <span>${keycaps('enter')} Open</span>
        ${this.mode === 'address' ? `<span>${keycaps('mod+enter')} New tab</span>` : ''}
        <span class="grow"></span>
        ${this.mode === 'address' ? `<span>${keycaps('mod+k')} Actions</span>` : `<span>${keycaps('esc')} Back to address</span>`}
      </div>`;
    void mac;
    this.paintSelection();
  }

  row(res, i, groupStart) {
    const label = KIND_LABEL[res.kind] || {};
    let iconHtml;
    let title;
    let sub = '';
    let kind = '';
    switch (res.kind) {
      case KIND.SEARCH:
      case KIND.SUGGESTION:
        iconHtml = `<span class="r-icon is-glyph">${icon('search')}</span>`;
        title = esc(res.query);
        sub = `<span class="r-sub">${res.kind === KIND.SEARCH ? `Search ${esc(res.engine)}` : ''}</span>`;
        break;
      case KIND.COMMAND:
        iconHtml = `<span class="r-icon is-glyph">${icon(res.icon || 'command')}</span>`;
        title = highlight(res.title, res.titleRanges);
        sub = res.subtitle ? `<span class="r-sub">${esc(res.subtitle)}</span>` : '';
        kind = res.shortcut ? keycaps(res.shortcut) : '';
        break;
      case KIND.MOMENT:
        iconHtml = `<span class="r-icon is-glyph">${icon('moments')}</span>`;
        title = highlight(res.title, res.titleRanges);
        sub = `<span class="r-sub">${esc(res.subtitle)}</span>`;
        break;
      case KIND.NAVIGATE:
        iconHtml = `<span class="r-icon">${res.favicon ? `<img src="${esc(res.favicon)}" alt="">` : icon('globe')}</span>`;
        title = res.typed ? esc(res.title) : `<mark>${esc(res.title.slice(0, this.bareTyped().length))}</mark>${esc(res.title.slice(this.bareTyped().length))}`;
        sub = res.subtitle ? `<span class="r-sub">${esc(res.subtitle)}</span>` : '';
        break;
      default: {
        iconHtml = `<span class="r-icon">${favicon(res.url, res.favicon)}</span>`;
        title = highlight(res.title || hostOf(res.url), res.titleRanges);
        const when = res.kind === KIND.HISTORY && res.lastVisit ? ` · ${ago(res.lastVisit)}` : res.kind === KIND.CLOSED ? ` · closed ${ago(res.closedAt)}` : '';
        sub = `<span class="r-sub is-url">${esc(shortUrl(res.url))}${esc(when)}</span>`;
      }
    }
    if (!kind) {
      kind = `${label.text ? `<span class="${res.kind === KIND.TAB ? 'tag' : ''}">${label.icon && res.kind !== KIND.TAB ? icon(label.icon) : ''}${esc(label.text)}</span>` : ''}<span class="act">${keycaps('enter')}</span>`;
    }
    return `<div class="result${groupStart ? ' group-start' : ''}" role="option" data-i="${i}">
      ${iconHtml}<span class="r-text"><span class="r-title">${title}</span>${sub}</span>
      <span class="r-kind ${res.kind === KIND.TAB ? 'is-tab' : ''}">${kind}</span></div>`;
  }

  bareTyped() {
    return this.typed.replace(/^https?:\/\//, '').replace(/^www\./, '');
  }

  paintSelection() {
    const pop = this.app.layer.find('results')?.el;
    if (!pop) return;
    pop.querySelectorAll('.result').forEach((el, i) => {
      el.classList.toggle('is-selected', i === this.index);
      el.setAttribute('aria-selected', String(i === this.index));
      if (i === this.index) el.scrollIntoView({ block: 'nearest' });
    });
  }

  close() {
    this.app.layer.close('results', { reason: 'done' });
  }

  // ---- keyboard -------------------------------------------------------

  onKey(input, e) {
    const pop = this.app.layer.find('results');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pop) { this.typed = input.value; this.update(); return; }
      const n = this.results.length;
      if (!n) return;
      this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.paintSelection();
      const r = this.results[this.index];
      // Arrowing onto a URL shows it in the field, like a classic omnibox.
      if (this.mode === 'address' && r && r.kind !== KIND.COMMAND && r.kind !== KIND.MOMENT) {
        input.value = r.query || r.url || this.typed;
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = pop ? this.results[this.index] : null;
      const newTab = e.metaKey || e.ctrlKey || e.altKey;
      if (r && (this.index > 0 || input.value === this.typed || r.inline)) return this.activate(r, { newTab, shift: e.shiftKey });
      if (input.value.trim()) return this.go(input.value.trim(), { newTab });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.mode === 'command') {
        this.setMode('address');
        this.typed = '';
        input.value = '';
        this.close();
        if (!this.typed) input.blur();
        return;
      }
      if (input.value !== this.typed) { input.value = this.typed; this.update(); return; }
      if (pop) { this.close(); return; }
      input.blur();
      this.b.bridge.send('tab.focus', { id: this.b.focusedId });
      return;
    }
    if (e.key === 'Tab' && pop && this.input.selectionEnd > this.input.selectionStart) {
      // Accept the inline completion.
      e.preventDefault();
      this.typed = input.value;
      input.setSelectionRange(input.value.length, input.value.length);
      this.update();
      return;
    }
    if (e.key === 'Backspace' && this.mode === 'command' && !input.value) {
      e.preventDefault();
      this.setMode('address');
      this.update();
      return;
    }
    if (e.key === '>' && !input.value && this.mode === 'address') {
      e.preventDefault();
      this.setMode('command');
      this.update();
    }
  }

  // ---- actions --------------------------------------------------------

  finish() {
    this.close();
    const input = this.input;
    this.editing = false;
    this.setMode('address');
    input?.blur();
  }

  go(text, opts = {}) {
    this.finish();
    if (this.mode === 'command') return;
    this.b.navigate(text, { newTab: opts.newTab });
    this.app.focusContent();
  }

  activate(r, opts = {}) {
    if (!r) return;
    const b = this.b;
    this.finish();
    switch (r.kind) {
      case KIND.TAB:
        if (opts.newTab) b.newTab(r.url);
        else b.activate(r.tabId);
        break;
      case KIND.CLOSED: {
        const entry = b.closed.find((c) => c.closedAt === r.closedAt && c.url === r.url);
        if (entry && !opts.newTab) b.reopenClosed(entry);
        else b.navigate(r.url, { newTab: true });
        break;
      }
      case KIND.MOMENT: b.restoreMoment(r.momentId); break;
      case KIND.COMMAND: this.app.commands.run(r.commandId); return;
      default: b.navigate(r.url, { newTab: opts.newTab });
    }
    this.app.focusContent();
  }
}

function groupOf(r) {
  if (r.kind === KIND.SEARCH || r.kind === KIND.SUGGESTION) return 'search';
  if (r.kind === KIND.COMMAND || r.kind === KIND.MOMENT) return 'command';
  if (r.kind === KIND.NAVIGATE) return 'nav';
  return 'pages';
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return u.hostname.replace(/^www\./, '') + (path.length > 60 ? `${path.slice(0, 58)}…` : path);
  } catch {
    return url;
  }
}
