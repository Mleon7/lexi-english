import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const senses = sqliteTable("senses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  word: text("word").notNull(),
  phonetic: text("phonetic").notNull().default(""),
  pos: text("pos").notNull(),
  meaning: text("meaning").notNull(),
  definition: text("definition").notNull(),
  learned: integer("learned", { mode: "boolean" }).notNull().default(false),
  mastery: integer("mastery").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  materials: text("materials").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("senses_user_word_idx").on(table.userId, table.word)]);

export const exercises = sqliteTable("exercises", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  senseId: text("sense_id").notNull(),
  kind: text("kind").notNull(),
  stage: text("stage").notNull(),
  data: text("data").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("exercises_user_kind_idx").on(table.userId, table.kind)]);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  textModel: text("text_model").notNull(),
  voiceModel: text("voice_model").notNull(),
});

export const audioFiles = sqliteTable("audio_files", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  cacheKey: text("cache_key").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("audio_user_cache_idx").on(table.userId, table.cacheKey)]);

export const requestLimits = sqliteTable("request_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
});

export const passages = sqliteTable("passages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  text: text("text").notNull(),
  // JSON list of fixed expressions; NULL until the current text has been analysed.
  phrases: text("phrases"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("passages_user_created_idx").on(table.userId, table.createdAt)]);
