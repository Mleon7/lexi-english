import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/qwen-demo.mjs', import.meta.url));

async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function project(t, mode = '') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lexi-manager-test-'));
  const files = {
    'package.json': '{"type":"module"}',
    'node_modules/vinext/dist/cli.js': '',
    'node_modules/wrangler/bin/wrangler.js': 'setTimeout(() => process.exit(0), 100);',
    'scripts/media-export.mjs': 'export function startMediaExport() { return async () => {}; }',
    'scripts/run-framework.mjs': `import { createServer } from 'node:http';\nconst port = Number(process.argv[process.argv.indexOf('--port') + 1]);\ncreateServer((request, response) => { response.statusCode = 401; response.end('{}'); }).listen(port, '127.0.0.1');`,
    'tts/.venv/bin/python': '#!' + process.execPath + '\nawait import(' + JSON.stringify(new URL('file://' + fixture).href) + ');',
  };
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o755 });
  }
  for (const script of ['local-manager.mjs', 'qwen-service.mjs']) await copyFile(new URL('../scripts/' + script, import.meta.url), path.join(root, 'scripts', script));
  const settings = {
    DEEPSEEK_API_KEY: 'fake-test-key', TTS_PROVIDER: 'qwen3',
    QWEN_TTS_DIR: path.join(root, 'tts'), QWEN_TTS_URL: 'http://127.0.0.1:' + await unusedPort(),
    QWEN_TTS_MODEL: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', QWEN_TTS_START_TIMEOUT: '10',
    QWEN_TTS_OFFLINE: '0',
    QWEN_FIXTURE_DELAY: '1500', QWEN_FIXTURE_MODE: mode, PORT: String(await unusedPort()),
  };
  await writeFile(path.join(root, '.env'), Object.entries(settings).map(([key, value]) => key + '=' + value).join('\n'));
  const run = (action, options = {}) => execute(process.execPath, ['scripts/local-manager.mjs', action, '--no-browser'], { cwd: root, env: { ...process.env, ...settings }, timeout: 15000, ...options });
  t.after(async () => { await run('stop'); await rm(root, { recursive: true, force: true }); });
  return { root, settings, run };
}

test('local manager starts web and Qwen together, reports both ready, and stops both', { skip: process.platform === 'win32' ? 'Unix virtualenv fixture' : false }, async t => {
  const { settings, run } = await project(t);
  const launch = run('start');
  const observed = [];
  for (let i = 0; i < 40; i++) {
    const status = JSON.parse((await run('status')).stdout);
    observed.push(status);
    if (status.phase === 'ready') break;
    await delay(100);
  }
  const output = (await launch).stdout;
  assert.match(output, /Qwen3-TTS 已就绪/);
  assert.ok(observed.some(status => status.detail === '网页已就绪' && status.tts?.phase === 'starting'), 'Web becomes ready while the TTS model loads');
  const status = JSON.parse((await run('status')).stdout);
  assert.equal(status.phase, 'ready');
  assert.equal(status.tts.phase, 'ready');
  assert.equal(status.tts.managed, true);
  assert.equal((await fetch(status.url + '/api/state')).status, 401);
  const repeated = (await run('start')).stdout;
  assert.match(repeated, /词境已在运行/);
  await run('stop');
  assert.equal(JSON.parse((await run('status')).stdout).phase, 'stopped');
  await assert.rejects(fetch(status.url));
  await assert.rejects(fetch(settings.QWEN_TTS_URL));
});

test('a Qwen startup failure is reported and the manager cleans up the web service', { skip: process.platform === 'win32' ? 'Unix virtualenv fixture' : false }, async t => {
  const { settings, run } = await project(t, 'exit');
  await assert.rejects(run('start'), error => /Qwen3-TTS 已退出/.test(error.stderr));
  const status = JSON.parse((await run('status')).stdout);
  assert.equal(status.phase, 'error');
  await assert.rejects(fetch('http://127.0.0.1:' + settings.PORT));
  await assert.rejects(fetch(settings.QWEN_TTS_URL));
});

test('stopping during model loading cancels both startup tasks without leaving services behind', { skip: process.platform === 'win32' ? 'Unix virtualenv fixture' : false }, async t => {
  const { root, settings, run } = await project(t);
  const began = Date.now();
  const launch = run('start').catch(error => error);
  for (let i = 0; i < 30; i++) {
    const status = JSON.parse((await run('status')).stdout);
    if (status.tts?.phase === 'starting') break;
    await delay(50);
  }
  await run('stop');
  assert.equal(JSON.parse((await run('status')).stdout).phase, 'stopped');
  await assert.rejects(fetch('http://127.0.0.1:' + settings.PORT));
  await assert.rejects(fetch(settings.QWEN_TTS_URL));
  const log = await readFile(path.join(root, '.local-run', 'server.log'), 'utf8');
  assert.doesNotMatch(log, /服务已就绪/);
  // The foreground wait notices the disappearing supervisor and exits promptly.
  const result = await launch;
  assert.equal(result.killed, false);
  assert.ok(Date.now() - began < 5000, 'Foreground startup also exits promptly');
});
