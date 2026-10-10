import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

async function harness() {
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
  const calls = []; let next = {};
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, atob });
  const envModule = new vm.SyntheticModule(['env'], function () { this.setExport('env', { DB: adapter }); }, { context });
  const providers = new vm.SyntheticModule(['generate', 'speech', 'generateImage', 'VOICES'], function () {
    this.setExport('generate', async (_settings, instruction, data) => { calls.push({ instruction, data }); return next; });
    this.setExport('speech', async () => { throw new Error('Unexpected speech generation'); });
    this.setExport('generateImage', async () => { throw new Error('Unexpected image generation'); });
    this.setExport('VOICES', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }]);
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
  return { db, calls, set(value) { next = value; }, action: body => service.namespace.action('tester', body) };
}

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
    await assert.rejects(h.action({ action: 'reviewSentence', reviewId: review.reviewId, answer: 'I was meticulous when I label every sample in the laboratory.' }), e => e.code === 'STAGE_MISMATCH');
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
