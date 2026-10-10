import test from "node:test";
import assert from "node:assert/strict";
import { decodeImage } from "../lib/server/core.ts";
test("provider image accepts PNG and detects its MIME type", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=";
  assert.equal(decodeImage(png).mimeType, "image/png");
});
test("provider image rejects executable formats and malformed or excessive data", () => {
  for (const value of [Buffer.from("<svg>unsafe</svg>").toString("base64"), "!".repeat(32), "A".repeat(16 * 1024 * 1024 + 4), null, ""]) {
    assert.throws(() => decodeImage(value), error => error.code === "IMAGE_FORMAT");
  }
});
