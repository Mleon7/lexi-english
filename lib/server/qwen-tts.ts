import { AppError } from "./core";

const formatError = () => new AppError("Qwen3-TTS returned invalid audio. Make sure the CustomVoice demo is running.", 502, "SPEECH_FORMAT");

function generationError(status: unknown): AppError {
  if (typeof status === "string" && /out of memory/i.test(status)) return new AppError("Qwen3-TTS ran out of GPU memory. Close other programs using the GPU and try a shorter sentence.", 503, "SPEECH_MEMORY");
  return new AppError("Qwen3-TTS could not generate audio. Check the local demo's status or terminal errors and try again.", 502, "SPEECH_FAILED");
}

// Gradio's public call API: POST -> event_id -> SSE complete -> FileData.
// https://www.gradio.app/guides/querying-gradio-apps-with-curl
async function completed(response: Response): Promise<unknown[]> {
  if (!response.body) throw formatError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1024 * 1024) throw formatError();
      let match: RegExpMatchArray | null;
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const boundary = match.index!;
        const lines = buffer.slice(0, boundary).split(/\r?\n/);
        buffer = buffer.slice(boundary + match[0].length);
        const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (event === "error") throw generationError(data);
        if (event === "complete") {
          let result: unknown;
          try { result = JSON.parse(data); } catch { throw formatError(); }
          if (!Array.isArray(result)) throw formatError();
          return result;
        }
      }
      if (done) throw formatError();
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function qwenSpeech(baseUrl: string, text: string, speaker: string): Promise<Uint8Array> {
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { throw new AppError("QWEN_TTS_URL is malformed. Use the local service address, e.g. http://127.0.0.1:8000.", 503, "SPEECH_CONFIG"); }
  const signal = AbortSignal.timeout(300000);
  const request = async (url: URL, init?: RequestInit) => {
    const response = await fetch(url, { ...init, redirect: "manual", signal });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) throw new AppError("The Qwen3-TTS endpoint was not found. Check the address and the CustomVoice demo.", 503, "SPEECH_CONFIG");
      throw new AppError("The local Qwen3-TTS service returned an error. Check that the demo is ready.", 502, "SPEECH_FAILED");
    }
    return response;
  };
  try {
    const endpoint = new URL("gradio_api/call/run_instruct", base);
    const submitted = await request(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [text, "English", speaker, ""] }),
    });
    const job = await submitted.json() as { event_id?: unknown };
    if (typeof job?.event_id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(job.event_id)) throw formatError();
    const result = await completed(await request(new URL(endpoint.href + "/" + job.event_id)));
    if (!result[0]) throw generationError(result[1]);
    const file = result[0] as { url?: unknown; path?: unknown };
    const prefix = new URL("gradio_api/file=", base);
    const url = typeof file.url === "string" ? new URL(file.url, base)
      : typeof file.path === "string" ? new URL(prefix.href + encodeURIComponent(file.path)) : null;
    // Only retrieve files from the configured Gradio instance, never another host.
    if (!url || url.origin !== base.origin || !url.pathname.startsWith(prefix.pathname) || url.username || url.password) throw formatError();
    const response = await request(url);
    if (!response.body) throw formatError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32 * 1024 * 1024) throw formatError();
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (size < 44 || new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8, 12)) !== "WAVE") throw formatError();
    return bytes;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted) throw new AppError("Qwen3-TTS took more than 5 minutes. Shorten the text or wait for the local queue, then try again.", 504, "SPEECH_TIMEOUT");
    throw new AppError("Cannot reach the local Qwen3-TTS. Start qwen-tts-demo and check QWEN_TTS_URL.", 502, "PROVIDER_UNAVAILABLE");
  }
}
