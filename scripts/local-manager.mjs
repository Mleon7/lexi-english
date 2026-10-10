import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const runDir = path.join(root, '.local-run');
mkdirSync(runDir, { recursive: true });
const stateFile = path.join(runDir, 'state.json');
const logFile = path.join(runDir, 'server.log');
const windows = process.platform === 'win32';
const socketId = createHash('sha256').update(windows ? root.toLowerCase() : root).digest('hex').slice(0, 20);
const socketDir = path.join(os.tmpdir(), `lexi-${process.getuid?.() ?? 'local'}`);
if (!windows) mkdirSync(socketDir, { recursive: true, mode: 0o700 });
const pipe = windows ? '\\\\.\\pipe\\lexi-' + socketId : path.join(socketDir, socketId + '.sock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } };
let privateValues = [];
function log(message) {
  let safe = String(message);
  for (const key of privateValues) if (key) safe = safe.replaceAll(key, '[redacted]');
  appendFileSync(logFile, safe);
}
function control(command, timeout = 1500) {
  const state = readState();
  if (!state?.token) return Promise.resolve(null);
  return new Promise(resolve => {
    let done = false, text = '';
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
    const socket = createConnection(pipe);
    socket.setTimeout(timeout, () => finish(null));
    socket.on('connect', () => socket.write(JSON.stringify({ command, token: state.token }) + '\n'));
    socket.on('error', () => finish(null));
    socket.on('end', () => { try { finish(JSON.parse(text)); } catch { finish(null); } });
    socket.on('data', chunk => { text += chunk; if (text.length > 8192) finish(null); });
  });
}
async function openBrowser(url) {
  if (!windows) {
    console.log('请在浏览器打开：' + url + '/signin-with-chatgpt?return_to=/');
    return;
  }
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise(resolve => {
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${url}/signin-with-chatgpt?return_to=/'`], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => { console.log('请在浏览器打开：' + url); resolve(); });
    child.once('close', code => { console.log(code === 0 ? '已打开默认浏览器。' : '请在浏览器打开：' + url); resolve(); });
  });
}
async function start() {
  let status = await control('status');
  if (!status) {
    if (!existsSync(path.join(root, '.env'))) throw new Error('缺少 .env 文件，请按 .env.example 填写两个 API 密钥。');
    if (!existsSync(path.join(root, 'node_modules', 'vinext', 'dist', 'cli.js'))) throw new Error('缺少依赖文件，请恢复 node_modules 文件夹。');
    // A Unix socket may remain after an unclean exit. Never unlink a live supervisor.
    if (!windows && existsSync(pipe)) {
      const state = readState();
      if (state?.pid) {
        try { process.kill(state.pid, 0); throw new Error('已有管理进程但无法连接，请检查状态与日志。'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      unlinkSync(pipe);
    }
    const fd = openSync(path.join(runDir, 'launcher.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
    closeSync(fd); child.unref();
    console.log('正在启动词境，请稍候……');
  } else console.log(status.phase === 'ready' ? '词境已在运行。' : '词境正在启动，请稍候……');
  for (let i = 0; i < 240; i++) {
    status = await control('status');
    if (status?.phase === 'ready') {
      console.log('已启动：' + status.url);
      console.log(windows ? '关闭服务请双击“关闭词境.cmd”。关闭浏览器不会停止服务。' : '关闭服务请运行 npm run local:stop。关闭浏览器不会停止服务。');
      if (!process.argv.includes('--no-browser')) await openBrowser(status.url);
      return;
    }
    if (status?.phase === 'error') throw new Error(status.error || '启动失败，请查看 .local-run/server.log。');
    await sleep(500);
  }
  throw new Error('启动等待超时，请查看 .local-run/server.log，或先运行关闭脚本后重试。');
}
async function stop() {
  const response = await control('stop');
  if (!response) { console.log('词境已经关闭。学习记录会继续保留。'); return; }
  for (let i = 0; i < 120; i++) {
    if (!(await control('status'))) { console.log('词境已关闭，学习记录已保留。'); return; }
    await sleep(250);
  }
  throw new Error('服务仍在退出，请稍后再次运行关闭脚本。');
}
async function freePort(preferred) {
  for (let port = preferred; port < preferred + 20 && port < 65536; port++) {
    const free = await new Promise(resolve => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('没有找到可用的本地端口，请修改 .env 中的 PORT。');
}
async function serve() {
  const token = randomBytes(32).toString('hex');
  let status = { phase: 'starting', url: null }, child = null, stopping = false;
  let stopMediaExport = null;
  const server = createServer(socket => {
    let text = '';
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      text += chunk;
      if (text.length > 4096) { socket.destroy(); return; }
      if (!text.includes('\n')) return;
      let request; try { request = JSON.parse(text.trim()); } catch { socket.destroy(); return; }
      if (request.token !== token) { socket.end('{}'); return; }
      if (request.command === 'stop') { socket.end(JSON.stringify({ phase: 'stopping' })); void shutdown(); }
      else socket.end(JSON.stringify(status));
    });
  });
  const listening = await new Promise(resolve => { server.once('error', () => resolve(false)); server.listen(pipe, () => resolve(true)); });
  if (!listening) return;
  writeFileSync(stateFile, JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }));
  async function shutdown() {
    if (stopping) return;
    stopping = true; status = { ...status, phase: 'stopping' };
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        // The PID is the live child owned by this supervisor, never a stale saved PID.
        if (!windows) {
          const pid = child.pid;
          const timer = setTimeout(() => {
            try { process.kill(-pid, 'SIGKILL'); } catch {}
          }, 5000);
          child.once('close', () => { clearTimeout(timer); resolve(); });
          try { process.kill(-pid, 'SIGTERM'); } catch { clearTimeout(timer); resolve(); }
          return;
        }
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', resolve); killer.on('close', resolve);
      });
    }
    if (stopMediaExport) await stopMediaExport();
    if (readState()?.token === token) { try { unlinkSync(stateFile); } catch {} }
    server.close(() => process.exit(0));
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  function run(args, env) {
    return new Promise((resolve, reject) => {
      child = spawn(process.execPath, args, { cwd: root, env, detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', log); child.stderr.on('data', log);
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('本地初始化失败，请查看 .local-run/server.log。')));
    });
  }
  try {
    process.loadEnvFile(path.join(root, '.env'));
    privateValues = [process.env.DEEPSEEK_API_KEY, process.env.MINIMAX_API_KEY].filter(Boolean);
    if (privateValues.length !== 2) throw new Error('请在 .env 中填写 DeepSeek 和 MiniMax 密钥。');
    const requested = Number(process.env.PORT || 5173);
    if (!Number.isInteger(requested) || requested < 1024 || requested > 65515) throw new Error('.env 中 PORT 必须是 1024–65515 之间的数字。');
    const port = await freePort(requested);
    status.url = `http://127.0.0.1:${port}`;
    log('\n--- ' + new Date().toISOString() + ' 正在启动 ---\n');
    const env = { ...process.env, PATH: path.join(root, 'runtime') + path.delimiter + process.env.PATH, CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_PATH: path.join(runDir, 'wrangler-logs'), WRANGLER_REGISTRY_PATH: path.join(runDir, 'wrangler-registry'), MINIFLARE_REGISTRY_PATH: path.join(runDir, 'miniflare-registry') };
    const configPath = path.join(runDir, 'database.json');
    writeFileSync(configPath, JSON.stringify({ name: 'lexi-local', compatibility_date: '2026-05-15', d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000', migrations_dir: path.join(root, 'drizzle') }] }));
    await run(['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', path.join(root, '.wrangler', 'state')], env);
    if (stopping) return;
    child = spawn(process.execPath, ['scripts/run-framework.mjs', 'dev', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: root, env, detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.on('error', () => { status = { ...status, phase: 'error', error: '本地服务无法启动，请查看日志。' }; });
    child.on('exit', () => { if (!stopping) status = { ...status, phase: 'error', error: '本地服务已退出，请先运行关闭脚本，再重新启动。' }; });
    for (let i = 0; i < 220; i++) {
      if (status.phase === 'error' || stopping) return;
      try {
        const response = await fetch(status.url + '/api/state', { signal: AbortSignal.timeout(1500) });
        if (response.status === 401) { const { startMediaExport } = await import("./media-export.mjs"); stopMediaExport = startMediaExport(root, log); status = { ...status, phase: 'ready' }; log('服务已就绪：' + status.url + '\n'); return; }
      } catch {}
      await sleep(400);
    }
    throw new Error('服务启动超时，请查看日志，然后关闭并重新启动。');
  } catch (error) {
    status = { ...status, phase: 'error', error: error.message }; log(error.stack + '\n');
  }
}

try {
  const action = process.argv[2];
  if (action === 'serve') await serve();
  else if (action === 'start') await start();
  else if (action === 'stop') await stop();
  else if (action === 'status') console.log(JSON.stringify(await control('status') || { phase: 'stopped' }));
  else throw new Error('用法：local-manager.mjs start | stop | status');
} catch (error) { console.error('词境：' + error.message); process.exitCode = 1; }
