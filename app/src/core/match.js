// Text matching used by the address bar, tab search and command list.
// Scores are deliberately simple and explainable: where a term matches
// matters more than how often it matches.

const WORD_BOUNDARY = /[\s\-_/.:?#&=+|·—–()[\]{}"'@,]/;

/**
 * Score how well every term matches `text`. Returns 0 when any term is
 * missing (all terms are required), else a positive score, plus the ranges
 * that matched so the UI can highlight them.
 */
export function matchText(text, terms) {
  if (!text) return { score: 0, ranges: [] };
  const hay = text.toLowerCase();
  let score = 0;
  const ranges = [];
  for (const term of terms) {
    const at = bestIndex(hay, term);
    if (at < 0) return { score: 0, ranges: [] };
    ranges.push([at, at + term.length]);
    if (at === 0) score += 3;
    else if (WORD_BOUNDARY.test(hay[at - 1])) score += 2;
    else score += 0.6;
    // Longer terms carry more signal.
    score += Math.min(term.length, 12) * 0.08;
  }
  return { score, ranges: mergeRanges(ranges) };
}

// Prefer a word-start occurrence over the first occurrence.
function bestIndex(hay, term) {
  let first = -1;
  let from = 0;
  while (true) {
    const i = hay.indexOf(term, from);
    if (i < 0) return first;
    if (first < 0) first = i;
    if (i === 0 || WORD_BOUNDARY.test(hay[i - 1])) return i;
    from = i + 1;
  }
}

export function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function terms(input) {
  return (input || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Initials match for short command abbreviations ("nw" -> "New Window"). */
export function initialsMatch(text, query) {
  const words = text.toLowerCase().split(/\s+/);
  const initials = words.map((w) => w[0]).join('');
  return query.length >= 2 && initials.startsWith(query.toLowerCase());
}
