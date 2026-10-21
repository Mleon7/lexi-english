

export class ApiError extends Error { code: string; constructor(message: string, code: string) { super(message); this.code = code; } }

export async function request<T>(action?: string, data: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(action ? "/api/action" : "/api/state", action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }) } : undefined);
  let result;
  try { result = await response.json(); } catch { throw new ApiError("The service is not responding. Please try again later.", "network"); }
  if (!response.ok) { const failure = result && typeof result === "object" ? result as Record<string, unknown> : {}; throw new ApiError(typeof failure.error === "string" ? failure.error : "That did not work. Please try again.", response.status === 401 ? "auth" : typeof failure.code === "string" ? failure.code : "error"); }
  return result as T;
}
