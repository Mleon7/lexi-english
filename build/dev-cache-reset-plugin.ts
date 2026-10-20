// Dev-only: make browsers drop modules cached from an earlier dev server.
//
// Vite serves pre-bundled deps and node_modules files at `?v=<hash>` URLs that
// browsers cache as immutable, but after a restart or a dependency
// re-optimization the same URL can carry different imports. A browser that
// mixes cached and fresh modules loads two copies of React, and the app
// renders blank ("Invalid hook call"). So whenever the server or its optimized
// deps change, each browser's next page load gets `Clear-Site-Data: "cache"`,
// which drops only its HTTP cache for this origin; cookies and storage stay.
import { createHash, randomBytes } from "node:crypto";
import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import type { Plugin, ViteDevServer } from "vite";

const cookieName = "lexi_dev_cache";

export function devCacheReset(): Plugin {
  return {
    name: "dev-cache-reset",
    apply: "serve",
    // vinext's own "pre" middleware answers page requests, so run before it.
    enforce: "pre",
    configureServer(server) {
      const boot = randomBytes(6).toString("hex");

      server.middlewares.use((request, response, next) => {
        if (
          request.method === "GET" &&
          request.headers["sec-fetch-dest"] === "document"
        ) {
          const version = `${boot}.${depsVersion(server)}`;
          if (readCookie(request, cookieName) !== version) {
            resetCacheOnResponse(response, version);
          }
        }
        next();
      });
    },
  };
}

function depsVersion(server: ViteDevServer): string {
  const metadata = server.environments.client?.depsOptimizer?.metadata;
  if (!metadata) return "none";

  const hashes = Object.values(metadata.optimized).map(
    (dep) => `${dep.id}:${dep.browserHash}`,
  );
  return createHash("sha256")
    .update([metadata.browserHash, ...hashes].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function readCookie(
  request: IncomingMessage,
  name: string,
): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

// The Cloudflare plugin sends the worker's headers through writeHead(), where
// they replace same-named headers set earlier, so ours are added there.
function resetCacheOnResponse(response: ServerResponse, version: string): void {
  const writeHead = response.writeHead.bind(response) as (
    ...args: unknown[]
  ) => ServerResponse;

  response.writeHead = ((...args: unknown[]) => {
    const headers = args.find(
      (arg): arg is OutgoingHttpHeaders =>
        typeof arg === "object" && arg !== null && !Array.isArray(arg),
    );
    for (const key of Object.keys(headers ?? {})) {
      if (key.toLowerCase() === "set-cookie" && headers?.[key] !== undefined) {
        response.appendHeader("Set-Cookie", headers[key] as string | string[]);
        delete headers[key];
      }
    }
    response.appendHeader(
      "Set-Cookie",
      `${cookieName}=${version}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    );
    response.setHeader("Clear-Site-Data", '"cache"');
    return writeHead(...args);
  }) as ServerResponse["writeHead"];
}
