// Pure helpers for authentic texts such as song lyrics. Shared by the reading
// view, the cloze practice, and the server, so they must stay import-free.

export type PassageToken = { text: string; word: boolean };
export type PassageLine = { kind: "text" | "section" | "empty"; text: string; tokens: PassageToken[] };
export type ClozeLine = PassageLine & { slots: (number | undefined)[]; repeatOf?: number };
export type ClozeBlank = { answer: string; line: number; segment: number };
export type ClozeSegment = { lines: number[]; blanks: number[] };
export type Cloze = { lines: ClozeLine[]; blanks: ClozeBlank[]; segments: ClozeSegment[] };
// A fixed expression found when the text was saved: `text` as it appears in `line`, `phrase` its dictionary form.
export type PassagePhrase = { line: string; text: string; phrase: string };
export type PhraseSpan = { start: number; end: number; text: string; phrase: string };

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
// Interjections such as "ooh", "yeah", "na-na" are not worth memorising.
const FILLER = /^(?:o+h*|a+h+|u+h+|u+m+|m+|h+m+|ye+a*h+|yea+|he+y+|na+|la+|da+|doo+|wo+a*h*|who+a+|ha+|hee+|huh+)$/;
// Function words stay possible blanks, but content words are preferred.
const LIGHT = new Set("a an the and or but so if to of in on at by for from with as is am are was were be been being it its it's i i'm i'll i've i'd me my you you're you'll your he he's him his she she's her we we're us our they they're them their this that there then than do don't does did not no all just can can't will won't would could what when how who up out".split(" "));

export function isSectionLine(line: string): boolean { return /^\s*\[[^\]]*\]\s*$/.test(line); }

export function parsePassage(text: string): PassageLine[] {
  return text.split("\n").map(raw => {
    const line = raw.trim();
    if (!line) return { kind: "empty", text: "", tokens: [] };
    if (isSectionLine(line)) return { kind: "section", text: line, tokens: [] };
    const tokens: PassageToken[] = [];
    let last = 0;
    for (const match of line.matchAll(WORD)) {
      if (match.index > last) tokens.push({ text: line.slice(last, match.index), word: false });
      tokens.push({ text: match[0], word: true });
      last = match.index + match[0].length;
    }
    if (last < line.length) tokens.push({ text: line.slice(last), word: false });
    return { kind: "text", text: line, tokens };
  });
}

function lower(word: string) { return word.toLowerCase().replace(/’/g, "'"); }

// Locate fixed expressions as token ranges of a line, so tapping any of their
// words looks up the whole expression. Longer expressions win an overlap, and an
// expression is marked wherever it recurs in the line.
export function phraseSpans(line: PassageLine, phrases: Pick<PassagePhrase, "text" | "phrase">[]): PhraseSpan[] {
  const words = line.tokens.flatMap((token, index) => token.word ? [index] : []);
  const used = new Set<number>(), spans: PhraseSpan[] = [];
  const targets = phrases.map(item => ({ ...item, words: Array.from(item.text.matchAll(WORD), match => lower(match[0])) })).filter(item => item.words.length >= 2 && item.words.length <= 6).sort((a, b) => b.words.length - a.words.length);
  for (const target of targets) {
    for (let i = 0; i + target.words.length <= words.length; i++) {
      const range = words.slice(i, i + target.words.length);
      if (range.some(index => used.has(index)) || !range.every((index, n) => lower(line.tokens[index].text) === target.words[n])) continue;
      range.forEach(index => used.add(index));
      const start = range[0], end = range[range.length - 1];
      spans.push({ start, end, text: line.tokens.slice(start, end + 1).map(token => token.text).join(""), phrase: target.phrase });
      i += target.words.length - 1;
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

// Lines that differ only in case or punctuation count as the same lyric line.
export function lineKey(line: PassageLine): string { return line.tokens.filter(token => token.word).map(token => lower(token.text)).join(" "); }

export function blankable(word: string): boolean {
  const value = lower(word);
  return /\p{L}/u.test(value) && value.replace(/[^\p{L}\p{N}]/gu, "").length >= 2 && !value.split("-").every(part => FILLER.test(part));
}

export function clozeMatches(answer: string, expected: string): boolean {
  const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return !!key(answer) && key(answer) === key(expected);
}

// Stanzas are runs of text lines between empty lines and section labels, so each
// can be checked on its own. A long run (a text without breaks) is cut into even
// chunks of about six lines.
export function stanzas(lines: PassageLine[]): number[][] {
  const runs: number[][] = [];
  lines.forEach((line, index) => {
    if (line.kind !== "text") return;
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === index - 1) run.push(index); else runs.push([index]);
  });
  return runs.flatMap(run => {
    if (run.length <= 8) return [run];
    const parts = Math.ceil(run.length / 6);
    return Array.from({ length: parts }, (_, part) => run.slice(Math.round((part * run.length) / parts), Math.round(((part + 1) * run.length) / parts)));
  });
}

function choose(line: PassageLine, candidates: number[], count: number, random: () => number): Set<number> {
  const weights = new Map(candidates.map(index => [index, LIGHT.has(lower(line.tokens[index].text)) ? 0.35 : 1]));
  const chosen = new Set<number>();
  for (let n = 0; n < count && weights.size; n++) {
    let cursor = random() * [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    let pick = candidates.find(index => weights.has(index))!;
    for (const [index, weight] of weights) { cursor -= weight; if (cursor <= 0) { pick = index; break; } }
    chosen.add(pick); weights.delete(pick);
    // Discourage, but do not forbid, neighbouring blanks.
    const position = candidates.indexOf(pick);
    for (const neighbour of [candidates[position - 1], candidates[position + 1]]) if (weights.has(neighbour)) weights.set(neighbour, weights.get(neighbour)! * 0.2);
  }
  return chosen;
}

// Blank about `ratio` of the eligible words of each line. A repeated line is
// never blanked again: it mirrors the blanks of its first occurrence instead.
export function buildCloze(text: string, ratio: number, random: () => number = Math.random): Cloze {
  const lines = parsePassage(text);
  const seen = new Map<string, number>(), repeatOf = new Map<number, number>(), picks = new Map<number, Set<number>>();
  const pool: [number, number[]][] = [];
  lines.forEach((line, index) => {
    const key = lineKey(line);
    if (line.kind !== "text" || !key) return;
    const first = seen.get(key);
    if (first !== undefined) { repeatOf.set(index, first); return; }
    seen.set(key, index);
    const candidates = line.tokens.flatMap((token, position) => token.word && blankable(token.text) ? [position] : []);
    if (!candidates.length) return;
    pool.push([index, candidates]);
    // Stochastic rounding keeps the expected density even for short lines.
    picks.set(index, choose(line, candidates, Math.min(candidates.length, Math.floor(ratio * candidates.length + random())), random));
  });
  if (pool.length && ![...picks.values()].some(chosen => chosen.size)) {
    const [index, candidates] = pool[Math.floor(random() * pool.length)];
    picks.set(index, choose(lines[index], candidates, 1, random));
  }
  const segments: ClozeSegment[] = stanzas(lines).map(segment => ({ lines: segment, blanks: [] }));
  const segmentOf = new Map(segments.flatMap((segment, index) => segment.lines.map(line => [line, index] as const)));
  const blanks: ClozeBlank[] = [], slotsByLine = new Map<number, (number | undefined)[]>();
  const result = lines.map((line, index): ClozeLine => {
    const original = repeatOf.get(index);
    let slots: (number | undefined)[];
    if (original !== undefined) {
      const source = slotsByLine.get(original)!;
      const wordSlots = lines[original].tokens.flatMap((token, position) => token.word ? [source[position]] : []);
      let word = 0;
      slots = line.tokens.map(token => token.word ? wordSlots[word++] : undefined);
    } else {
      const chosen = picks.get(index);
      slots = line.tokens.map((token, position) => chosen?.has(position) ? blanks.push({ answer: token.text, line: index, segment: segmentOf.get(index)! }) - 1 : undefined);
    }
    slotsByLine.set(index, slots);
    return original === undefined ? { ...line, slots } : { ...line, slots, repeatOf: original };
  });
  blanks.forEach((blank, index) => segments[blank.segment].blanks.push(index));
  return { lines: result, blanks, segments };
}
