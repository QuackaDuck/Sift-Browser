// Sift's icon set: 16px grid, 1.4px strokes, round joins. Drawn for this
// product so every glyph shares the same weight and corner language.

const P = {
  back: '<path d="M9.5 3.5 5 8l4.5 4.5"/>',
  forward: '<path d="M6.5 3.5 11 8l-4.5 4.5"/>',
  reload: '<path d="M12.6 6.2A5 5 0 1 0 13 9"/><path d="M13 3v3.4H9.6"/>',
  stop: '<path d="m4.5 4.5 7 7m0-7-7 7"/>',
  close: '<path d="m4.5 4.5 7 7m0-7-7 7"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  search: '<circle cx="7.2" cy="7.2" r="4.2"/><path d="m10.4 10.4 2.8 2.8"/>',
  tabs: '<rect x="2.5" y="4.5" width="11" height="8.5" rx="2"/><path d="M5 2.5h6.5a2 2 0 0 1 2 2"/>',
  moments: '<rect x="2.5" y="5.5" width="8.5" height="8" rx="1.8"/><path d="M5 3.2h6.3a2 2 0 0 1 2 2v6.3"/><path d="M5.2 9.5h3.1"/>',
  momentSave: '<rect x="2.5" y="5.5" width="8.5" height="8" rx="1.8"/><path d="M5 3.2h6.3a2 2 0 0 1 2 2v6.3"/><path d="M6.75 7.6v3.8M4.85 9.5h3.8"/>',
  split: '<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M8 3v10"/>',
  swap: '<path d="M3 5.5h9.5L10 3M13 10.5H3.5L6 13"/>',
  download: '<path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7"/><path d="M3 13h10"/>',
  more: '<circle cx="3.6" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.4" cy="8" r=".9" fill="currentColor"/>',
  shield: '<path d="M8 2 3 3.8v4c0 3 2.2 5.2 5 6.2 2.8-1 5-3.2 5-6.2v-4L8 2Z"/>',
  shieldCheck: '<path d="M8 2 3 3.8v4c0 3 2.2 5.2 5 6.2 2.8-1 5-3.2 5-6.2v-4L8 2Z"/><path d="m5.8 8 1.6 1.6 2.8-3"/>',
  shieldOff: '<path d="M8 2 3 3.8v4c0 3 2.2 5.2 5 6.2 2.8-1 5-3.2 5-6.2v-4L8 2Z"/><path d="m2.5 2.5 11 11"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.6"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.6"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.8-1"/>',
  warning: '<path d="M8 2.6 14 13H2L8 2.6Z"/><path d="M8 6.8v2.6"/><circle cx="8" cy="11.1" r=".6" fill="currentColor"/>',
  globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5Z"/>',
  history: '<path d="M3 8a5 5 0 1 0 1.5-3.6"/><path d="M3 2.8v2.6h2.6"/><path d="M8 5.3V8l1.9 1.3"/>',
  bookmark: '<path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7v-11Z"/>',
  bookmarkFill: '<path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7v-11Z" fill="currentColor"/>',
  star: '<path d="m8 2.4 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5L8 2.4Z"/>',
  starFill: '<path d="m8 2.4 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5L8 2.4Z" fill="currentColor"/>',
  command: '<path d="M4.2 5.2 7 8l-2.8 2.8"/><path d="M8.5 11h3.3"/>',
  sliders: '<path d="M3 5h5.5M11.5 5H13M3 11h1.5M7.5 11H13"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>',
  eyeOff: '<path d="M2.5 8s2-4 5.5-4c1 0 1.9.3 2.7.8M13.5 8s-2 4-5.5 4c-1 0-1.9-.3-2.7-.8"/><path d="M6.6 9.4a2 2 0 0 1 2.8-2.8"/><path d="m2.8 13.2 10.4-10.4"/>',
  user: '<circle cx="8" cy="5.8" r="2.6"/><path d="M3 13.3c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6"/>',
  users: '<circle cx="6" cy="6" r="2.3"/><path d="M2 13c.6-2 2-3.2 4-3.2s3.4 1.2 4 3.2"/><path d="M10.2 3.9a2.3 2.3 0 0 1 0 4.2M11.6 9.9c1.2.4 2 1.4 2.4 3.1"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5"/><path d="M4.3 4.5 5 13h6l.7-8.5"/>',
  pencil: '<path d="m10.2 3.3 2.5 2.5L6 12.5H3.5V10l6.7-6.7Z"/>',
  pin: '<path d="M9.6 2.5 13.5 6.4l-1.8.6-2.6 2.6-.4 2.7L3.6 7.2l2.7-.4L8.9 4.2l.7-1.7Z"/><path d="M5.8 10.2 2.6 13.4"/>',
  unpin: '<path d="M9.6 2.5 13.5 6.4l-1.8.6-2.6 2.6-.4 2.7L3.6 7.2l2.7-.4L8.9 4.2l.7-1.7Z"/><path d="m2.5 2.5 11 11"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  external: '<path d="M9 2.5h4.5V7M13.3 2.7 7.5 8.5"/><path d="M11.5 9.5V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5h2.5"/>',
  sun: '<circle cx="8" cy="8" r="2.7"/><path d="M8 1.8v1.4M8 12.8v1.4M14.2 8h-1.4M3.2 8H1.8M12.4 3.6l-1 1M4.6 11.4l-1 1M12.4 12.4l-1-1M4.6 4.6l-1-1"/>',
  moon: '<path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6Z"/>',
  check: '<path d="m3.5 8.3 3 3 6-6.3"/>',
  chevronDown: '<path d="m4.5 6.3 3.5 3.5 3.5-3.5"/>',
  chevronRight: '<path d="m6.3 4.5 3.5 3.5-3.5 3.5"/>',
  chevronUp: '<path d="m4.5 9.8 3.5-3.5 3.5 3.5"/>',
  arrowRight: '<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>',
  arrowUpRight: '<path d="M5 11 11 5M6 5h5v5"/>',
  undo: '<path d="M4 6.5h6a3.5 3.5 0 0 1 0 7H6.5"/><path d="M6.5 4 4 6.5 6.5 9"/>',
  tidy: '<path d="M2.5 4h8M2.5 8h6M2.5 12h4"/><path d="m9.5 11 1.8 1.8L14 9.6"/>',
  duplicate: '<rect x="2.5" y="2.5" width="7.5" height="7.5" rx="1.6"/><rect x="6" y="6" width="7.5" height="7.5" rx="1.6"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.3"/>',
  window: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 6h12"/>',
  minimize: '<path d="M3.5 8h9"/>',
  maximize: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.2"/>',
  restore: '<rect x="3" y="5" width="8" height="8" rx="1.2"/><path d="M5.5 3H12a1 1 0 0 1 1 1v6.5"/>',
  puzzle: '<path d="M3 6h2.2a1.6 1.6 0 1 1 3.1 0H10.5v2.2a1.6 1.6 0 1 1 0 3.1V13.5H3V6Z"/>',
  key: '<circle cx="5.5" cy="10.5" r="2.7"/><path d="m7.4 8.6 5.6-5.6M11.2 4.8l1.6 1.6M9.8 6.2l1.2 1.2"/>',
  import: '<path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7"/><path d="M2.5 10.5v1.5A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  export: '<path d="M8 10.5V3M4.8 6 8 2.8 11.2 6"/><path d="M2.5 10.5v1.5A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  camera: '<rect x="2" y="4.5" width="9" height="7" rx="1.6"/><path d="m11 7 3-1.8v5.6L11 9"/>',
  mic: '<rect x="6" y="2.5" width="4" height="7" rx="2"/><path d="M3.8 8a4.2 4.2 0 0 0 8.4 0M8 12.2v1.5"/>',
  location: '<path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14Z"/><circle cx="8" cy="6.5" r="1.5"/>',
  bell: '<path d="M4.2 11V7.3a3.8 3.8 0 0 1 7.6 0V11l1.2 1.2H3L4.2 11Z"/><path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0"/>',
  clipboard: '<rect x="3.5" y="3" width="9" height="11" rx="1.6"/><path d="M6 3V2.2h4V3"/>',
  volume: '<path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3V6.2Z"/><path d="M10.6 6a2.8 2.8 0 0 1 0 4M12.2 4.4a5 5 0 0 1 0 7.2"/>',
  mute: '<path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3V6.2Z"/><path d="m10.8 6.2 3.2 3.6M14 6.2l-3.2 3.6"/>',
  zoomIn: '<circle cx="7.2" cy="7.2" r="4.2"/><path d="m10.4 10.4 2.8 2.8M7.2 5.5v3.4M5.5 7.2h3.4"/>',
  find: '<circle cx="7.2" cy="7.2" r="4.2"/><path d="m10.4 10.4 2.8 2.8"/>',
  print: '<path d="M4.5 6V2.5h7V6"/><rect x="2.5" y="6" width="11" height="5.5" rx="1.4"/><path d="M4.5 9.5h7v4h-7z"/>',
  code: '<path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5"/>',
  folder: '<path d="M2.5 4.5a1.5 1.5 0 0 1 1.5-1.5h2.6l1.4 1.5H12a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-7Z"/>',
  file: '<path d="M4 2.5h5l3 3v8H4v-11Z"/><path d="M9 2.5v3h3"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  play: '<path d="M5 3.5 12.5 8 5 12.5v-9Z"/>',
  keyboard: '<rect x="1.8" y="4" width="12.4" height="8" rx="1.6"/><path d="M4.3 6.6h.01M6.5 6.6h.01M8.7 6.6h.01M10.9 6.6h.01M5 9.6h6"/>',
  info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.3v3.4"/><circle cx="8" cy="5.2" r=".6" fill="currentColor"/>',
  database: '<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8"/>',
  paint: '<circle cx="8" cy="8" r="5.5"/><circle cx="6" cy="6.3" r=".8" fill="currentColor"/><circle cx="9.8" cy="5.8" r=".8" fill="currentColor"/><circle cx="5.4" cy="9.6" r=".8" fill="currentColor"/><path d="M10 13.2c-.7-.9-.4-2.4 1.1-2.4h2.2"/>',
  power: '<path d="M8 2.5v5"/><path d="M4.6 4.6a4.8 4.8 0 1 0 6.8 0"/>',
  sparkle: '<path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2"/>',
  home: '<path d="M2.8 7.2 8 2.8l5.2 4.4"/><path d="M4.2 6.2v7.3h7.6V6.2"/>',
  link: '<path d="M7 9a2.5 2.5 0 0 0 3.6.1l2-2a2.5 2.5 0 0 0-3.6-3.6l-.8.8"/><path d="M9 7a2.5 2.5 0 0 0-3.6-.1l-2 2a2.5 2.5 0 0 0 3.6 3.6l.8-.8"/>',
  grip: '<circle cx="6" cy="4" r=".8" fill="currentColor"/><circle cx="10" cy="4" r=".8" fill="currentColor"/><circle cx="6" cy="8" r=".8" fill="currentColor"/><circle cx="10" cy="8" r=".8" fill="currentColor"/><circle cx="6" cy="12" r=".8" fill="currentColor"/><circle cx="10" cy="12" r=".8" fill="currentColor"/>',
  dot: '<circle cx="8" cy="8" r="2" fill="currentColor"/>',
  // The Sift mark: a planet, its sunlit limb at the top right.
  sift: '<circle cx="8" cy="8" r="5.7" fill="currentColor" stroke="none" opacity=".22"/><path d="M2.211 6.421A6 6 0 1 1 9.579 13.789A5.4 5.4 0 1 0 2.211 6.421Z" fill="currentColor" stroke="none"/>',
};

export function icon(name, cls = '') {
  const body = P[name];
  if (!body) return '';
  return `<svg class="i i-${name} ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The wordmark: dotless "sıft" in Inter with the tittle replaced by an accent square. */
export function wordmark(cls = '') {
  return `<svg class="${cls}" viewBox="0 0 72 28" aria-label="Sift" role="img">
    <text x="0" y="22" fill="currentColor" font-family="Inter, sans-serif" font-size="26" font-weight="620" letter-spacing="-1.3">sıft</text>
    <rect x="15.2" y="2.6" width="4.4" height="4.4" rx="1" fill="var(--accent)"/>
  </svg>`;
}
