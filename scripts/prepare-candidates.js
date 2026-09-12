'use strict';
const { readFileSync, mkdirSync, copyFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = resolve(__dirname, '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-candidates.js <directory-containing-candidate-tarballs>');
const lock = JSON.parse(readFileSync(join(root, 'candidate-lock.json'), 'utf8'));
if (lock.schema !== 'depa.candidate-lock/v1') throw new Error('Unsupported candidate lock');
const target = join(root, '.tmp', 'g9-candidates');
mkdirSync(target, { recursive: true });
for (const entry of lock.packages) {
  const filename = `${entry.name}-${entry.version}.tgz`, input = resolve(source, filename);
  const bytes = readFileSync(input);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (`sha256:${digest}` !== entry.sha256) throw new Error(`Candidate digest mismatch: ${filename}`);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', input, 'package/package.json'], { encoding: 'utf8' }));
  if (manifest.name !== entry.name || manifest.version !== entry.version) throw new Error(`Candidate identity mismatch: ${filename}`);
  if (JSON.stringify(manifest.dependencies ?? {}) !== JSON.stringify(entry.dependencies)) throw new Error(`Candidate dependency mismatch: ${filename}`);
  const output = join(target, filename);
  if (input !== output) copyFileSync(input, output);
}
writeFileSync(join(target, 'preparation-receipt.json'), JSON.stringify({ schema: lock.schema, verified: lock.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })) }, null, 2) + '\n');
console.log(`Verified ${lock.packages.length} candidate artifacts. Run npm ci --ignore-scripts to install the private workspace lock.`);
