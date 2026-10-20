export type MaterialKind = "description" | "example" | "synonym" | "antonym";
export type Material = {
  id: string; kind: MaterialKind; text: string; term?: string; relationNote?: string;
  translation?: string; source?: string;
  scene?: { title: string; description: string; imageUrl?: string; objectKey?: string; mimeType?: string; model?: string; emoji?: string; background?: string; foreground?: string };
};
export type Sense = {
  id: string; word: string; phonetic: string; pos: string; meaning: string; definition: string;
  learned: boolean; mastery: number; reviewCount: number; createdAt: number; materials: Material[];
};
export type Passage = { id: string; title: string; author: string; text: string; createdAt: number; updatedAt: number };
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
    throw new AppError(`${label}不能为空，且最多 ${max} 个字符。`);
  }
  return value.trim();
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("模型返回的内容格式不完整，请重试。", 502, "INVALID_MODEL_OUTPUT");
  return value as Record<string, unknown>;
}
export function modelText(value: unknown, max = 1600): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AppError("模型返回的内容不完整，请重试。", 502, "INVALID_MODEL_OUTPUT");
  return value.trim();
}
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();
}
// Stored passages keep line breaks; repeated blank lines collapse to one stanza break.
export function passageText(value: unknown): string {
  const text = input(value, "文本", 5000).replace(/\r\n?/g, "\n").split("\n").map(line => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n");
  if (!/[a-z]/i.test(text)) throw new AppError("文本需要包含英文内容。");
  if (text.split("\n").length > 400) throw new AppError("文本最多 400 行，可以分成几段保存。");
  return text;
}
// Whole-word match that ignores case, punctuation, and apostrophes at word edges (makin').
export function phraseInLine(line: string, phrase: string): boolean {
  const key = (value: string) => normalize(value).replace(/(^|\s)'+|'+(?=\s|$)/g, "$1");
  return !!key(phrase) && ` ${key(line)} `.includes(` ${key(phrase)} `);
}
export function dictationScore(answer: string, original: string): number {
  const a = normalize(answer).split(" ");
  const b = normalize(original).split(" ");
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return Math.max(0, Math.round(100 * (1 - previous[b.length] / Math.max(a.length, b.length))));
}
export function reviewWeight(mastery: number): number { return Math.max(0.08, Math.pow(1 - Math.min(100, Math.max(0, mastery)) / 100, 2)); }
export function chooseWeighted<T extends { mastery: number }>(items: T[], random = Math.random()): T {
  if (!items.length) throw new AppError("先学习一个词义，再开始复习。", 400, "NO_LEARNED_WORDS");
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
  if (typeof item.appropriate !== "boolean" || typeof item.score !== "number" || !Number.isFinite(item.score)) throw new AppError("模型未完成评估，请重试。", 502, "INVALID_MODEL_OUTPUT");
  return { appropriate: item.appropriate, score: Math.round(Math.min(100, Math.max(0, item.score))), scenarioFeedback: modelText(item.scenarioFeedback), grammarFeedback: modelText(item.grammarFeedback), improvedSentence: modelText(item.improvedSentence) };
}

// Only accept bounded raster data from the image provider; never serve HTML/SVG.
export function decodeImage(value: unknown): { bytes: Uint8Array; mimeType: string } {
  const fail = () => new AppError("MiniMax 返回的图片无效，请重试。", 502, "IMAGE_FORMAT");
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
