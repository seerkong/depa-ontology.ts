'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInferenceCapsule, factId, explain } = require('../index');
const v = name => ({ var: name });
const atom = (relation, ...terms) => ({ relation, terms: terms.map(v) });
const graphProgram = {
  id: 'dependency-analysis', version: '1',
  relations: [{ name: 'depends', arity: 2 }, { name: 'seed', arity: 2 }, { name: 'invalid', arity: 2 }],
  rules: [
    { id: 'root', head: atom('invalid', 'item', 'cause'), body: [atom('seed', 'item', 'cause')] },
    { id: 'propagate', head: atom('invalid', 'child', 'cause'), body: [atom('depends', 'child', 'parent'), atom('invalid', 'parent', 'cause')] },
  ],
};
const graphInput = {
  epoch: 'e1', program: graphProgram,
  facts: [
    { relation: 'seed', values: ['root', 'deleted'], source: 'commit:42' },
    { relation: 'seed', values: ['other', 'changed'], source: 'commit:43' },
    ...[['left', 'root'], ['right', 'root'], ['join', 'left'], ['join', 'right'], ['join', 'other'], ['cycle', 'join'], ['join', 'cycle'], ['unrelated', 'safe']].map(values => ({ relation: 'depends', values })),
  ],
};

test('real recursive fixed point preserves independent causes, AND groups, alternative proofs and finite cyclic explanation', async () => {
  const result = await createInferenceCapsule().infer(graphInput);
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics));
  const invalid = result.facts.filter(f => f.relation === 'invalid').map(f => f.values).sort();
  assert.deepEqual(invalid, [['cycle','changed'],['cycle','deleted'],['join','changed'],['join','deleted'],['left','deleted'],['other','changed'],['right','deleted'],['root','deleted']]);
  const joined = factId('invalid', ['join', 'deleted']);
  const proofs = result.supports.filter(s => s.conclusion === joined);
  assert.equal(proofs.length, 3);
  assert.ok(proofs.every(s => s.premises.length === 2));
  const explanation = explain(result, joined);
  assert.equal(explanation.complete, true);
  assert.ok(explanation.facts.some(f => f.sources.includes('commit:42')));
  assert.ok(!explanation.facts.some(f => f.sources.includes('commit:43')));
  assert.ok(explanation.facts.length <= result.facts.length);
  assert.ok(!result.facts.some(f => f.relation === 'invalid' && f.values[0] === 'unrelated'));
});

test('epochs recompute, provenance fingerprints normalize order and bind program version and all sources', async () => {
  const engine = createInferenceCapsule();
  const first = await engine.infer(graphInput);
  const reordered = await engine.infer({ ...graphInput, program: { ...graphProgram, relations: [...graphProgram.relations].reverse(), rules: [...graphProgram.rules].reverse() }, facts: [...graphInput.facts].reverse() });
  assert.equal(first.programFingerprint, reordered.programFingerprint);
  assert.equal(first.inputFingerprint, reordered.inputFingerprint);
  assert.deepEqual(first.supports, reordered.supports);
  const empty = await engine.infer({ ...graphInput, epoch: 'e2', facts: graphInput.facts.filter(f => f.relation !== 'seed') });
  assert.equal(empty.status, 'complete');
  assert.equal(empty.supports.length, 0);
  assert.ok(empty.facts.every(f => f.relation !== 'invalid'));
  assert.notEqual(empty.inputFingerprint, first.inputFingerprint);
  const version = await engine.infer({ ...graphInput, program: { ...graphProgram, version: '2' } });
  assert.notEqual(version.programFingerprint, first.programFingerprint);
  const sources = await engine.infer({ ...graphInput, facts: [...graphInput.facts, { ...graphInput.facts[0], source: 'another-source' }] });
  assert.notEqual(sources.inputFingerprint, first.inputFingerprint);
  assert.deepEqual(sources.facts.find(f => f.id === factId('seed', ['root', 'deleted'])).sources, ['another-source', 'commit:42']);
  const oneCause = await engine.infer({ ...graphInput, epoch: 'e3', facts: graphInput.facts.filter(f => f.source !== 'commit:42') });
  assert.ok(oneCause.facts.some(f => f.id === factId('invalid', ['join', 'changed'])));
  assert.ok(!oneCause.facts.some(f => f.id === factId('invalid', ['join', 'deleted'])));
});

test('frozen input-only negation carries absence evidence and changes in a new epoch', async () => {
  const input = { epoch: 'n1', program: { id: 'absence', version: '1', relations: [{ name: 'person', arity: 1 }, { name: 'denied', arity: 1 }, { name: 'eligible', arity: 1 }], rules: [{ id: 'allow', head: atom('eligible', 'x'), body: [atom('person', 'x'), { ...atom('denied', 'x'), not: true }] }] }, facts: [{ relation: 'person', values: ['a'] }] };
  const engine = createInferenceCapsule();
  const before = await engine.infer(input);
  assert.equal(before.status, 'complete', JSON.stringify(before.diagnostics));
  assert.deepEqual(before.supports[0].absences, [{ relation: 'denied', values: ['a'] }]);
  assert.ok(before.inputFingerprint);
  const after = await engine.infer({ ...input, epoch: 'n2', facts: [...input.facts, { relation: 'denied', values: ['a'] }] });
  assert.equal(after.status, 'complete');
  assert.equal(after.supports.length, 0);
});

test('typed constants and hostile strings are parameters, tuple identities cannot collide', async () => {
  const values = [null, false, true, 0, 2.5, '0', 'x\", :create attack {id}\n', 'a|b'];
  const input = { epoch: 's', program: { id: 'scalar', version: '1', relations: [{ name: 'input', arity: 1 }, { name: 'output', arity: 2 }], rules: [{ id: 'copy', head: { relation: 'output', terms: [v('x'), { value: 'constant' }] }, body: [atom('input', 'x')] }] }, facts: values.map(value => ({ relation: 'input', values: [value] })) };
  const result = await createInferenceCapsule().infer(input);
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics));
  for (const value of values) assert.ok(result.facts.some(f => f.id === factId('output', [value, 'constant'])));
  assert.notEqual(factId('r', ['a|b','c']), factId('r', ['a','b|c']));
  assert.notEqual(factId('r', [0]), factId('r', ['0']));
});

test('invalid input is rejected before native effects', async () => {
  let calls = 0;
  const engine = createInferenceCapsule({ runtime: { now: () => 0, evaluate: () => { calls++; throw new Error('must not evaluate'); } } });
  const invalid = [
    { ...graphInput, facts: [{ relation: 'seed', values: ['x', NaN] }] },
    { ...graphInput, facts: [{ relation: 'seed', values: ['x', -0] }] },
    { ...graphInput, program: { ...graphProgram, rules: [{ id: 'unsafe', head: atom('invalid', 'x', 'new'), body: [atom('seed', 'x', 'cause')] }] } },
    { ...graphInput, program: { ...graphProgram, rules: [...graphProgram.rules, { id: 'negative-cycle', head: atom('invalid', 'x', 'y'), body: [atom('seed', 'x', 'y'), { ...atom('invalid', 'x', 'y'), not: true }] }] } },
    { ...graphInput, program: { ...graphProgram, relations: [{ name: 'x] :create injected {a}', arity: 1 }] } },
    { ...graphInput, extra: 'unknown closed field' },
  ];
  for (const input of invalid) assert.equal((await engine.infer(input)).status, 'invalid');
  assert.equal(calls, 0);
});

test('missing conjunct cannot derive and concurrent sessions do not share facts', async () => {
  const engine = createInferenceCapsule();
  const [a,b] = await Promise.all([
    engine.infer({ ...graphInput, epoch: 'only-edge', facts: [{ relation: 'depends', values: ['child','root'] }] }),
    engine.infer({ ...graphInput, epoch: 'only-seed', facts: [{ relation: 'seed', values: ['root','cause'] }] }),
  ]);
  assert.equal(a.supports.length, 0);
  assert.equal(b.supports.length, 1);
  assert.ok(!b.facts.some(f => f.id === factId('invalid', ['child','cause'])));
});

test('malformed backend rows fail closed', async () => {
  for (const rows of [[[1]], [['fact','','unknown',['"x"'],[],[]]], [['support','unknown','invalid',['"a"','"b"'],[],[]]], [['fact','','seed',['NaN','"b"'],[],[]]]]) {
    const engine = createInferenceCapsule({ runtime: { now: () => 0, evaluate: async () => ({ rows }) } });
    const result = await engine.infer(graphInput);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.diagnostics[0].code, 'BACKEND_ERROR');
  }
});

test('limits, timeout and backend failures never report complete', async () => {
  const limited = await createInferenceCapsule({ budget: { maxFacts: 3, maxSupports: 2 } }).infer(graphInput);
  assert.equal(limited.status, 'incomplete');
  assert.equal(limited.diagnostics[0].code, 'OUTPUT_BUDGET');
  assert.ok(limited.facts.length <= 3 && limited.supports.length <= 2);
  assert.equal(explain(limited, limited.facts[0]?.id).complete, false);
  const failed = await createInferenceCapsule({ runtime: { now: () => 0, evaluate: async () => { throw new Error('backend unavailable'); } } }).infer(graphInput);
  assert.equal(failed.status, 'incomplete');
  assert.equal(failed.diagnostics[0].code, 'BACKEND_ERROR');
  const huge = { ...graphInput, facts: [{ relation: 'seed', values: ['0','cause'] }, ...Array.from({ length: 2000 }, (_, i) => ({ relation: 'depends', values: [String(i + 1),String(i)] }))] };
  const timeout = await createInferenceCapsule({ budget: { timeoutMs: 1 } }).infer(huge);
  assert.equal(timeout.status, 'incomplete');
  assert.equal(timeout.diagnostics[0].code, 'TIMEOUT', JSON.stringify(timeout.diagnostics));
});

test('real engine matches independently computed graph reachability on deterministic small graphs', async () => {
  for (let sample = 0; sample < 5; sample++) {
    const edges = [];
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) if ((a * 17 + b * 13 + sample * 7) % 11 < 3) edges.push([String(a),String(b)]);
    const reachable = new Set(['0']); let changed = true;
    while (changed) { changed = false; for (const [child,parent] of edges) if (reachable.has(parent) && !reachable.has(child)) { reachable.add(child); changed = true; } }
    const result = await createInferenceCapsule().infer({ epoch: `sample-${sample}`, program: graphProgram, facts: [{ relation: 'seed', values: ['0','root'] }, ...edges.map(values => ({ relation: 'depends', values }))] });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.facts.filter(f => f.relation === 'invalid').map(f => f.values[0]).sort(), [...reachable].sort());
  }
});
