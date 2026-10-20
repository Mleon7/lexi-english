

export type Kind = "description" | "example" | "synonym" | "antonym";

export type Material = { id: string; kind: Kind; text: string; term?: string; relationNote?: string; translation?: string; source?: string; scene?: { title: string; description: string; imageUrl?: string; objectKey?: string; mimeType?: string; model?: string; emoji?: string; background?: string; foreground?: string } };

export type Sense = { id: string; word: string; phonetic: string; pos: string; meaning: string; definition: string; learned: boolean; mastery: number; reviewCount: number; createdAt: number; materials: Material[] };

export type Passage = { id: string; title: string; author: string; text: string; createdAt: number; updatedAt: number };

export type AppState = { senses: Sense[]; passages: Passage[]; settings: { textModel: string; voiceModel: string; speechProvider: "minimax" | "qwen3" }; services: { text: boolean; speech: boolean }; user: { displayName: string } };

export type Choice = Pick<Sense, "id" | "word" | "phonetic" | "pos" | "meaning" | "definition">;

export type Feedback = { appropriate: boolean; score: number; scenarioFeedback: string; grammarFeedback: string; improvedSentence: string };

export type Tab = "read" | "write" | "listen";

export type Notify = (message: string) => void;

export const KIND_LABEL: Record<Kind, string> = { description: "英文描述", example: "例句", synonym: "近义词", antonym: "反义词" };
