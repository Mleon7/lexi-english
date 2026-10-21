import test from "node:test";
import assert from "node:assert/strict";
import { blankable, buildCloze, clozeMatches, parsePassage, phraseSpans, rebreakLines, stanzas } from "../lib/cloze.ts";

const song = "[Chorus]\nI'm gonna make a change, for once in my life\nIt's gonna feel real good\n\nI'm Gonna Make A Change — for once in my life!\n(Ooh, yeah)\nIt's gonna feel real good";
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

test("passages keep section labels, stanza breaks, and lyric contractions", () => {
  const lines = parsePassage(song);
  assert.deepEqual(lines.map(line => line.kind), ["section", "text", "text", "empty", "text", "text", "text"]);
  assert.deepEqual(lines[1].tokens.filter(token => token.word).map(token => token.text), ["I'm", "gonna", "make", "a", "change", "for", "once", "in", "my", "life"]);
  assert.equal(lines[1].tokens.map(token => token.text).join(""), lines[1].text);
});

test("a repeated line is never blanked again and mirrors its first occurrence", () => {
  for (let seed = 1; seed < 40; seed++) {
    const cloze = buildCloze(song, 0.5, seeded(seed));
    assert.equal(cloze.lines[4].repeatOf, 1); assert.equal(cloze.lines[6].repeatOf, 2);
    assert.ok(cloze.blanks.every(blank => blank.line !== 4 && blank.line !== 6));
    const words = line => cloze.lines[line].slots.filter((_, i) => cloze.lines[line].tokens[i].word);
    assert.deepEqual(words(4), words(1)); assert.deepEqual(words(6), words(2));
    assert.ok(cloze.lines[0].slots.length === 0 && cloze.lines[5].slots.every(slot => slot === undefined));
    assert.deepEqual(cloze.blanks.map(blank => blank.line), [...cloze.blanks.map(blank => blank.line)].sort((a, b) => a - b));
  }
});

test("density follows the chosen ratio and every text gets at least one blank", () => {
  const text = Array.from({ length: 40 }, (_, i) => `Walking line number ${i} under silver morning skies again`).join("\n");
  const count = ratio => buildCloze(text, ratio, seeded(7)).blanks.length;
  const eligible = 40 * 8;
  assert.ok(Math.abs(count(0.15) / eligible - 0.15) < 0.05);
  assert.ok(Math.abs(count(0.5) / eligible - 0.5) < 0.06);
  assert.equal(buildCloze("Hold on", 0, seeded(3)).blanks.length, 1);
  assert.equal(buildCloze("Ooh, yeah, na-na\n[Bridge]", 0.5, seeded(3)).blanks.length, 0);
});

test("fillers and single letters are skipped; answers ignore case and apostrophes", () => {
  assert.equal(blankable("Ooh"), false); assert.equal(blankable("na-na"), false); assert.equal(blankable("Whoa"), false); assert.equal(blankable("a"), false);
  assert.equal(blankable("change"), true); assert.equal(blankable("I'm"), true); assert.equal(blankable("do"), true);
  assert.ok(clozeMatches(" im ", "I'm")); assert.ok(clozeMatches("Don’t", "don't")); assert.ok(!clozeMatches("", "a")); assert.ok(!clozeMatches("make", "made"));
});

test("stanzas split at empty lines and section labels, and long runs are chunked", () => {
  assert.deepEqual(stanzas(parsePassage(song)), [[1, 2], [4, 5, 6]]);
  const lines = n => Array.from({ length: n }, (_, i) => `Line ${i} goes on`).join("\n");
  assert.deepEqual(stanzas(parsePassage(lines(8))).map(part => part.length), [8]);
  assert.deepEqual(stanzas(parsePassage(lines(9))).map(part => part.length), [5, 4]);
  assert.deepEqual(stanzas(parsePassage(lines(20))).map(part => part.length), [5, 5, 5, 5]);
  assert.deepEqual(stanzas(parsePassage(`[Intro]\n${lines(2)}\n[Verse]\n${lines(3)}`)), [[1, 2], [4, 5, 6]]);
  for (let seed = 1; seed < 20; seed++) {
    const cloze = buildCloze(song, 0.5, seeded(seed));
    assert.deepEqual(cloze.segments.map(segment => segment.lines), [[1, 2], [4, 5, 6]]);
    assert.deepEqual(cloze.segments.flatMap(segment => segment.blanks), cloze.blanks.map((_, index) => index));
    assert.ok(cloze.blanks.every((blank, index) => cloze.segments[blank.segment].blanks.includes(index) && cloze.segments[blank.segment].lines.includes(blank.line)));
    assert.equal(cloze.segments[1].blanks.length, 0);
  }
});

test("marked expressions become single tap targets, longest first, wherever they recur", () => {
  const [line] = parsePassage("I came across you, Came Across the sea and gave it up");
  const spans = phraseSpans(line, [{ text: "came across", phrase: "come across" }, { text: "gave it up", phrase: "give up" }, { text: "across", phrase: "across" }, { text: "the river", phrase: "the river" }]);
  assert.deepEqual(spans.map(span => [span.text, span.phrase]), [["came across", "come across"], ["Came Across", "come across"], ["gave it up", "give up"]]);
  assert.equal(line.tokens.slice(spans[2].start, spans[2].end + 1).map(token => token.text).join(""), "gave it up");
  const [overlap] = parsePassage("Don't give up on me");
  assert.deepEqual(phraseSpans(overlap, [{ text: "give up", phrase: "give up" }, { text: "give up on", phrase: "give up on" }]).map(span => span.text), ["give up on"]);
  const [lyric] = parsePassage("We're makin’ it through");
  assert.deepEqual(phraseSpans(lyric, [{ text: "makin' it", phrase: "make it" }]).map(span => span.text), ["makin’ it"]);
});

test("only the model's line breaks are taken over, never its words", () => {
  const pasted = "[Verse]\nI'm gonna make a change\nfor once in my life. It's gonna feel\nreal good\n\nFirst sentence. Second one!";
  const split = rebreakLines(pasted, ["[Verse]", "im gonna make a change for once in my life", "Its gonna feel real good.", "", "First sentence.", "Second one!"]);
  assert.equal(split.text, "[Verse]\nI'm gonna make a change for once in my life.\nIt's gonna feel real good\n\nFirst sentence.\nSecond one!");
  assert.equal(split.matched, split.words);
  const article = rebreakLines("One. Two words. Three", ["One.", "", "Two words.", "Three"]);
  assert.equal(article.text, "One.\n\nTwo words.\nThree");
  // A line the model left out keeps its own breaks, and nothing is joined onto it.
  assert.equal(rebreakLines("Hello there\nHow are you\nGoodbye now", ["Hello there Goodbye now"]).text, "Hello there\nHow are you\nGoodbye now");
  const unrelated = rebreakLines("One two three", ["Something else entirely", 42]);
  assert.deepEqual([unrelated.text, unrelated.matched], ["One two three", 0]);
});
