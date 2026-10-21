import { env } from "cloudflare:workers";
import { AppError } from "./core";

export const QWEN_VOICES = [
  { id: "qwen3:Ryan", label: "Ryan · male" },
  { id: "qwen3:Aiden", label: "Aiden · male" },
  { id: "qwen3:Serena", label: "Serena · female" },
  { id: "qwen3:Vivian", label: "Vivian · female" },
];

export function speechConfiguration() {
  const provider = env.TTS_PROVIDER || "minimax";
  if (provider !== "minimax" && provider !== "qwen3") throw new AppError("TTS_PROVIDER must be minimax or qwen3.", 503, "SPEECH_CONFIG");
  return {
    provider: provider as "minimax" | "qwen3",
    model: env.QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    minimaxModel: env.MINIMAX_MODEL || "speech-2.8-turbo",
    baseUrl: env.QWEN_TTS_URL || "http://127.0.0.1:8000",
    extension: provider === "qwen3" ? "wav" : "mp3",
    contentType: provider === "qwen3" ? "audio/wav" : "audio/mpeg",
    configured: provider === "qwen3" || !!env.MINIMAX_API_KEY,
  };
}
