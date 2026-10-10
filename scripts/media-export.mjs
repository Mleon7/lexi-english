import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export function mediaName(word, uploaded) {
  const safeWord = String(word).trim().replace(/[^a-zA-Z0-9'-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  if (!safeWord) throw new Error('Missing media word');
  // A stable Asia/Shanghai timestamp, independent of the computer timezone.
  const iso = new Date(Number(uploaded) + 8 * 3600000).toISOString();
  return safeWord + '_' + iso.slice(0, 10).replaceAll('-', '') + '_' + iso.slice(11, 19).replaceAll(':', '') + '_' + iso.slice(20, 23);
}
async function readWordIndex(root) {
  const directory = path.join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const names = await fs.readdir(directory).catch(() => []);
  const words = new Map();
  for (const name of names.filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')) {
    const db = new DatabaseSync(path.join(directory, name), { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout=1000');
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      if (!tables.has('senses')) continue;
      for (const row of db.prepare('SELECT word,materials FROM senses').all()) {
        for (const item of JSON.parse(row.materials)) if (item.scene?.objectKey) words.set(item.scene.objectKey, row.word);
      }
      if (!tables.has('exercises')) continue;
      const models = new Set([process.env.MINIMAX_MODEL || 'speech-2.8-turbo']);
      if (tables.has('user_settings')) for (const row of db.prepare('SELECT DISTINCT voice_model FROM user_settings').all()) models.add(row.voice_model);
      for (const row of db.prepare("SELECT s.word,e.user_id,e.data FROM exercises e JOIN senses s ON s.id=e.sense_id AND s.user_id=e.user_id WHERE e.kind='listening'").all()) {
        const data = JSON.parse(row.data);
        for (const voice of data.voices || []) for (const model of models) {
          const hash = createHash('sha256').update([row.user_id, model, voice.id, data.text].join('|')).digest('hex');
          words.set('speech/' + hash + '.mp3', row.word);
        }
      }
    } finally { db.close(); }
  }
  return words;
}
function ownedPath(output, relative) {
  if (typeof relative !== 'string' || !/^(images|audio)\/[a-zA-Z0-9_.'-]+\.(png|jpg|webp|mp3)$/.test(relative)) return null;
  const resolved = path.resolve(output, relative);
  return resolved.startsWith(path.resolve(output) + path.sep) ? resolved : null;
}
// Read-only access to the pinned local R2 index; original storage stays intact.
export async function exportMedia(root) {
  const state = path.join(root, '.wrangler/state/v3/r2');
  const databases = path.join(state, 'miniflare-R2BucketObject');
  const blobs = path.join(state, 'site-creator-r2/blobs');
  const output = path.join(root, 'media');
  const manifestPath = path.join(root, '.local-run/media-export-index.json');
  let filenames;
  try { filenames = await fs.readdir(databases); } catch (error) { if (error.code === 'ENOENT') return { copied: 0, total: 0 }; throw error; }
  let manifest = {};
  try { const value = JSON.parse(await fs.readFile(manifestPath, 'utf8')); if (value && !Array.isArray(value) && typeof value === 'object') manifest = value; } catch {}
  const wordIndex = await readWordIndex(root);
  const reserved = new Map(Object.entries(manifest).filter(([, value]) => value.namingVersion === 2).map(([key, value]) => [value.file.toLowerCase(), key]));
  let copied = 0, total = 0;
  for (const name of filenames.filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')) {
    const database = new DatabaseSync(path.join(databases, name), { readOnly: true });
    let objects;
    try {
      database.exec('PRAGMA busy_timeout=1000');
      if (!database.prepare("SELECT name FROM sqlite_master WHERE name='_mf_objects'").get()) continue;
      objects = database.prepare('SELECT key,blob_id,size,etag,http_metadata,custom_metadata,uploaded FROM _mf_objects WHERE blob_id IS NOT NULL ORDER BY uploaded,key').all();
    } finally { database.close(); }
    for (const object of objects) {
      if (!/^(images|speech)\/[a-zA-Z0-9_.-]+$/.test(object.key) || !/^[a-zA-Z0-9_-]+$/.test(object.blob_id)) continue;
      const metadata = JSON.parse(object.http_metadata), custom = JSON.parse(object.custom_metadata || '{}');
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/mpeg': '.mp3' }[metadata.contentType];
      const word = custom.word || wordIndex.get(object.key);
      if (!ext || !word) continue;
      const folder = ext === '.mp3' ? 'audio' : 'images';
      const base = mediaName(word, object.uploaded);
      const previous = manifest[object.key];
      let relative = previous?.namingVersion === 2 && ownedPath(output, previous.file) ? previous.file : folder + '/' + base + ext;
      let suffix = 1;
      while ((reserved.has(relative.toLowerCase()) && reserved.get(relative.toLowerCase()) !== object.key) || (!previous?.namingVersion && await fs.stat(path.join(output, relative)).catch(() => null))) {
        relative = folder + '/' + base + '_' + (++suffix) + ext;
      }
      reserved.set(relative.toLowerCase(), object.key);
      const destination = ownedPath(output, relative);
      if (!destination) continue;
      const source = path.join(blobs, object.blob_id);
      total++;
      const existing = await fs.stat(destination).catch(() => null);
      if (previous?.namingVersion === 2 && previous.etag === object.etag && previous.file === relative && existing?.size === object.size) continue;
      const sourceStat = await fs.stat(source).catch(() => null);
      if (sourceStat?.size !== object.size) continue;
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = destination + '.' + randomUUID() + '.tmp';
      try { await fs.copyFile(source, temporary); await fs.rename(temporary, destination); }
      finally { await fs.unlink(temporary).catch(() => {}); }
      const old = ownedPath(output, previous?.file);
      if (old && old !== destination) {
        const oldBytes = await fs.readFile(old).catch(() => null);
        if (oldBytes && oldBytes.length === object.size && oldBytes.equals(await fs.readFile(source))) await fs.unlink(old);
      }
      manifest[object.key] = { file: relative, etag: object.etag, size: object.size, namingVersion: 2 };
      copied++;
    }
  }
  if (copied) {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const temp = manifestPath + '.tmp';
    await fs.writeFile(temp, JSON.stringify(manifest, null, 2)); await fs.rename(temp, manifestPath);
  }
  return { copied, total };
}
export function startMediaExport(root, log) {
  let active = null;
  const sync = () => {
    if (active) return active;
    active = exportMedia(root).then(({ copied }) => { if (copied) log('已同步 ' + copied + ' 个媒体文件到 media 文件夹。\n'); })
      .catch(() => log('媒体文件同步暂未完成，将自动重试；网站原始文件不受影响。\n')).finally(() => { active = null; });
    return active;
  };
  void sync(); const timer = setInterval(sync, 5000); timer.unref();
  return async () => { clearInterval(timer); if (active) await active; await sync(); };
}
