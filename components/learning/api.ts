

export class ApiError extends Error { code: string; constructor(message: string, code: string) { super(message); this.code = code; } }

export async function request<T>(action?: string, data: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(action ? "/api/action" : "/api/state", action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }) } : undefined);
  let result;
  try { result = await response.json(); } catch { throw new ApiError("服务暂时没有响应，请稍后重试。", "network"); }
  if (!response.ok) { const failure = result && typeof result === "object" ? result as Record<string, unknown> : {}; throw new ApiError(typeof failure.error === "string" ? failure.error : "操作没有完成，请重试。", response.status === 401 ? "auth" : typeof failure.code === "string" ? failure.code : "error"); }
  return result as T;
}
