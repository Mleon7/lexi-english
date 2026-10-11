import test from "node:test";
import assert from "node:assert/strict";
import { sites } from "../build/sites-vite-plugin.ts";

const origin = "https://desktop.example.ts.net";
const login = "owner@example.com";

function middleware(options = {}) {
  let handle;
  sites(options).configureServer({
    config: { server: {}, logger: { info() {} } },
    middlewares: { use(fn) { handle = fn; } },
  });
  return (headers = {}, url = "/api/state", address = "127.0.0.1", method = "GET") => {
    const request = {
      headers: { host: "127.0.0.1:5173", ...headers },
      rawHeaders: [], socket: { remoteAddress: address }, url, method,
    };
    request.rawHeaders = Object.entries(request.headers).flat();
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() { this.ended = true; } };
    let next = false;
    handle(request, response, () => { next = true; });
    return { request, response, next };
  };
}

const proxyHeaders = { host: "desktop.example.ts.net", "tailscale-user-login": login };
const cookie = { cookie: "__sites_local_auth=1" };

test("loopback login is preserved and forged app identity headers are stripped", () => {
  const run = middleware();
  assert.equal(run({ "oai-authenticated-user-id": "forged" }).request.headers["oai-authenticated-user-id"], undefined);
  assert.equal(run(cookie).request.headers["oai-authenticated-user-id"], "local_seedy");
  assert.equal(run({}, "/signin-with-chatgpt").response.statusCode, 302);
  assert.equal(run(cookie, "/signin-with-chatgpt", "192.168.1.2").response.statusCode, 403);
  assert.equal(run({ ...proxyHeaders, ...cookie }).request.headers["oai-authenticated-user-id"], undefined);
});

test("Serve owner can sign in securely and reuse the existing local learning identity", () => {
  const run = middleware({ tailscaleOrigin: origin, tailscaleLogin: login });
  const signIn = run({ ...proxyHeaders, origin }, "/signin-with-chatgpt?return_to=/");
  assert.equal(signIn.response.statusCode, 302);
  assert.match(signIn.response.headers["Set-Cookie"], /; Secure$/);
  assert.equal(signIn.response.headers.Location, "/");
  const state = run({ ...proxyHeaders, ...cookie, "oai-authenticated-user-id": "forged" });
  assert.equal(state.next, true);
  assert.equal(state.request.headers["oai-authenticated-user-id"], "local_seedy");
  assert.equal(state.request.headers.cookie, undefined);
  assert.equal(run(proxyHeaders).request.headers["oai-authenticated-user-id"], undefined);
  const signOut = run({ ...proxyHeaders, ...cookie, origin }, "/signout-with-chatgpt", "127.0.0.1", "POST");
  assert.equal(signOut.response.statusCode, 303);
  assert.match(signOut.response.headers["Set-Cookie"], /Max-Age=0/);
});

test("remote cookie cannot bypass missing, different or duplicate Serve identity", () => {
  const run = middleware({ tailscaleOrigin: origin, tailscaleLogin: login });
  for (const path of ["/", "/api/state", "/api/audio", "/signin-with-chatgpt"]) {
    for (const value of [undefined, "other@example.com", `${login},other@example.com`, [login, login]]) {
      const result = run({ ...proxyHeaders, ...cookie, "tailscale-user-login": value }, path);
      assert.equal(result.response.statusCode, 403);
      assert.equal(result.next, false);
    }
    assert.equal(run({ ...proxyHeaders, ...cookie }, path, "100.64.0.2").response.statusCode, 403);
  }
});

test("Serve login rejects cross-site requests and unconfigured hostnames", () => {
  const run = middleware({ tailscaleOrigin: origin, tailscaleLogin: login });
  assert.equal(run({ ...proxyHeaders, origin: "https://evil.example" }, "/signin-with-chatgpt").response.statusCode, 403);
  assert.equal(run({ ...proxyHeaders, "sec-fetch-site": "cross-site" }, "/signin-with-chatgpt").response.statusCode, 403);
  for (const host of ["other.example.ts.net", "desktop.example.ts.net.evil.test", "desktop.example.ts.net:8443"]) {
    assert.equal(run({ ...proxyHeaders, ...cookie, host }, "/signin-with-chatgpt").response.statusCode, 403);
  }
});

test("Serve settings fail closed when incomplete or not an exact HTTPS ts.net origin", () => {
  for (const tailscaleOrigin of ["", "http://desktop.example.ts.net", `${origin}/`, `${origin}/path`, "https://*.ts.net", "https://example.com", "https://user@desktop.example.ts.net"]) {
    assert.throws(() => sites({ tailscaleOrigin, tailscaleLogin: login }));
  }
  assert.throws(() => sites({ tailscaleOrigin: origin }));
});
