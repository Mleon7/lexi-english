import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const model = process.argv[process.argv.indexOf('qwen_tts.cli.demo') + 1];
if (process.env.QWEN_FIXTURE_MODE === 'exit') process.exit(1);
if (process.env.QWEN_FIXTURE_WORKER_FILE) {
  const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
  writeFileSync(process.env.QWEN_FIXTURE_WORKER_FILE, String(worker.pid));
}
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({
    dependencies: [{ api_name: 'run_instruct' }],
    components: [{ type: 'markdown', props: { value: '**Checkpoint:** `' + model + '`' } }],
  }));
});
setTimeout(() => server.listen(port, '127.0.0.1'), Number(process.env.QWEN_FIXTURE_DELAY || 0));
