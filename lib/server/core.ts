import type { PassagePhrase } from "../cloze";

export type MaterialKind = "description" | "example" | "synonym" | "antonym";
export type Material = {
  id: string; kind: MaterialKind; text: string; term?: string; relationNote?: string;
  translation?: string; source?: string; practice?: "writing" | "review"; exerciseId?: string;
  scene?: { title: string; description: string; imageUrl?: string; objectKey?: string; mimeType?: string; model?: string; emoji?: string; background?: string; foreground?: string };
};
export type Sense = {
  id: string; word: string; phonetic: string; pos: string; meaning: string; definition: string; frequency: number;
  learned: boolean; mastery: number; reviewCount: number; createdAt: number; materials: Material[];
};
export type Passage = { id: string; title: string; author: string; text: string; phrases: PassagePhrase[] | null; createdAt: number; updatedAt: number };
export type Settings = { textModel: string; voiceModel: string; speechProvider: "minimax" | "qwen3" };
export type Feedback = { appropriate: boolean; score: number; scenarioFeedback: string; grammarFeedback: string; improvedSentence: string };

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVALID_INPUT") {
    super(message); this.status = status; this.code = code;
  }
}

export function input(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new AppError(`${label} is required and can be at most ${max} characters.`);
  }
  return value.trim();
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("The model's answer was incomplete. Please try again.", 502, "INVALID_MODEL_OUTPUT");
  return value as Record<string, unknown>;
}
export function modelText(value: unknown, max = 1600): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AppError("The model's answer was incomplete. Please try again.", 502, "INVALID_MODEL_OUTPUT");
  return value.trim();
}
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();
}
// Stored passages keep line breaks; repeated blank lines collapse to one stanza break.
export function passageText(value: unknown): string {
  const text = input(value, "Text", 5000).replace(/\r\n?/g, "\n").split("\n").map(line => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n");
  if (!/[a-z]/i.test(text)) throw new AppError("The text needs to contain English.");
  if (text.split("\n").length > 400) throw new AppError("A text can have at most 400 lines. You can save it in several parts.");
  return text;
}
// Whole-word match that ignores case, punctuation, and apostrophes at word edges (makin').
export function phraseInLine(line: string, phrase: string): boolean {
  const key = (value: string) => normalize(value).replace(/(^|\s)'+|'+(?=\s|$)/g, "$1");
  return !!key(phrase) && ` ${key(line)} `.includes(` ${key(phrase)} `);
}
// Offsets into the learner's own text, so marking mistakes never reveals the original.
// A wrong or extra word spans start..end; a missing word is an empty mark (start === end) where it belongs.
export type DictationMark = { start: number; end: number };
export function dictationCheck(answer: string, original: string): { score: number; marks: DictationMark[] } {
  const words = (value: string) => [...value.matchAll(/[\p{L}\p{N}'’‘]+/gu)].map(match => ({ start: match.index, end: match.index + match[0].length, key: match[0].toLowerCase().replace(/[’‘]/g, "'") }));
  const a = words(answer), b = words(original);
  // Fewest edits first; among equal edits keep the most words matched, so a right word is not marked just to tie.
  type Step = { edits: number; matches: number; move: "same" | "wrong" | "extra" | "missing" };
  const best: Step[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => ({ edits: i + j, matches: 0, move: j ? "missing" : "extra" })));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const same = a[i - 1].key === b[j - 1].key, diagonal = best[i - 1][j - 1], extra = best[i - 1][j], missing = best[i][j - 1];
    const options: Step[] = [{ edits: diagonal.edits + (same ? 0 : 1), matches: diagonal.matches + (same ? 1 : 0), move: same ? "same" : "wrong" }, { edits: extra.edits + 1, matches: extra.matches, move: "extra" }, { edits: missing.edits + 1, matches: missing.matches, move: "missing" }];
    best[i][j] = options.reduce((kept, option) => option.edits < kept.edits || option.edits === kept.edits && option.matches > kept.matches ? option : kept);
  }
  const marks: DictationMark[] = [];
  for (let i = a.length, j = b.length; i > 0 || j > 0;) {
    const { move } = best[i][j];
    if (move === "missing") { const at = i > 0 ? a[i - 1].end : a[0]?.start ?? 0; marks.push({ start: at, end: at }); j--; continue; }
    if (move !== "same") marks.push({ start: a[i - 1].start, end: a[i - 1].end });
    i--; if (move !== "extra") j--;
  }
  return { score: Math.round(100 * (1 - best[a.length][b.length].edits / Math.max(a.length, b.length, 1))), marks: marks.reverse() };
}
export function dictationScore(answer: string, original: string): number {
  return dictationCheck(answer, original).score;
}
export function reviewWeight(mastery: number): number { return Math.max(0.08, Math.pow(1 - Math.min(100, Math.max(0, mastery)) / 100, 2)); }
export function chooseWeighted<T extends { mastery: number }>(items: T[], random = Math.random()): T {
  if (!items.length) throw new AppError("Learn a meaning first, then start reviewing.", 400, "NO_LEARNED_WORDS");
  let cursor = random * items.reduce((sum, item) => sum + reviewWeight(item.mastery), 0);
  for (const item of items) { cursor -= reviewWeight(item.mastery); if (cursor <= 0) return item; }
  return items[items.length - 1];
}
export function isCopied(answer: string, originals: string[]): boolean {
  return originals.some(original => dictationScore(answer, original) >= 82);
}
export function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function validateFeedback(value: unknown): Feedback {
  const item = record(value);
  if (typeof item.appropriate !== "boolean" || typeof item.score !== "number" || !Number.isFinite(item.score)) throw new AppError("The model did not finish the assessment. Please try again.", 502, "INVALID_MODEL_OUTPUT");
  return { appropriate: item.appropriate, score: Math.round(Math.min(100, Math.max(0, item.score))), scenarioFeedback: modelText(item.scenarioFeedback), grammarFeedback: modelText(item.grammarFeedback), improvedSentence: modelText(item.improvedSentence) };
}

// Only accept bounded raster data from the image provider; never serve HTML/SVG.
export function decodeImage(value: unknown): { bytes: Uint8Array; mimeType: string } {
  const fail = () => new AppError("MiniMax returned an invalid image. Please try again.", 502, "IMAGE_FORMAT");
  if (typeof value !== "string" || value.length < 16 || value.length > 16 * 1024 * 1024 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw fail();
  let binary: string;
  try { binary = atob(value); } catch { throw fail(); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const starts = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  let mimeType: string;
  if (starts([137,80,78,71,13,10,26,10])) mimeType = "image/png";
  else if (starts([255,216,255])) mimeType = "image/jpeg";
  else if (starts([82,73,70,70]) && starts([87,69,66,80], 8)) mimeType = "image/webp";
  else throw fail();
  return { bytes, mimeType };
}
