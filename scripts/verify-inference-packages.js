'use strict';
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const root = resolve(__dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'depa-inference-packages-'));
const packages = ['depa-datalog', 'depa-inference-contract', 'depa-inference-logic', 'depa-inference-cozo-support', 'depa-inference-capsule'];
function run(command, args, cwd = root) { return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
try {
  const tarballs = [];
  for (const name of packages) {
    const receipt = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--pack-destination', scratch, '--json']));
    if (receipt[0].files.some(file => file.path.includes('node_modules') || file.path.includes('/test/'))) throw new Error('Unexpected development content in package');
    tarballs.push(join(scratch, receipt[0].filename));
  }
  // Resolve the installed native artifact; package validation never depends on a sibling checkout.
  const nativeRoot = resolve(require.resolve('depa-cozo'), '..');
  const nativeExpected = require('../packages/depa-inference-cozo-support/package.json').dependencies['depa-cozo'];
  const nativeActual = JSON.parse(readFileSync(join(nativeRoot, 'package.json'), 'utf8')).version;
  if (nativeExpected !== nativeActual) throw new Error(`Native candidate mismatch: expected ${nativeExpected}, installed ${nativeActual}; prepare candidates and run npm ci first`);
  const nativeReceipt = JSON.parse(run('npm', ['pack', nativeRoot, '--pack-destination', scratch, '--json']));
  tarballs.push(join(scratch, nativeReceipt[0].filename));
  const consumer = join(scratch, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'inference-isolated-consumer', version: '1.0.0', private: true }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], consumer);
  const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
  for (const tarball of tarballs) {
    const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
    const entry = lock.packages[`node_modules/${manifest.name}`];
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (entry.version !== manifest.version || entry.integrity !== integrity || !entry.resolved.startsWith('file:')) throw new Error(`Unproven candidate lock: ${manifest.name}`);
    for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
      if (lock.packages[`node_modules/${dependency}`]?.version !== version) throw new Error(`Public semver closure mismatch: ${manifest.name} -> ${dependency}`);
    }
  }
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  writeFileSync(join(consumer, 'smoke.js'), `
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
for (const name of ${JSON.stringify([...packages, 'depa-cozo'])}) {
  const entry = fs.realpathSync(require.resolve(name));
  assert.ok(entry.startsWith(path.join(process.cwd(), 'node_modules') + path.sep), entry);
  assert.ok(!entry.includes('/src/') && !entry.includes('/packages/'), entry);
}
const {createInferenceCapsule, factId, explain} = require('depa-inference-capsule');
(async () => {
  const result = await createInferenceCapsule().infer({epoch:'packed',program:{id:'copy',version:'1',relations:[{name:'a',arity:1},{name:'b',arity:1}],rules:[{id:'r',head:{relation:'b',terms:[{var:'x'}]},body:[{relation:'a',terms:[{var:'x'}]}]}]},facts:[{relation:'a',values:['v'],source:'fixture:1'}]});
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics));
  const proof = explain(result,factId('b',['v']));
  assert.equal(proof.supports.length,1);
  assert.ok(proof.facts.some(f=>f.sources.includes('fixture:1')));
  assert.equal(proof.inputFingerprint,result.inputFingerprint);
  console.log(JSON.stringify({runtime:process.versions.bun?'bun':'node',status:result.status,facts:result.facts.length,supports:result.supports.length}));
})().catch(error=>{console.error(error);process.exitCode=1});
`);
  writeFileSync(join(consumer, 'types.ts'), `
import {createInferenceCapsule, RuleProgram, InferenceInput, InferenceResult, explain} from 'depa-inference-capsule';
import {query, variable} from 'depa-datalog';
const program: RuleProgram = {id:'p',version:'1',relations:[{name:'a',arity:1}],rules:[]};
const input: InferenceInput = {epoch:'e',program,facts:[]};
const result: Promise<InferenceResult> = createInferenceCapsule().infer(input);
result.then(value => explain(value,'fact'));
query().rows('r',['x'],[[1]]).rule('copy').select(['x']).fromRule('r',[variable('x')]).bind('k',1).build();
`);
  run(join(root, 'node_modules', '.bin', 'tsc'), ['--noEmit', '--strict', '--skipLibCheck', '--moduleResolution', 'node', '--target', 'es2020', 'types.ts'], consumer);
  console.log(run('node', ['smoke.js'], consumer).trim());
  console.log(run('bun', ['smoke.js'], consumer).trim());
  console.log(`Validated ${packages.length} public package tarballs, native artifact and declaration consumer.`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
