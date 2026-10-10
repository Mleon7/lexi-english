// Explicit origins only: never trust arbitrary forwarded headers or domain wildcards.
export function isAllowedOrigin(origin: string | null, requestUrl: string, configured = ""): boolean {
  if (!origin) return true;
  if (origin === new URL(requestUrl).origin) return true;
  return configured.split(",").some(value => {
    try {
      const url = new URL(value.trim());
      return ["http:", "https:"].includes(url.protocol)
        && !url.username && !url.password && url.pathname === "/"
        && !url.search && !url.hash && !url.hostname.includes("*")
        && origin === url.origin;
    } catch { return false; }
  });
}
