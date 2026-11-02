// The browsers' search (Objects, Models, Pieces, Prefabs): what was typed, word by word, against an item's names, ranked
// by how well it matches. Before, a search was one piece of text looked for inside the names: "sink" found nothing (the
// game's sink is the class Faucet), "office chair" missed OfficeChair, a typo missed everything, and what matched
// stayed in the order of its category, the best match buried among the others (Gabby, 2 Nov 2026).
//
// words(text): its words, small letters, no accents: "OfficeChair_2" -> office chair 2.
// createSearch(text): null when nothing was typed, else { score(fields) }: fields [{ text, weight }] (an item's label
// weighs most, its tags, class and package less, its category least); 0 when a word typed matches none of them.

const FOLD = /[̀-ͯ]/g;
export function words(text) {
  return String(text ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .normalize('NFD').replace(FOLD, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
}

// true when at most `limit` edits apart (a letter more, less, changed, or two swapped)
function near(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j), before = null;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
      row.push(d); best = Math.min(best, d);
    }
    if (best > limit) return false;
    before = previous; previous = row;
  }
  return previous[b.length] <= limit;
}

// how well one word typed matches one word of a name: 0 none
function wordScore(typed, word) {
  if (word === typed) return 10;
  if (word.startsWith(typed)) return typed.length >= 3 || word.length <= 4 ? 7 : 4;
  if (typed.length >= 3 && word.includes(typed)) return 4;
  if (typed.length >= 4 && word.length >= 3) {
    const limit = typed.length >= 7 ? 2 : 1;
    if (near(typed, word, limit) || (word.length > typed.length && near(typed, word.slice(0, typed.length), limit))) return 2;
  }
  return 0;
}

export function createSearch(text) {
  const typed = words(text);
  if (!typed.length) return null;
  const whole = typed.join(' ');
  return {
    words: typed,
    score(fields) {
      const named = fields.map(f => ({ weight: f.weight ?? 1, words: words(f.text), joined: words(f.text).join('') }));
      let total = 0;
      for (const t of typed) {
        let best = 0;
        for (const f of named) {
          let s = 0;
          for (const w of f.words) s = Math.max(s, wordScore(t, w));
          // words written together in the name ("officechair", "trashcan"), or typed together ("trashcan" for Trash can)
          if (!s && t.length >= 4 && f.joined.includes(t)) s = 4;
          best = Math.max(best, s * f.weight);
        }
        if (!best) return 0;
        total += best;
      }
      // the name itself typed, or its start: first
      const label = named[0] ? named[0].words.join(' ') : '';
      if (label === whole) total += 20;
      else if (label.startsWith(whole)) total += 8;
      return total;
    },
  };
}

// the items that match, best first (equal ones keep their order): fieldsOf(item) gives its fields, boost(item) adds
// to its score (a favourite)
export function rank(items, search, fieldsOf, boost = () => 0) {
  const out = [];
  items.forEach((item, at) => {
    const s = search.score(fieldsOf(item));
    if (s > 0) out.push({ item, s: s + boost(item), at });
  });
  out.sort((a, b) => b.s - a.s || a.at - b.at);
  return out.map(x => x.item);
}
