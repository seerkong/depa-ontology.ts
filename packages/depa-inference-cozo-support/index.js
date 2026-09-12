'use strict';
const { fork } = require('node:child_process');
const { join } = require('node:path');

/** Kill and reap the native process at the deadline; no background query survives rejection. */
function evaluate(query) {
  return new Promise((resolve, reject) => {
    const timeoutMs = query.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return reject(new Error('Invalid native process timeout'));
    const child = fork(join(__dirname, 'worker.js'), [], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let response, failure, stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', chunk => { if (stderr.length < 8000) stderr += chunk.toString().slice(0, 8000 - stderr.length); });
    child.on('message', message => { response = message; });
    child.on('error', error => { failure = error; });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Inference native process timeout; worker terminated'));
      else if (failure) reject(failure);
      else if (code !== 0 || !response) reject(new Error(`Native worker exited ${code ?? signal}: ${stderr}`));
      else if (response.error) reject(Object.assign(new Error(response.error.message), response.error));
      else resolve(response.result);
    });
    child.send({ script: query.script, params: query.params }, error => { if (error) { failure = error; child.kill('SIGKILL'); } });
  });
}
module.exports = { evaluate };
