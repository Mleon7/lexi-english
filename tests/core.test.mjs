import test from "node:test";
import assert from "node:assert/strict";
import { AppError, chooseWeighted, dictationCheck, dictationScore, isCopied, reviewWeight } from "../lib/server/core.ts";

test("dictation accepts capitalization, spacing, punctuation, and curly apostrophes", () => {
  assert.equal(dictationScore("  DON'T lose   your focus! ", "Don’t lose your focus."), 100);
});

test("dictation reports missing and substituted words without exposing answer text", () => {
  assert.equal(dictationScore("Please keep your", "Please keep your focus."), 75);
  assert.equal(dictationScore("Please keep my focus", "Please keep your focus."), 75);
  assert.equal(dictationScore("Please really keep your focus", "Please keep your focus."), 80);
  assert.equal(dictationScore("", "Please keep your focus."), 0);
  assert.equal(dictationScore("Completely unrelated words here", "Please keep your focus."), 0);
});

test("dictation marks wrong, extra, and missing words inside the learner's own text", () => {
  const marked = (answer, original) => dictationCheck(answer, original).marks.map(({ start, end }) => start === end ? `^${start}` : answer.slice(start, end));
  assert.deepEqual(marked("  DON'T lose your Focus! ", "Don’t lose your focus."), []);
  assert.deepEqual(marked("Please keep my focus", "Please keep your focus."), ["my"]);
  assert.deepEqual(marked("Please really keep your focus", "Please keep your focus."), ["really"]);
  assert.deepEqual(marked("Please keep your.", "Please keep your focus."), ["^16"]);
  assert.deepEqual(marked("keep your focus", "Please keep your focus."), ["^0"]);
  assert.deepEqual(marked("Please my", "Please keep your focus."), ["^6", "^6", "my"]);
  assert.deepEqual(marked("Please really keep my.", "Please keep your focus."), ["really", "^18", "my"]);
  assert.equal(dictationCheck("Please keep my focus", "Please keep your focus.").score, 75);
});

test("successful mastery lowers sampling weight while learned meanings stay eligible", () => {
  assert.ok(reviewWeight(0) > reviewWeight(30));
  assert.ok(reviewWeight(30) > reviewWeight(60));
  assert.ok(reviewWeight(60) > reviewWeight(100));
  assert.ok(reviewWeight(100) > 0);
  assert.equal(reviewWeight(-10), reviewWeight(0));
  assert.equal(reviewWeight(120), reviewWeight(100));
});

test("weighted sampling keeps the mastered meaning possible but substantially rarer", () => {
  const meanings = [{ id: "new-meaning", mastery: 0 }, { id: "mastered-meaning", mastery: 100 }];
  const counts = { "new-meaning": 0, "mastered-meaning": 0 };
  for (let n = 0; n < 1000; n++) counts[chooseWeighted(meanings, (n + 0.5) / 1000).id]++;
  assert.ok(counts["mastered-meaning"] > 0);
  assert.ok(counts["new-meaning"] > 10 * counts["mastered-meaning"]);
  assert.equal(chooseWeighted(meanings, 0).id, "new-meaning");
  assert.equal(chooseWeighted(meanings, 0.999999).id, "mastered-meaning");
});

test("equal mastery gives different meanings equal opportunity", () => {
  const meanings = [{ id: "focus-attention", mastery: 20 }, { id: "focus-camera", mastery: 20 }];
  assert.equal(chooseWeighted(meanings, 0.25).id, "focus-attention");
  assert.equal(chooseWeighted(meanings, 0.75).id, "focus-camera");
});

test("review cannot start with an empty learned vocabulary", () => {
  assert.throws(() => chooseWeighted([]), error => error instanceof AppError && error.code === "NO_LEARNED_WORDS");
});

test("copied sentences and cosmetic changes do not count as original production", () => {
  const originals = ["I need to focus on finishing my homework before dinner."];
  assert.equal(isCopied("I need to focus on finishing my homework before dinner.", originals), true);
  assert.equal(isCopied("I NEED to focus on finishing my homework before dinner!", originals), true);
  assert.equal(isCopied("I need to focus on finishing my report before dinner.", originals), true);
});

test("new use in a different scenario is not rejected merely for sharing the target word", () => {
  const originals = ["I need to focus on finishing my homework before dinner."];
  assert.equal(isCopied("During the match, our goalkeeper kept her focus on the ball.", originals), false);
  assert.equal(isCopied("During the match, our goalkeeper kept her focus on the ball.", []), false);
});
