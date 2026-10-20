import { env } from "cloudflare:workers";
import { AppError, type Passage, type Sense, type Settings } from "./core";
import { speechConfiguration } from "./speech-config";

export function database(): D1Database {
  if (!env.DB) throw new AppError("学习数据库尚未就绪，请稍后重试。", 503, "STORAGE_UNAVAILABLE");
  return env.DB;
}
export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new AppError("媒体存储尚未就绪，请稍后重试。", 503, "MEDIA_STORAGE_UNAVAILABLE");
  return env.BUCKET;
}
export type SenseRow = { id: string; user_id: string; word: string; phonetic: string; pos: string; meaning: string; definition: string; learned: number; mastery: number; review_count: number; materials: string; created_at: number; updated_at: number };
export type ExerciseRow = { id: string; user_id: string; sense_id: string; kind: string; stage: string; data: string; created_at: number; updated_at: number };
export function publicSense(row: SenseRow): Sense {
  return { id: row.id, word: row.word, phonetic: row.phonetic, pos: row.pos, meaning: row.meaning, definition: row.definition, learned: !!row.learned, mastery: row.mastery, reviewCount: row.review_count, createdAt: row.created_at, materials: JSON.parse(row.materials) };
}
export async function getSense(userId: string, id: string): Promise<SenseRow> {
  const row = await database().prepare("SELECT * FROM senses WHERE id = ? AND user_id = ?").bind(id, userId).first<SenseRow>();
  if (!row) throw new AppError("没有找到这个词义。", 404, "NOT_FOUND");
  return row;
}
export async function listSenses(userId: string, learnedOnly = true): Promise<Sense[]> {
  const result = await database().prepare(`SELECT * FROM senses WHERE user_id = ? ${learnedOnly ? "AND learned = 1" : ""} ORDER BY created_at ASC LIMIT 3000`).bind(userId).all<SenseRow>();
  return result.results.map(publicSense);
}
export type PassageRow = { id: string; user_id: string; title: string; author: string; text: string; created_at: number; updated_at: number };
export function publicPassage(row: PassageRow): Passage {
  return { id: row.id, title: row.title, author: row.author, text: row.text, createdAt: row.created_at, updatedAt: row.updated_at };
}
export async function getPassage(userId: string, id: string): Promise<PassageRow> {
  const row = await database().prepare("SELECT * FROM passages WHERE id = ? AND user_id = ?").bind(id, userId).first<PassageRow>();
  if (!row) throw new AppError("没有找到这段文本。", 404, "NOT_FOUND");
  return row;
}
export async function listPassages(userId: string): Promise<Passage[]> {
  const result = await database().prepare("SELECT * FROM passages WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").bind(userId).all<PassageRow>();
  return result.results.map(publicPassage);
}
export async function settings(userId: string): Promise<Settings> {
  const row = await database().prepare("SELECT text_model, voice_model FROM user_settings WHERE user_id = ?").bind(userId).first<{ text_model: string; voice_model: string }>();
  const speech = speechConfiguration();
  return { textModel: row?.text_model || env.DEEPSEEK_MODEL || "deepseek-flash", voiceModel: speech.provider === "qwen3" ? speech.model : row?.voice_model || speech.minimaxModel, speechProvider: speech.provider };
}
export async function exercise(userId: string, id: string, kind: string): Promise<ExerciseRow> {
  const row = await database().prepare("SELECT * FROM exercises WHERE id = ? AND user_id = ? AND kind = ?").bind(id, userId, kind).first<ExerciseRow>();
  if (!row) throw new AppError("练习不存在，请重新开始。", 404, "NOT_FOUND");
  return row;
}
export async function createExercise(userId: string, senseId: string, kind: string, stage: string, data: unknown): Promise<string> {
  const id = crypto.randomUUID(), now = Date.now();
  await database().prepare("INSERT INTO exercises (id,user_id,sense_id,kind,stage,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, userId, senseId, kind, stage, JSON.stringify(data), now, now).run();
  return id;
}
export async function updateMaterials(userId: string, senseId: string, change: (current: Sense) => Sense["materials"]): Promise<Sense> {
  // Providers may take several seconds. Merge their result with the latest row,
  // then compare versions so changes from another tab are never overwritten.
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await getSense(userId, senseId);
    const materials = change(publicSense(row));
    const version = Math.max(Date.now(), row.updated_at + 1);
    const result = await database().prepare("UPDATE senses SET materials = ?, learned = 1, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ?").bind(JSON.stringify(materials), version, senseId, userId, row.updated_at).run();
    if (result.meta.changes) return publicSense(await getSense(userId, senseId));
  }
  throw new AppError("学习材料正在另一处更新，请稍后重试。", 409, "CONCURRENT_UPDATE");
}
export async function rateLimit(userId: string): Promise<void> {
  const now = Date.now();
  const row = await database().prepare("INSERT INTO request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at < ? THEN 1 ELSE count + 1 END, expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END RETURNING count").bind(`actions:${userId}`, now + 60000, now, now, now + 60000).first<{ count: number }>();
  if (row && row.count > 45) throw new AppError("操作有些频繁，请稍等一分钟再试。", 429, "RATE_LIMIT");
}
