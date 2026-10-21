import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AppError } from "./core";
import { env } from "cloudflare:workers";
import { isAllowedOrigin } from "./origin";

export const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function authenticated() {
  const user = await getChatGPTUser();
  if (!user) throw new AppError("Please sign in to save and continue learning.", 401, "SIGN_IN_REQUIRED");
  return user;
}
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: noStore }); }
export function failure(error: unknown): Response {
  if (error instanceof AppError) return json({ error: error.message, code: error.code }, error.status);
  // Never serialize an upstream exception: request metadata may contain secrets.
  return json({ error: "The service could not finish this. Please try again later.", code: "INTERNAL_ERROR" }, 500);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, request.url, env.ALLOWED_ORIGINS)) {
    // Log only origin metadata, never cookies, request bodies, or API credentials.
    console.warn("[lexi:origin-rejected]", JSON.stringify({
      origin,
      requestOrigin: new URL(request.url).origin,
      allowedOrigins: env.ALLOWED_ORIGINS || "",
    }));
    throw new AppError("Cross-site requests are not allowed.", 403, "INVALID_ORIGIN");
  }
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AppError("Please send JSON.", 415, "INVALID_CONTENT_TYPE");
  if (Number(request.headers.get("content-length") || 0) > 16000) throw new AppError("The request is too large.", 413, "PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("The request is empty.");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 16000) { await reader.cancel(); throw new AppError("The request is too large.", 413, "PAYLOAD_TOO_LARGE"); }
    chunks.push(value);
  }
  const merged = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(merged));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AppError("The request is not valid JSON."); }
}
