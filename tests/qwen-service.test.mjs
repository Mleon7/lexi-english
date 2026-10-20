import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { qwenLaunchConfig, qwenCheckpoint, createQwenService } from '../scripts/qwen-service.mjs';

const fixture = fileURLToPath(new URL('./fixtures/qwen-demo.mjs', import.meta.url));
const model = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice';
async function listening(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
async function unusedUrl() {
  const server = createServer();
  const url = await listening(server);
  await new Promise(resolve => server.close(resolve));
  return url;
}
const config = url => qwenLaunchConfig({ QWEN_TTS_URL: url, QWEN_TTS_DIR: '.', QWEN_TTS_OFFLINE: '0', PATH: process.env.PATH }, process.cwd());
const spawnFixture = (command, args, options) => spawn(process.execPath, [fixture, ...args], options);

async function exited(pid) {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
      if (!stat || /^\d+ \(.+\) Z /.test(stat)) return;
    }
    await delay(20);
  }
  assert.fail('Owned process remains alive: ' + pid);
}

test('Qwen launch configuration uses the selected virtualenv, model cache and platform paths', () => {
  const cfg = qwenLaunchConfig({ QWEN_TTS_DIR: '/tmp/qwen custom', QWEN_TTS_URL: 'http://localhost:8123', QWEN_TTS_START_TIMEOUT: '90' }, '/tmp', 'linux');
  assert.equal(cfg.python, '/tmp/qwen custom/.venv/bin/python');
  assert.equal(cfg.env.HF_HOME, '/tmp/qwen custom/models/huggingface');
  assert.equal(cfg.env.HF_HUB_OFFLINE, '1');
  assert.equal(qwenLaunchConfig({ QWEN_TTS_OFFLINE: '0' }, '/tmp').env.HF_HUB_OFFLINE, '0');
  assert.equal(cfg.timeoutMs, 90000);
  assert.equal(cfg.url.port, '8123');
  const win = qwenLaunchConfig({ QWEN_TTS_DIR: '.', PATH: 'C:\\Windows' }, 'C:\\lexi', 'win32');
  assert.equal(win.python, 'C:\\lexi\\.venv\\Scripts\\python.exe');
  assert.equal(win.env.PATH, 'C:\\lexi\\.venv\\Scripts;C:\\Windows');
  assert.throws(() => qwenLaunchConfig({ QWEN_TTS_START_TIMEOUT: '0' }, '/tmp'), /TIMEOUT/);
  assert.throws(() => qwenLaunchConfig({ QWEN_TTS_URL: 'http://user:secret@localhost:8000' }, '/tmp'), /URL/);
});

test('offline launch passes the cached snapshot directory and reuses a Demo loaded from it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lexi-qwen-cache-test-'));
  const cfg = qwenLaunchConfig({ QWEN_TTS_DIR: directory, QWEN_TTS_HF_HOME: directory }, directory);
  const cache = path.join(directory, 'hub', 'models--' + model.replaceAll('/', '--'));
  const revision = 'a'.repeat(40);
  const snapshot = path.join(cache, 'snapshots', revision);
  await mkdir(path.join(cache, 'refs'), { recursive: true });
  await mkdir(snapshot, { recursive: true });
  await writeFile(path.join(cache, 'refs', 'main'), revision);
  await writeFile(path.join(snapshot, 'config.json'), '{}');
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(qwenCheckpoint(cfg), snapshot);
  const server = createServer((request, response) => response.end(JSON.stringify({
    dependencies: [{ api_name: 'run_instruct' }],
    components: [{ type: 'markdown', props: { value: '**Checkpoint:** `' + snapshot + '`' } }],
  })));
  cfg.url = new URL(await listening(server));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const service = createQwenService(cfg, { spawnProcess() { assert.fail('Must reuse the matching local snapshot'); } });
  t.after(() => service.stop());
  await service.start();
  await service.stop();
  await rm(path.join(snapshot, 'config.json'));
  assert.throws(() => qwenCheckpoint(cfg), /本地缓存/);
});

test('automatic startup waits for CustomVoice readiness and stops the owned process and workers', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lexi-qwen-test-'));
  const cfg = config(await unusedUrl());
  cfg.python = process.execPath;
  cfg.env.QWEN_FIXTURE_DELAY = '100';
  cfg.env.QWEN_FIXTURE_WORKER_FILE = path.join(directory, 'worker.pid');
  let child, calls = 0;
  const states = [];
  const service = createQwenService(cfg, {
    onStatus: state => states.push(state),
    spawnProcess(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.ok(args.includes('--no-flash-attn'));
      assert.equal(args[args.indexOf('--port') + 1], cfg.url.port);
      assert.equal(args[args.indexOf('--concurrency') + 1], '1');
      return child = spawnFixture(command, args, options);
    },
  });
  t.after(async () => { await service.stop(); await rm(directory, { recursive: true, force: true }); });
  const first = service.start();
  assert.equal(first, service.start());
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(states.map(state => state.phase), ['checking', 'starting', 'ready']);
  assert.equal(states.at(-1).managed, true);
  const workerPid = Number(await readFile(cfg.env.QWEN_FIXTURE_WORKER_FILE, 'utf8'));
  await service.stop();
  await exited(child.pid);
  await exited(workerPid);
  await assert.rejects(fetch(new URL('config', cfg.url)));
});

test('an existing CustomVoice service is reused without a virtualenv and survives Lexi shutdown', async t => {
  const server = createServer((request, response) => response.end(JSON.stringify({ dependencies: [{ api_name: '/run_instruct' }] })));
  const url = await listening(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const cfg = qwenLaunchConfig({ QWEN_TTS_URL: url }, process.cwd());
  const states = [];
  const service = createQwenService(cfg, { onStatus: state => states.push(state), spawnProcess() { assert.fail('Must reuse the existing service'); } });
  t.after(() => service.stop());
  await service.start();
  assert.equal(states.at(-1).managed, false);
  await service.stop();
  assert.equal((await fetch(new URL('config', cfg.url))).status, 200);
});

test('occupied endpoints with the wrong API or model fail instead of launching another process', async t => {
  let body = { dependencies: [{ api_name: 'run_voice_clone' }] };
  const server = createServer((request, response) => response.end(JSON.stringify(body)));
  const url = await listening(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const expected of [/CustomVoice/, /模型/]) {
    const service = createQwenService(config(url), { spawnProcess() { assert.fail('Port already has an incompatible service'); } });
    await assert.rejects(service.start(), expected);
    await service.stop();
    body = { dependencies: [{ api_name: 'run_instruct' }], components: [{ type: 'markdown', props: { value: '**Checkpoint:** `wrong-model`' } }] };
  }
});

test('startup detects a crashed model process and shutdown cancels an unfinished load', async t => {
  for (const mode of ['exit', 'loading', 'timeout']) {
    const cfg = config(await unusedUrl());
    cfg.python = process.execPath;
    cfg.env.QWEN_FIXTURE_MODE = mode;
    cfg.env.QWEN_FIXTURE_DELAY = '30000';
    if (mode === 'timeout') cfg.timeoutMs = 200;
    let child;
    const spawned = Promise.withResolvers();
    const service = createQwenService(cfg, { spawnProcess(...args) { child = spawnFixture(...args); spawned.resolve(); return child; } });
    t.after(() => service.stop());
    const failure = assert.rejects(service.start(), mode === 'exit' ? /已退出/ : mode === 'timeout' ? /加载超过/ : { name: 'AbortError' });
    await spawned.promise;
    if (mode === 'loading') await service.stop();
    await failure;
    await service.stop();
    await exited(child.pid);
  }
});

test('missing installation and nonlocal automatic launch fail with actionable errors', async () => {
  const noDirectory = createQwenService(qwenLaunchConfig({ QWEN_TTS_URL: await unusedUrl() }, process.cwd()));
  await assert.rejects(noDirectory.start(), /QWEN_TTS_DIR/);
  await noDirectory.stop();
  const missing = createQwenService(qwenLaunchConfig({ QWEN_TTS_URL: await unusedUrl(), QWEN_TTS_DIR: '/tmp/lexi-no-such-virtualenv' }, process.cwd()));
  await assert.rejects(missing.start(), /Python/);
  await missing.stop();
  const remote = config(await unusedUrl()); remote.url.pathname = '/proxy/';
  const service = createQwenService(remote);
  await assert.rejects(service.start(), /本机 HTTP/);
  await service.stop();
  assert.equal(remote.model, model);
});
