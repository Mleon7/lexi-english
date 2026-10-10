import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../lib/server/origin.ts";

const local = "http://127.0.0.1:5173/api/action";
const tunnel = "https://example-5173.region.devtunnels.ms";

test("same-origin and non-browser requests retain existing behavior", () => {
  assert.equal(isAllowedOrigin(null, local), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:5173", local), true);
  assert.equal(isAllowedOrigin(tunnel, local), false);
});

test("only explicitly configured proxy origins are allowed", () => {
  const config = ` https://other.example, ${tunnel}/ `;
  assert.equal(isAllowedOrigin(tunnel, local, config), true);
  for (const origin of ["null", "https://evil.example", `${tunnel}.evil.example`, tunnel.replace("https:", "http:"), `${tunnel}:8443`]) {
    assert.equal(isAllowedOrigin(origin, local, config), false);
  }
});

test("proxy-rewritten loopback origin requires an explicit exact entry", () => {
  const requestUrl = "https://localhost:5173/api/action";
  const origin = "http://localhost:5173";
  assert.equal(isAllowedOrigin(origin, requestUrl, tunnel), false);
  assert.equal(isAllowedOrigin(origin, requestUrl, `${tunnel},${origin}`), true);
  assert.equal(isAllowedOrigin("http://localhost:5174", requestUrl, origin), false);
  assert.equal(isAllowedOrigin("https://evil.example", requestUrl, origin), false);
});

test("invalid entries and wildcard domains do not authorize requests", () => {
  for (const config of ["*", "https://*.devtunnels.ms", `${tunnel}/path`, `${tunnel}?q=1`, `${tunnel}#fragment`, tunnel.replace("https://", "https://user@"), "null"]) {
    assert.equal(isAllowedOrigin(tunnel, local, config), false);
  }
});
