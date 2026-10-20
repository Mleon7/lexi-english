import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function harness(fetch, env = { TTS_PROVIDER: 'qwen3' }, signal = AbortSignal) {
  const context = vm.createContext({ fetch, AbortSignal: signal, URL, Uint8Array, TextDecoder, atob });
  const cache = new Map();
  const bindings = new vm.SyntheticModule(['env'], function () { this.setExport('env', env); }, { context });
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const mod = new vm.SourceTextModule(code, { context, identifier: file });
    cache.set(file, mod); return mod;
  };
  const providerModule = load(path.resolve('lib/server/providers.ts'));
  await providerModule.link((specifier, parent) => specifier === 'cloudflare:workers' ? bindings : load(path.resolve(path.dirname(parent.identifier), specifier + '.ts')));
  await providerModule.evaluate();
  return providerModule.namespace;
}
const settings = { textModel: 'unused', voiceModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', speechProvider: 'qwen3' };
const wav = new Uint8Array(48); wav.set(new TextEncoder().encode('RIFF'), 0); wav.set(new TextEncoder().encode('WAVE'), 8);
function sse(data, event = 'complete') {
  const bytes = new TextEncoder().encode('event: heartbeat\r\ndata: null\r\n\r\nevent: ' + event + '\r\ndata: ' + JSON.stringify(data) + '\r\n\r\n');
  let offset = 0;
  return new Response(new ReadableStream({ pull(c) { if (offset === bytes.length) c.close(); else { c.enqueue(bytes.slice(offset, offset + 7)); offset = Math.min(bytes.length, offset + 7); } } }));
}

test('Qwen provider submits English to Gradio, reads fragmented SSE and downloads WAV without any API key', async () => {
  const requests = [];
  const p = await harness(async (url, init) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) return Response.json({ event_id: 'test-event' });
    if (requests.length === 2) return sse([{ url: 'http://127.0.0.1:8000/gradio_api/file=/tmp/audio.wav' }, 'Finished. (生成完成)']);
    return new Response(wav);
  });
  assert.equal(p.speechVoices().length, 4);
  const result = await p.speech(settings, 'Hello there.', 'qwen3:Aiden');
  assert.deepEqual(Array.from(result), Array.from(wav));
  assert.deepEqual(JSON.parse(requests[0].init.body), { data: ['Hello there.', 'English', 'Aiden', ''] });
  assert.equal(requests[0].url, 'http://127.0.0.1:8000/gradio_api/call/run_instruct');
  assert.equal(requests[1].url, requests[0].url + '/test-event');
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(requests[2].init.redirect, 'manual');
});

test('Qwen reports Demo errors without leaking raw exceptions or caching an empty file', async () => {
  for (const [data, event, code] of [[ [null, 'CUDA out of memory; secret-path'], 'complete', 'SPEECH_MEMORY'], [[null, 'RuntimeError: private details'], 'complete', 'SPEECH_FAILED'], [{ error: 'private details' }, 'error', 'SPEECH_FAILED']]) {
    let calls = 0;
    const p = await harness(async () => ++calls === 1 ? Response.json({ event_id: 'abc' }) : sse(data, event));
    await assert.rejects(p.speech(settings, 'Hello.', 'qwen3:Ryan'), e => e.code === code && !e.message.includes('private') && !e.message.includes('secret'));
    assert.equal(calls, 2);
  }
});

test('Qwen rejects foreign file URLs and non-WAV output', async () => {
  for (const url of ['https://example.org/audio.wav', 'http://127.0.0.1:8000/config', 'http://127.0.0.1:8000/gradio_api/file=/tmp/audio.wav']) {
    let calls = 0;
    const p = await harness(async () => {
      if (++calls === 1) return Response.json({ event_id: 'abc' });
      if (calls === 2) return sse([{ url }, 'Finished']);
      return new Response('<html>not audio</html>');
    });
    await assert.rejects(p.speech(settings, 'Hello.', 'qwen3:Ryan'), e => e.code === 'SPEECH_FORMAT');
    assert.equal(calls, url.includes('/file=') ? 3 : 2);
  }
});

test('Qwen never follows file redirects, including in the Workers runtime', async () => {
  let calls = 0;
  const p = await harness(async (_url, init) => {
    assert.equal(init.redirect, 'manual');
    if (++calls === 1) return Response.json({ event_id: 'abc' });
    if (calls === 2) return sse([{ url: 'http://127.0.0.1:8000/gradio_api/file=/tmp/audio.wav' }, 'Finished']);
    return new Response(null, { status: 302, headers: { location: 'https://example.org/audio.wav' } });
  });
  await assert.rejects(p.speech(settings, 'Hello.', 'qwen3:Ryan'), e => e.code === 'SPEECH_FAILED');
  assert.equal(calls, 3);
});

test('Qwen handles unavailable service, timeout, invalid voice and incomplete stream', async () => {
  const p = await harness(async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(p.speech(settings, 'Hello.', 'qwen3:Ryan'), e => e.code === 'PROVIDER_UNAVAILABLE');
  await assert.rejects(p.speech(settings, 'Hello.', 'arbitrary'), e => e.code === 'SPEECH_VOICE_CHANGED');
  const timed = await harness(async () => { throw new Error('timeout'); }, { TTS_PROVIDER: 'qwen3' }, { timeout: () => ({ aborted: true }) });
  await assert.rejects(timed.speech(settings, 'Hello.', 'qwen3:Ryan'), e => e.code === 'SPEECH_TIMEOUT');
  let calls = 0;
  const ended = await harness(async () => ++calls === 1 ? Response.json({ event_id: 'abc' }) : sse(null, 'heartbeat'));
  await assert.rejects(ended.speech(settings, 'Hello.', 'qwen3:Ryan'), e => e.code === 'SPEECH_FORMAT');
});

test('MiniMax remains the default with original MP3 decoding', async () => {
  let called = false;
  const p = await harness(async (url, init) => {
    called = true;
    assert.equal(url, 'https://api.minimax.cn/v1/t2a_v2');
    assert.equal(JSON.parse(init.body).audio_setting.format, 'mp3');
    return Response.json({ base_resp: { status_code: 0 }, data: { audio: '494433' } });
  }, { MINIMAX_API_KEY: 'test-key' });
  assert.ok(p.speechVoices()[0].id.startsWith('English_'));
  assert.deepEqual(Array.from(await p.speech({ ...settings, voiceModel: 'speech-2.8-turbo' }, 'Hello.', p.speechVoices()[0].id)), [73, 68, 51]);
  assert.equal(called, true);
});
