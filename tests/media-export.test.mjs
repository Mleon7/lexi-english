import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportMedia, startMediaExport, mediaName } from '../scripts/media-export.mjs';

test('media export preserves bytes, skips unchanged files, and syncs future media', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lexi-media-test-'));
  const index = path.join(root, '.wrangler/state/v3/r2/miniflare-R2BucketObject');
  const blobs = path.join(root, '.wrangler/state/v3/r2/site-creator-r2/blobs');
  await fs.mkdir(index, { recursive: true }); await fs.mkdir(blobs, { recursive: true });
  const db = new DatabaseSync(path.join(index, 'fixture.sqlite'));
  db.exec('CREATE TABLE _mf_objects(key TEXT,blob_id TEXT,size INTEGER,etag TEXT,http_metadata TEXT,custom_metadata TEXT,uploaded INTEGER)');
  const insert = db.prepare('INSERT INTO _mf_objects VALUES(?,?,?,?,?,?,?)');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=', 'base64');
  let stop;
  try {
    await fs.writeFile(path.join(blobs, 'imageblob'), png);
    insert.run('images/example-1', 'imageblob', png.length, 'png-etag', JSON.stringify({ contentType: 'image/png' }), JSON.stringify({word:'meticulous'}), 1791342000000);
    insert.run('images/escape', '../../outside', 12, 'bad', JSON.stringify({ contentType: 'image/png' }), JSON.stringify({word:'meticulous'}), 1791342000000);
    const first = await exportMedia(root); assert.equal(first.copied, 1);
    assert.equal(mediaName('meticulous', Date.UTC(2026, 9, 7, 0, 0, 0)), 'meticulous_20261007_080000_000');
    const picture = path.join(root, 'media/images/'+mediaName('meticulous',1791342000000)+'.png');
    assert.deepEqual(await fs.readFile(picture), png);
    const before = (await fs.stat(picture)).mtimeMs;
    assert.equal((await exportMedia(root)).copied, 0);
    assert.equal((await fs.stat(picture)).mtimeMs, before);
    stop = startMediaExport(root, () => {});
    await new Promise(resolve => setTimeout(resolve, 100));
    const audio = Buffer.from('ID3-test-mp3-binary');
    await fs.writeFile(path.join(blobs, 'audioblob'), audio);
    insert.run('speech/example-voice.mp3', 'audioblob', audio.length, 'mp3-etag', JSON.stringify({ contentType: 'audio/mpeg' }), JSON.stringify({word:'meticulous'}), 1791342000000);
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert.deepEqual(await fs.readFile(path.join(root, 'media/audio/'+mediaName('meticulous',1791342000000)+'.mp3')), audio);
    await fs.unlink(picture);
    assert.equal((await exportMedia(root)).copied, 1);
    assert.deepEqual(await fs.readFile(picture), png);
  } finally {
    if (stop) await stop();
    db.close();
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lexi-media-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
