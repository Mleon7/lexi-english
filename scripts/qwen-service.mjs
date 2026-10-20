import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function qwenLaunchConfig(env, root, platform = process.platform) {
  let url;
  try {
    const address = env.QWEN_TTS_URL || 'http://127.0.0.1:8000';
    url = new URL(address.endsWith('/') ? address : address + '/');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { throw new Error('QWEN_TTS_URL 格式错误，请填写本地 Qwen Demo 地址。'); }
  const timeoutSeconds = Number(env.QWEN_TTS_START_TIMEOUT || 600);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 3600) throw new Error('QWEN_TTS_START_TIMEOUT 必须是 10–3600 之间的秒数。');
  const dtype = env.QWEN_TTS_DTYPE || 'bfloat16';
  if (!['bfloat16', 'bf16', 'float16', 'fp16', 'float32', 'fp32'].includes(dtype)) throw new Error('QWEN_TTS_DTYPE 必须是 bfloat16、float16 或 float32。');
  const offline = env.QWEN_TTS_OFFLINE || '1';
  if (!['0', '1'].includes(offline)) throw new Error('QWEN_TTS_OFFLINE 必须是 1（使用缓存）或 0（允许下载）。');
  // Paths follow `platform`, not the host, so either platform can be checked anywhere.
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const cwd = env.QWEN_TTS_DIR ? paths.resolve(root, env.QWEN_TTS_DIR) : null;
  const python = cwd ? paths.join(cwd, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : null;
  return {
    url, cwd, python, timeoutMs: timeoutSeconds * 1000,
    model: env.QWEN_TTS_MODEL || 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    device: env.QWEN_TTS_DEVICE || 'cuda:0', dtype,
    env: {
      ...env, PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: offline,
      ...(cwd ? {
        VIRTUAL_ENV: paths.join(cwd, '.venv'),
        PATH: paths.dirname(python) + paths.delimiter + (env.PATH || ''),
        HF_HOME: env.QWEN_TTS_HF_HOME || paths.join(cwd, 'models', 'huggingface'),
      } : {}),
    },
  };
}

export function qwenCheckpoint(config) {
  const local = path.resolve(config.cwd || '.', config.model);
  if (existsSync(path.join(local, 'config.json'))) return local;
  if (config.env.HF_HUB_OFFLINE !== '1') return config.model;
  try {
    const cache = path.join(config.env.HF_HOME, 'hub', 'models--' + config.model.replaceAll('/', '--'));
    const revision = readFileSync(path.join(cache, 'refs', 'main'), 'utf8').trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error();
    const snapshot = path.join(cache, 'snapshots', revision);
    if (!existsSync(path.join(snapshot, 'config.json'))) throw new Error();
    // Passing a local directory also prevents Transformers' tokenizer metadata
    // checks, which can call model_info even when HF_HUB_OFFLINE is enabled.
    return snapshot;
  } catch { throw new Error('本地缓存中未找到 Qwen 模型，请检查 QWEN_TTS_HF_HOME，或设置 QWEN_TTS_OFFLINE=0 下载模型。'); }
}

// Only terminate live children owned by this supervisor, including their workers.
export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve); killer.once('close', resolve);
    });
    return;
  }
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 5000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { clearTimeout(timer); resolve(); }
  });
}

async function checkFreePort(port, host) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Qwen3-TTS 端口 ${port} 已被占用或无法监听，请检查 QWEN_TTS_URL。`)));
    probe.listen(port, host, () => probe.close(resolve));
  });
}

export function createQwenService(config, { log = () => {}, onStatus = () => {}, spawnProcess = spawn } = {}) {
  const controller = new AbortController();
  let child = null, failure = null, pending = null, checkpoint = config.model;
  const update = (phase, managed) => onStatus({ phase, managed, url: config.url.href.replace(/\/$/, '') });

  async function probe(signal) {
    let response;
    try {
      response = await fetch(new URL('config', config.url), {
        redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      });
    } catch {
      signal.throwIfAborted();
      return false;
    }
    const incompatible = () => new Error('QWEN_TTS_URL 上的服务不是可用的 Qwen CustomVoice Demo，请检查端口和模型。');
    if (!response.ok) { await response.body?.cancel(); throw incompatible(); }
    let info;
    try { info = await response.json(); } catch { throw incompatible(); }
    if (!info?.dependencies?.some(item => ['run_instruct', '/run_instruct'].includes(item.api_name))) throw incompatible();
    const header = info.components?.find(item => item.type === 'markdown' && /\*\*Checkpoint:\*\*/.test(item.props?.value || ''));
    const loaded = header?.props.value.match(/\*\*Checkpoint:\*\*\s*`([^`]+)`/)?.[1];
    if (loaded && loaded !== config.model && loaded !== checkpoint) {
      let cached;
      try { cached = qwenCheckpoint(config); } catch { /* No local model to match. */ }
      if (loaded !== cached) throw new Error('Qwen Demo 加载的模型与 QWEN_TTS_MODEL 不一致，请同步配置后重新启动。');
    }
    return true;
  }

  async function launch() {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs)]);
    update('checking', false);
    if (await probe(signal)) {
      signal.throwIfAborted();
      update('ready', false);
      log('已复用现有 Qwen3-TTS：' + config.url.href + '\n');
      return;
    }
    signal.throwIfAborted();
    if (!config.cwd) throw new Error('Qwen3-TTS 未运行，请在 .env 中设置 QWEN_TTS_DIR，或先手动启动 Qwen Demo。');
    if (config.url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(config.url.hostname) || config.url.pathname !== '/') throw new Error('自动启动 Qwen3-TTS 仅支持本机 HTTP 地址；其他地址请先手动启动 Demo。');
    if (!existsSync(config.python)) throw new Error('QWEN_TTS_DIR 中缺少 .venv Python 环境，请检查安装目录。');
    const host = config.url.hostname === 'localhost' ? '127.0.0.1' : config.url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(config.url.port || 80);
    await checkFreePort(port, host);
    signal.throwIfAborted();
    checkpoint = qwenCheckpoint(config);
    update('starting', true);
    log('正在启动 Qwen3-TTS 并加载模型：' + config.model + '\n');
    child = spawnProcess(config.python, [
      '-m', 'qwen_tts.cli.demo', checkpoint,
      '--device', config.device, '--dtype', config.dtype, '--no-flash-attn',
      '--ip', host, '--port', String(port), '--concurrency', '1',
    ], { cwd: config.cwd, env: config.env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.once('error', () => { failure = new Error('Qwen3-TTS 无法启动，请查看 .local-run/qwen-tts.log。'); });
    child.once('exit', () => {
      if (!controller.signal.aborted) {
        failure = new Error('Qwen3-TTS 已退出，请查看 .local-run/qwen-tts.log，然后重新启动词境。');
        update('error', true);
      }
    });
    try {
      while (true) {
        signal.throwIfAborted();
        if (failure) throw failure;
        if (await probe(signal)) {
          if (failure) throw failure;
          signal.throwIfAborted();
          update('ready', true);
          log('Qwen3-TTS 已就绪：' + config.url.href + '\n');
          return;
        }
        await delay(1000, undefined, { signal });
      }
    } catch (error) {
      if (!controller.signal.aborted && signal.aborted) throw new Error(`Qwen3-TTS 加载超过 ${config.timeoutMs / 1000} 秒，请查看 .local-run/qwen-tts.log；可调整 QWEN_TTS_START_TIMEOUT。`);
      throw error;
    }
  }

  return {
    start() { pending ??= launch(); return pending; },
    async stop() {
      controller.abort();
      await pending?.catch(() => {});
      await stopChild(child);
      if (child) update('stopped', true);
    },
  };
}
