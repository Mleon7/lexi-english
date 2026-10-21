import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

async function harness(options = {}) {
  const root = path.resolve(import.meta.dirname, '..');
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
  const adapter = {
    prepare(sql) {
      let values = [];
      const api = { bind(...args) { values = args; return api; },
        async first() { return db.prepare(sql).get(...values) || null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: db.prepare(sql).run(...values).changes } }; } };
      return api;
    },
    async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
  const materials = [{ id: 'description', kind: 'description', text: 'Very careful about details.' }, { id: 'example', kind: 'example', text: 'She was meticulous about her desk.' }, { id: 'synonym', kind: 'synonym', text: 'He was careful with the cup.' }];
  db.prepare('INSERT INTO senses(id,user_id,word,phonetic,pos,meaning,definition,learned,mastery,review_count,materials,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,0,0,?,1,1)').run('sense-a', 'tester', 'meticulous', '', 'adj.', '一丝不苟的', 'Very careful about every detail.', JSON.stringify(materials));
  const calls = []; let replies = [{}];
  const audio = new Map(), speechCalls = [];
  const env = { DB: adapter, ...options, BUCKET: {
    async head(key) { return audio.get(key) || null; },
    async put(key, bytes, metadata) { audio.set(key, { bytes, ...metadata }); },
    async delete(key) { audio.delete(key); },
  } };
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, atob });
  const envModule = new vm.SyntheticModule(['env'], function () { this.setExport('env', env); }, { context });
  const providers = new vm.SyntheticModule(['generate', 'speech', 'generateImage', 'speechVoices'], function () {
    // set(a, b) answers successive model calls in order; the last reply repeats.
    this.setExport('generate', async (_settings, instruction, data) => { calls.push({ instruction, data }); return replies.length > 1 ? replies.shift() : replies[0]; });
    this.setExport('speech', async (...args) => { speechCalls.push(args); return new Uint8Array([1, 2, 3]); });
    this.setExport('generateImage', async () => { throw new Error('Unexpected image generation'); });
    this.setExport('speechVoices', () => env.TTS_PROVIDER === 'qwen3' ? ['Ryan', 'Aiden', 'Serena', 'Vivian'].map(name => ({ id: 'qwen3:' + name, label: name })) : [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }]);
  }, { context });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const sourceModule = new vm.SourceTextModule(code, { context, identifier: file }); cache.set(file, sourceModule); return sourceModule;
  }
  const service = load(path.join(root, 'lib/server/service.ts'));
  await service.link((specifier, parent) => specifier === 'cloudflare:workers' ? envModule : specifier === './providers' ? providers : load(path.resolve(path.dirname(parent.identifier), specifier + '.ts')));
  await service.evaluate();
  return { db, calls, audio, speechCalls, env, set(...values) { replies = values; }, action: body => service.namespace.action('tester', body) };
}

test('switching speech provider uses local voices and WAV cache, retaining MiniMax settings and audio', async () => {
  const h = await harness();
  try {
    await h.action({ action: 'settings', textModel: 'deepseek-flash', voiceModel: 'speech-2.6-hd' });
    const start = () => h.action({ action: 'listeningStart', senseId: 'sense-a', materialId: 'example' });
    const cloud = await start();
    const cloudAudio = await h.action({ action: 'listeningAudio', sessionId: cloud.sessionId, voiceId: cloud.voices[0].id });
    h.env.TTS_PROVIDER = 'qwen3';
    const local = await start();
    assert.equal(local.voices.length, 3);
    assert.ok(local.voices.every(v => v.id.startsWith('qwen3:')));
    for (const action of ['listeningAudio', 'listeningMore']) await assert.rejects(h.action({ action, sessionId: cloud.sessionId, voiceId: cloud.voices[0].id }), e => e.code === 'SPEECH_VOICE_CHANGED');
    const play = () => h.action({ action: 'listeningAudio', sessionId: local.sessionId, voiceId: local.voices[0].id });
    const result = await play();
    assert.equal((await play()).url, result.url);
    assert.notEqual(result.url, cloudAudio.url);
    assert.equal(h.speechCalls.length, 2);
    assert.ok(h.speechCalls[1][0].voiceModel.includes('CustomVoice'));
    assert.equal([...h.audio.keys()].filter(key => key.endsWith('.wav')).length, 1);
    assert.equal([...h.audio.values()][1].httpMetadata.contentType, 'audio/wav');
    const changed = await h.action({ action: 'settings', textModel: 'deepseek-new', voiceModel: 'ignored/local-model' });
    assert.equal(changed.settings.speechProvider, 'qwen3');
    assert.equal(h.db.prepare('SELECT voice_model FROM user_settings').get().voice_model, 'speech-2.6-hd');
    h.env.QWEN_TTS_MODEL = 'Qwen/another-CustomVoice';
    assert.notEqual((await play()).url, result.url);
    h.env.TTS_PROVIDER = 'minimax';
    assert.equal((await h.action({ action: 'listeningAudio', sessionId: cloud.sessionId, voiceId: cloud.voices[0].id })).url, cloudAudio.url);
    assert.equal(h.speechCalls.length, 3);
  } finally { h.db.close(); }
});

test('review moves directly to independent writing and assesses the learner context', async () => {
  const h = await harness();
  try {
    h.set({ scenario: 'A worker checks every tiny detail.', sentence: 'The worker is ____ about every detail.' });
    const review = await h.action({ action: 'reviewStart' });
    assert.match(h.calls[0].instruction, /English scenario/);
    const filled = await h.action({ action: 'reviewBlank', reviewId: review.reviewId, answer: 'meticulous' });
    assert.equal(filled.correct, true); assert.equal(filled.scenario, undefined); assert.equal(h.calls.length, 1);
    h.set({ appropriate: true, score: 92, scenarioFeedback: 'Your chosen laboratory context demonstrates care for detail.', grammarFeedback: 'Use past tense consistently.', improvedSentence: 'I was meticulous when I labelled every sample in the laboratory.' });
    const result = await h.action({ action: 'reviewSentence', reviewId: review.reviewId, answer: 'I was meticulous when I label every sample in the laboratory.' });
    assert.equal(result.passed, true);
    assert.match(h.calls[1].instruction, /given NO scenario/);
    assert.match(h.calls[1].instruction, /Minor grammar errors MUST NOT cause failure/);
    assert.equal(h.calls[1].data.scenario, undefined);
    assert.equal(h.db.prepare('SELECT review_count FROM senses').get().review_count, 1);
    assert.equal(result.collected, true);
    const kept = JSON.parse(h.db.prepare('SELECT materials FROM senses').get().materials).at(-1);
    assert.deepEqual([kept.kind, kept.text, kept.practice, kept.exerciseId], ['example', 'I was meticulous when I labelled every sample in the laboratory.', 'review', review.reviewId]);
    await assert.rejects(h.action({ action: 'reviewSentence', reviewId: review.reviewId, answer: 'I was meticulous when I label every sample in the laboratory.' }), e => e.code === 'STAGE_MISMATCH');
  } finally { h.db.close(); }
});

test('a review sentence that fails is not kept as an example', async () => {
  const h = await harness();
  try {
    h.set({ scenario: 'A worker checks every tiny detail.', sentence: 'The worker is ____ about every detail.' });
    const review = await h.action({ action: 'reviewStart' });
    await h.action({ action: 'reviewBlank', reviewId: review.reviewId, answer: 'meticulous' });
    h.set({ appropriate: false, score: 30, scenarioFeedback: 'This is not about care.', grammarFeedback: 'Fine.', improvedSentence: 'The meticulous storm hit the town.' });
    const result = await h.action({ action: 'reviewSentence', reviewId: review.reviewId, answer: 'The meticulous storm hit the town.' });
    assert.equal(result.passed, false); assert.equal(result.collected, false);
    assert.equal(JSON.parse(h.db.prepare('SELECT materials FROM senses').get().materials).length, 3);
  } finally { h.db.close(); }
});

test('the corrected writing sentence becomes one example per exercise', async () => {
  const h = await harness();
  try {
    const materials = () => JSON.parse(h.db.prepare('SELECT materials FROM senses').get().materials);
    const feedback = improvedSentence => ({ appropriate: true, score: 90, scenarioFeedback: '很好。', grammarFeedback: '注意时态。', improvedSentence });
    h.set({ scenario: 'You are checking an important report.' });
    const { exerciseId } = await h.action({ action: 'writingScenario', senseId: 'sense-a' });
    h.set(feedback('I was meticulous when I checked the report.'));
    const first = await h.action({ action: 'writingSubmit', exerciseId, answer: 'I am meticulous when I checked the report.' });
    assert.equal(first.collected, true);
    assert.deepEqual(JSON.parse(JSON.stringify(first.sense.materials.slice(3).map(item => [item.kind, item.text, item.practice]))), [['example', 'I was meticulous when I checked the report.', 'writing']]);

    // Checking the same exercise again replaces its sentence instead of adding another.
    h.set(feedback('I was meticulous as I checked every figure in the report.'));
    const second = await h.action({ action: 'writingSubmit', exerciseId, answer: 'I was meticulous as I check every figure in the report.' });
    assert.deepEqual(JSON.parse(JSON.stringify(second.sense.materials.slice(3).map(item => item.text))), ['I was meticulous as I checked every figure in the report.']);
    h.set({ appropriate: false, score: 20, scenarioFeedback: '词义不对。', grammarFeedback: '语法正确。', improvedSentence: 'The meticulous rain fell.' });
    const failed = await h.action({ action: 'writingSubmit', exerciseId, answer: 'The meticulous rain fell.' });
    assert.equal(failed.collected, false); assert.equal(failed.sense, undefined); assert.equal(materials().length, 4);

    // A sentence that is already an example is not added twice.
    h.set({ scenario: 'You tidy your desk.' });
    const other = await h.action({ action: 'writingScenario', senseId: 'sense-a' });
    h.set(feedback('She was meticulous about her desk!'));
    assert.equal((await h.action({ action: 'writingSubmit', exerciseId: other.exerciseId, answer: 'She was meticulous about her desk.' })).collected, true);
    assert.equal(materials().length, 4);
  } finally { h.db.close(); }
});
test('writing scenarios request English; translations retain cloze blanks', async () => {
  const h = await harness();
  try {
    h.set({ scenario: 'You are checking an important report. Describe how carefully you work.' });
    const writing = await h.action({ action: 'writingScenario', senseId: 'sense-a' });
    assert.match(h.calls[0].instruction, /English practical scenario/); assert.ok(writing.exerciseId);
    h.set({ translation: '她对每个细节都____。' });
    const translated = await h.action({ action: 'translateText', text: 'She is ____ about every detail.' });
    assert.ok(translated.translation.includes('____'));
    h.set({ translation: '她对每个细节都一丝不苟。' });
    await assert.rejects(h.action({ action: 'translateText', text: 'She is ____ about every detail.' }), e => e.code === 'INVALID_MODEL_OUTPUT');
  } finally { h.db.close(); }
});
test('listening rejects descriptions, allows example sentences, and keeps answer locked', async () => {
  const h = await harness();
  try {
    await assert.rejects(h.action({ action: 'listeningStart', senseId: 'sense-a', materialId: 'description' }), e => e.code === 'EXAMPLE_REQUIRED');
    for (const materialId of ['example', 'synonym']) {
      const session = await h.action({ action: 'listeningStart', senseId: 'sense-a', materialId });
      assert.equal(session.voices.length, 3); assert.equal(session.text, undefined);
      await assert.rejects(h.action({ action: 'listeningHint', sessionId: session.sessionId }), e => e.code === 'DICTATION_REQUIRED');
    }
  } finally { h.db.close(); }
});

test('listening preserves added voices and their order across refreshes and fresh attempts', async () => {
  const h = await harness();
  try {
    const start = () => h.action({ action: 'listeningStart', senseId: 'sense-a', materialId: 'example' });
    const first = await start();
    const added = await h.action({ action: 'listeningMore', sessionId: first.sessionId });
    assert.equal(added.voices.length, 4);
    assert.equal(JSON.stringify(added.voices.slice(0, 3)), JSON.stringify(first.voices));
    const refreshed = await start();
    assert.notEqual(refreshed.sessionId, first.sessionId);
    assert.equal(JSON.stringify(refreshed.voices), JSON.stringify(added.voices));
    await h.action({ action: 'listeningSubmit', sessionId: refreshed.sessionId, answer: 'She was meticulous about her desk.' });
    const restarted = await start();
    assert.equal(JSON.stringify(restarted.voices), JSON.stringify(added.voices));
    assert.equal(restarted.submitted, false);
    assert.equal(restarted.text, undefined);
    assert.equal(restarted.answer, undefined);
    await assert.rejects(h.action({ action: 'listeningHint', sessionId: restarted.sessionId }), e => e.code === 'DICTATION_REQUIRED');
    await assert.rejects(h.action({ action: 'listeningMore', sessionId: restarted.sessionId }), e => e.code === 'ALL_VOICES_ADDED');
    const differentMaterial = await h.action({ action: 'listeningStart', senseId: 'sense-a', materialId: 'synonym' });
    assert.equal(differentMaterial.voices.length, 3);
    assert.equal(JSON.stringify((await start()).voices), JSON.stringify(added.voices));
  } finally { h.db.close(); }
});

test('listening recovers voices from older attempts and isolates user, sense, material, and text', async () => {
  const h = await harness();
  try {
    const seed = h.db.prepare('INSERT INTO exercises(id,user_id,sense_id,kind,stage,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    const savedVoices = [{ id: 'c', label: 'C' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    const stored = { materialId: 'example', text: 'She was meticulous about her desk.', voices: savedVoices };
    seed.run('older', 'tester', 'sense-a', 'listening', 'listening', JSON.stringify(stored), 1, 1);
    seed.run('latest', 'tester', 'sense-a', 'listening', 'listening', JSON.stringify({ ...stored, voices: savedVoices.slice(0, 2) }), 2, 2);
    const extra = { ...stored, voices: [{ id: 'd', label: 'D' }] };
    seed.run('other-user', 'someone-else', 'sense-a', 'listening', 'listening', JSON.stringify(extra), 3, 3);
    seed.run('other-sense', 'tester', 'sense-b', 'listening', 'listening', JSON.stringify(extra), 4, 4);
    seed.run('other-material', 'tester', 'sense-a', 'listening', 'listening', JSON.stringify({ ...extra, materialId: 'synonym' }), 5, 5);
    seed.run('other-text', 'tester', 'sense-a', 'listening', 'listening', JSON.stringify({ ...extra, text: 'An older sentence.' }), 6, 6);
    seed.run('other-kind', 'tester', 'sense-a', 'writing', 'writing', JSON.stringify(extra), 7, 7);
    const session = await h.action({ action: 'listeningStart', senseId: 'sense-a', materialId: 'example' });
    assert.deepEqual(JSON.parse(JSON.stringify(session.voices)), savedVoices);
  } finally { h.db.close(); }
});

const lesson = { description: { text: 'To begin doing something.' }, examples: [{ text: 'We start work at nine.' }, { text: 'She started to laugh.' }, { text: 'Let us start again.' }], synonym: { text: 'They began the meeting.', term: 'begin', relationNote: '近义' }, antonym: { text: 'They stopped the meeting.', term: 'stop', relationNote: '反义' } };
const lyric = '[Verse 1]\nI\'m startin\' with the river\nI\'m startin\' with the river\n\n[Chorus]\nStart the long road home';

test('passages are normalised, listed per user, edited, and deleted', async () => {
  const h = await harness();
  try {
    const { passage } = await h.action({ action: 'passageSave', title: 'River Song', author: '  ', text: 'Line one  \r\n\r\n\r\n\r\nLine two' });
    assert.equal(passage.text, 'Line one\n\nLine two'); assert.equal(passage.author, '');
    await assert.rejects(h.action({ action: 'passageSave', title: 'Empty', text: '你好' }), e => e.code === 'INVALID_INPUT');
    const edited = await h.action({ action: 'passageSave', passageId: passage.id, title: 'River Song', author: 'Someone', text: lyric });
    assert.equal(edited.passage.author, 'Someone'); assert.equal(edited.passage.text, lyric);
    await assert.rejects(h.action({ action: 'passageSave', passageId: 'missing', title: 'x', text: 'words' }), e => e.code === 'NOT_FOUND');
    h.db.prepare("INSERT INTO passages(id,user_id,title,author,text,created_at,updated_at) VALUES('theirs','someone-else','Private','','secret words',1,1)").run();
    await assert.rejects(h.action({ action: 'passageDelete', passageId: 'theirs' }), e => e.code === 'NOT_FOUND');
    await h.action({ action: 'passageDelete', passageId: passage.id });
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM passages WHERE user_id='tester'").get().n, 0);
  } finally { h.db.close(); }
});

test('a word picked from a lyric line resolves its sense from that line and keeps the line as an example', async () => {
  const h = await harness();
  try {
    const { passage } = await h.action({ action: 'passageSave', title: 'River Song', text: lyric });
    const line = "I'm startin' with the river";
    await assert.rejects(h.action({ action: 'passageLookup', passageId: passage.id, line, selection: 'road' }), e => e.code === 'INVALID_INPUT');
    await assert.rejects(h.action({ action: 'passageLookup', passageId: passage.id, line: 'Not in the song', selection: 'song' }), e => e.code === 'LINE_CHANGED');
    h.set({ word: 'start', contextIndex: 1, senses: [{ pos: 'v.', meaning: '启动（机器）', definition: 'To make a machine begin working.', frequency: 3 }, { pos: 'v.', meaning: '开始', definition: 'To begin doing something.', frequency: 5 }] });
    const found = await h.action({ action: 'passageLookup', passageId: passage.id, line, selection: 'startin' });
    assert.equal(found.sense.word, 'start'); assert.equal(found.sense.meaning, '开始'); assert.equal(found.sense.learned, false); assert.equal(found.collected, false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].data)), { selection: 'startin', line, nextLine: "I'm startin' with the river" });
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE word='start'").get().n, 2);

    h.set(lesson);
    const added = await h.action({ action: 'passageAdd', passageId: passage.id, line, senseId: found.sense.id });
    assert.equal(added.sense.learned, true);
    const quotes = added.sense.materials.filter(item => item.source);
    assert.deepEqual(JSON.parse(JSON.stringify(quotes.map(item => [item.kind, item.text, item.source]))), [['example', line, 'River Song']]);
    assert.equal(added.sense.materials.length, 7);
    const again = await h.action({ action: 'passageAdd', passageId: passage.id, line, senseId: found.sense.id });
    assert.equal(again.sense.materials.length, 7); assert.equal(h.calls.length, 2);

    // A known word asks the model to match the saved senses instead of adding duplicates.
    h.set({ word: 'start', contextIndex: 0, senses: [{ pos: 'v.', meaning: '开始', definition: 'To begin.' }] }, { matchId: found.sense.id, sense: null });
    const known = await h.action({ action: 'passageLookup', passageId: passage.id, line: 'Start the long road home', selection: 'Start' });
    assert.equal(known.sense.id, found.sense.id); assert.equal(known.collected, false);
    assert.equal(h.calls[3].data.senses.length, 2);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE word='start'").get().n, 2);
    const second = await h.action({ action: 'passageAdd', passageId: passage.id, line: 'Start the long road home', senseId: found.sense.id });
    assert.equal(second.sense.materials.filter(item => item.source).length, 2); assert.equal(h.calls.length, 4);
    h.set({ word: 'start', contextIndex: 0, senses: [{ pos: 'v.', meaning: '开始', definition: 'To begin.' }] }, { matchId: found.sense.id, sense: null });
    assert.equal((await h.action({ action: 'passageLookup', passageId: passage.id, line, selection: 'startin' })).collected, true);

    h.set({ word: 'start', contextIndex: 0, senses: [{ pos: 'v.', meaning: '开始', definition: 'To begin.' }] }, { matchId: null, sense: { pos: 'n.', meaning: '惊跳', definition: 'A sudden movement of surprise.', frequency: 2 } });
    const fresh = await h.action({ action: 'passageLookup', passageId: passage.id, line, selection: 'startin' });
    assert.equal(fresh.sense.meaning, '惊跳'); assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE word='start'").get().n, 3);
  } finally { h.db.close(); }
});

test('fixed expressions are marked once per text version and steer the lookup of a tapped expression', async () => {
  const h = await harness();
  try {
    const text = '[Verse]\nI came across a river\nI came across a river\n\nNow I give it up';
    const { passage } = await h.action({ action: 'passageSave', title: 'River Song', text });
    assert.equal(passage.phrases, null);
    h.set({ phrases: [
      { line: 0, text: 'came across', phrase: 'Come Across' },
      { line: 1, text: 'give it up', phrase: 'give up' },
      { line: 1, text: 'give it up', phrase: 'give up' },
      { line: 0, text: 'across a lake', phrase: 'across' },
      { line: 7, text: 'came across', phrase: 'come across' },
      { line: '1', text: 'Now I', phrase: 'now' },
      { line: 1, text: 'Now I give it up', phrase: 'ignore <this>' },
    ] });
    const { passage: marked } = await h.action({ action: 'passagePhrases', passageId: passage.id });
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].data.lines)), ['I came across a river', 'Now I give it up']);
    assert.deepEqual(JSON.parse(JSON.stringify(marked.phrases)), [{ line: 'I came across a river', text: 'came across', phrase: 'come across' }, { line: 'Now I give it up', text: 'give it up', phrase: 'give up' }]);
    assert.equal(marked.updatedAt, passage.updatedAt);

    h.set({ word: 'come across', contextIndex: 0, senses: [{ pos: 'phr. v.', meaning: '偶然遇见', definition: 'To find or meet by chance.', frequency: 4 }] });
    const found = await h.action({ action: 'passageLookup', passageId: passage.id, line: 'I came across a river', selection: 'came across' });
    assert.equal(found.sense.word, 'come across'); assert.equal(h.calls[1].data.phrase, 'come across');
    h.set({ word: 'river', contextIndex: 0, senses: [{ pos: 'n.', meaning: '河', definition: 'A large stream of water.', frequency: 4 }] });
    await h.action({ action: 'passageLookup', passageId: passage.id, line: 'I came across a river', selection: 'river' });
    assert.equal(h.calls[2].data.phrase, undefined);

    assert.equal((await h.action({ action: 'passageSave', passageId: passage.id, title: 'Renamed', text })).passage.phrases.length, 2);
    const edited = await h.action({ action: 'passageSave', passageId: passage.id, title: 'Renamed', text: `${text}\nOne more line` });
    assert.equal(edited.passage.phrases, null);
    // The text changes again while the model is still answering: that answer is not saved.
    h.set({ get phrases() { h.db.prepare("UPDATE passages SET text='Brand new words' WHERE id=?").run(passage.id); return [{ line: 0, text: 'came across', phrase: 'come across' }]; } });
    assert.equal((await h.action({ action: 'passagePhrases', passageId: passage.id })).passage.phrases, null);
    h.set({ phrases: 'none' });
    await assert.rejects(h.action({ action: 'passagePhrases', passageId: passage.id }), e => e.code === 'INVALID_MODEL_OUTPUT');
  } finally { h.db.close(); }
});

test('pasted text can be put one sentence per line without changing a word', async () => {
  const h = await harness();
  try {
    const pasted = "I'm gonna make a change\nfor once in my life. It's gonna feel\nreal good";
    h.set({ lines: ["I'm gonna make a change for once in my life.", "It's gonna feel real good"] });
    const split = await h.action({ action: 'passageSave', title: 'Change', text: pasted, splitLines: true });
    assert.equal(split.passage.text, "I'm gonna make a change for once in my life.\nIt's gonna feel real good");
    assert.equal(split.lines, 'changed'); assert.equal(h.calls[0].data.text, pasted); assert.match(h.calls[0].instruction, /one sentence/);

    // An answer that does not line up with the pasted words keeps the text as pasted.
    h.set({ lines: ['Something else entirely'] });
    const kept = await h.action({ action: 'passageSave', passageId: split.passage.id, title: 'Change', text: pasted, splitLines: true });
    assert.equal(kept.passage.text, pasted); assert.equal(kept.lines, 'failed'); assert.ok(kept.linesError);

    const calls = h.calls.length;
    const plain = await h.action({ action: 'passageSave', title: 'Plain', text: pasted });
    assert.equal(plain.passage.text, pasted); assert.equal(plain.lines, undefined); assert.equal(h.calls.length, calls);
    h.set({ lines: pasted.split('\n') });
    assert.equal((await h.action({ action: 'passageSave', passageId: plain.passage.id, title: 'Plain', text: pasted, splitLines: true })).lines, 'unchanged');
  } finally { h.db.close(); }
});

test('looked-up meanings carry how common they are, and unrated ones are rated once', async () => {
  const h = await harness();
  try {
    h.set({ senses: [{ pos: 'n.', meaning: '银行', definition: 'A place that keeps money.', frequency: 5 }, { pos: 'n.', meaning: '河岸', definition: 'The side of a river.', frequency: '3' }, { pos: 'v.', meaning: '倾斜转弯', definition: 'To tilt while turning.', frequency: 9 }] }, { ratings: [{ id: 'unknown', frequency: 4 }] });
    const first = await h.action({ action: 'lookup', word: 'Bank' });
    assert.match(h.calls[0].instruction, /most to the least common/); assert.match(h.calls[0].instruction, /"frequency"/);
    // The out-of-range rating is asked again and stays unrated when the answer does not fit.
    assert.deepEqual(first.senses.map(s => s.frequency), [5, 3, 0]);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].data.senses.map(s => s.id))), [first.senses[2].id]);
    assert.deepEqual(h.db.prepare("SELECT frequency FROM senses WHERE word='bank' ORDER BY created_at").all().map(r => r.frequency), [5, 3, 0]);

    h.set({ ratings: [{ id: first.senses[2].id, frequency: 2 }, { id: first.senses[0].id, frequency: 1 }] });
    const again = await h.action({ action: 'lookup', word: 'bank' });
    assert.deepEqual(again.senses.map(s => s.frequency), [5, 3, 2]);
    assert.equal(h.calls.length, 3);
    await h.action({ action: 'lookup', word: 'bank' });
    assert.equal(h.calls.length, 3);
  } finally { h.db.close(); }
});

test('meanings saved before frequencies existed are rated in batches', async () => {
  const h = await harness();
  try {
    const insert = h.db.prepare("INSERT INTO senses(id,user_id,word,phonetic,pos,meaning,definition,learned,mastery,review_count,materials,created_at,updated_at) VALUES(?,?,?,'','n.','义','Meaning.',?,0,0,'[]',?,1)");
    for (let i = 0; i < 41; i++) insert.run(`old-${i}`, 'tester', `word${i}`, 1, 10 + i);
    insert.run('not-learned', 'tester', 'other', 0, 100); insert.run('theirs', 'someone-else', 'other', 1, 100);
    h.set({ ratings: [{ id: 'sense-a', frequency: 3 }, ...Array.from({ length: 39 }, (_, i) => ({ id: `old-${i}`, frequency: 4 })), { id: 'theirs', frequency: 5 }] });
    const first = await h.action({ action: 'senseFrequency' });
    assert.equal(h.calls[0].data.senses.length, 40); assert.equal(first.done, false); assert.equal(first.senses.length, 40);
    assert.equal(h.db.prepare("SELECT frequency FROM senses WHERE id='sense-a'").get().frequency, 3);
    assert.equal(h.db.prepare("SELECT frequency FROM senses WHERE id='theirs'").get().frequency, 0);
    h.set({ ratings: [{ id: 'old-39', frequency: 2 }, { id: 'old-40', frequency: 1 }] });
    const second = await h.action({ action: 'senseFrequency' });
    assert.equal(second.done, true); assert.deepEqual(second.senses.map(s => s.frequency), [2, 1]);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE user_id='tester' AND learned=1 AND frequency=0").get().n, 0);
    assert.equal(h.db.prepare("SELECT frequency FROM senses WHERE id='not-learned'").get().frequency, 0);
    const calls = h.calls.length;
    assert.deepEqual(JSON.parse(JSON.stringify(await h.action({ action: 'senseFrequency' }))), { senses: [], done: true });
    assert.equal(h.calls.length, calls);
  } finally { h.db.close(); }
});

test('deleting some meanings keeps them for the next lookup; deleting the last one removes the word', async () => {
  const h = await harness();
  try {
    h.set({ senses: [{ pos: 'n.', meaning: '银行', definition: 'A place that keeps money.', frequency: 5 }, { pos: 'n.', meaning: '河岸', definition: 'The side of a river.', frequency: 3 }, { pos: 'v.', meaning: '倾斜转弯', definition: 'To tilt while turning.', frequency: 1 }] });
    const [money, river] = (await h.action({ action: 'lookup', word: 'bank' })).senses;
    const picture = { id: 'p', kind: 'example', text: 'The bank opens at nine.', scene: { title: 't', description: 'd', objectKey: 'images/bank' } };
    h.db.prepare("UPDATE senses SET learned=1,mastery=40,review_count=2,materials=? WHERE word='bank' AND id IN (?,?)").run(JSON.stringify([picture]), money.id, river.id);
    h.db.prepare("INSERT INTO exercises(id,user_id,sense_id,kind,stage,data,created_at,updated_at) VALUES('ex-money','tester',?,'review','blank','{}',1,1),('ex-river','tester',?,'review','blank','{}',1,1)").run(money.id, river.id);
    await h.env.BUCKET.put('images/bank', new Uint8Array([1]), {});

    await assert.rejects(h.action({ action: 'senseDelete', senseIds: [] }), e => e.code === 'INVALID_INPUT');
    await assert.rejects(h.action({ action: 'senseDelete', senseIds: [money.id, 'sense-a'] }), e => e.code === 'INVALID_INPUT');
    h.db.prepare("INSERT INTO senses(id,user_id,word,phonetic,pos,meaning,definition,learned,mastery,review_count,materials,created_at,updated_at) VALUES('theirs','someone-else','bank','','n.','银行','Bank.',1,0,0,'[]',1,1)").run();
    await assert.rejects(h.action({ action: 'senseDelete', senseIds: ['theirs'] }), e => e.code === 'NOT_FOUND');

    const partial = await h.action({ action: 'senseDelete', senseIds: [money.id] });
    assert.equal(partial.whole, false);
    const reset = h.db.prepare('SELECT learned,mastery,review_count,materials,frequency FROM senses WHERE id=?').get(money.id);
    assert.deepEqual({ ...reset }, { learned: 0, mastery: 0, review_count: 0, materials: '[]', frequency: 5 });
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM exercises WHERE id='ex-money'").get().n, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM exercises WHERE id='ex-river'").get().n, 1);
    assert.equal((await h.action({ action: 'lookup', word: 'bank' })).senses.length, 3);

    const whole = await h.action({ action: 'senseDelete', senseIds: [river.id] });
    assert.equal(whole.whole, true); assert.equal(whole.word, 'bank');
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE user_id='tester' AND word='bank'").get().n, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE id='theirs'").get().n, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM exercises").get().n, 0);
    assert.equal(h.audio.has('images/bank'), false);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM senses WHERE id='sense-a'").get().n, 1);
  } finally { h.db.close(); }
});
