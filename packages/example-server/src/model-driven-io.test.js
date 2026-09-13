process.env.WORKSHOP_PERSIST = process.env.WORKSHOP_PERSIST || '0';
const { test, expect } = require('bun:test');

const { CozoDb } = require('depa-cozo');
const { om } = require('depa-ontology');
const { allDemos } = require('./demos');
const workshop = require('./workshop');
const { registerModelDrivenMutations } = require('./model-driven-mutations');

const DEMO_IDS = ['crm', 'hr', 'procurement'];

function demoById(id) {
  const demo = allDemos.find((d) => d.demoId === id);
  if (!demo) throw new Error(`demo not found: ${id}`);
  return demo;
}

async function seededDb(demoId) {
  const demo = demoById(demoId);
  const db = new CozoDb('mem', '');
  const runtime = om.createOmRuntime(db);
  await demo.defineOntology(db);
  await om.ingestBatch(runtime, {
    entities: demo.defaultSheets.entities.rows,
    properties: demo.defaultSheets.properties.rows,
    edges: demo.defaultSheets.edges.rows,
  });
  // Mirror the real seed path: composite operations need these mutations registered.
  await registerModelDrivenMutations(runtime);
  return { db, runtime, demo };
}

async function ontologySnapshot(db) {
  const rows = await db.run(`
?[kind, a, b, c] := *om_type{name: a, description: c}, kind = "type", b = ""
?[kind, a, b, c] := *om_attr_def{type_name: a, attr_name: b, value_type: c}, kind = "attr"
?[kind, a, b, c] := *om_rel_def{rel_name: a, from_type: b, to_type: c}, kind = "rel"
`);
  return rows.rows.map((r) => r.join('|')).sort();
}

test('relation metadata is declared and readable per demo', async () => {
  for (const demoId of DEMO_IDS) {
    const { db } = await seededDb(demoId);
    const rels = await om.listRelationsWithMeta(db);
    expect(rels.length).toBeGreaterThan(0);
    // Every relation declares metadata — no silent "unconstrained" leftovers.
    const withoutMeta = rels.filter((r) => !r.meta).map((r) => r.name);
    expect(withoutMeta).toEqual([]);
    for (const rel of rels) {
      expect(['many_to_one', 'one_to_many', 'many_to_many', 'one_to_one']).toContain(rel.meta.cardinality);
      expect(['ownership', 'composition', 'association', 'hierarchy']).toContain(rel.meta.role);
      expect(typeof rel.meta.optional).toBe('boolean');
    }
    db.close?.();
  }
});

test('owner relations are derived from declared role, not hand-written', async () => {
  for (const demoId of DEMO_IDS) {
    const { db } = await seededDb(demoId);
    const derived = await om.listOwnerRelations(db);
    const rels = await om.listRelationsWithMeta(db);
    const expected = rels
      .filter((r) => r.meta && (r.meta.role === 'ownership' || r.meta.role === 'composition'))
      .map((r) => r.name)
      .sort();
    expect(derived).toEqual(expected);
    // Association-role relations must never leak into the ownership set.
    for (const r of rels) {
      if (r.meta && r.meta.role === 'association') {
        expect(derived).not.toContain(r.name);
      }
    }
    db.close?.();
  }
});

test('demo template strings and run() share one derived relation set', async () => {
  for (const demoId of DEMO_IDS) {
    const { demo } = await seededDb(demoId);
    // A hardcoded relation-name literal in either the human-facing template or the
    // machine path is the drift signal this mission removes: both sides must read
    // the set from the model.
    for (const q of demo.queries || []) {
      if (q.queryId !== 'ownershipTree' && q.queryId !== 'impactAnalysis') continue;
      for (const source of [String(q.dsl), String(q.run)]) {
        // Must read the set from the model (either helper), not from a literal.
        expect(source).toMatch(/om\.list(OwnerRelations|RelationsByRole)\(/);
        // Guard the other direction too: no bare relation-name array literal left.
        expect(source).not.toMatch(/relNames:\s*\[[^\]]*'[a-z_]+'/);
        expect(source).not.toMatch(/ownerRelNames:\s*\[[^\]]*'[a-z_]+'/);
      }
    }
  }
});

test('ownership and impact traversal run off the derived set', async () => {
  for (const demoId of DEMO_IDS) {
    const { db, runtime, demo } = await seededDb(demoId);
    const derived = await om.listOwnerRelations(db);
    expect(derived.length).toBeGreaterThan(0);

    const tree = demo.queries.find((q) => q.queryId === 'ownershipTree');
    const out = await tree.run(runtime);
    expect(out.view).toBe('tree');
    // Every relation the traversal actually walked must be one the model declares
    // as ownership — a hand-written set could include relations the model never marked.
    const walked = new Set();
    for (const children of Object.values(out.data.tree.childrenById || {})) {
      for (const child of children) walked.add(child.relName);
    }
    expect(walked.size).toBeGreaterThan(0);
    for (const relName of walked) {
      expect(derived).toContain(relName);
    }

    const impact = demo.queries.find((q) => q.queryId === 'impactAnalysis');
    const impactOut = await impact.run(runtime);
    expect(impactOut.view).toBe('graph');
    expect(impactOut.meta.impactedCount).toBeGreaterThan(0);
    db.close?.();
  }
});

test('demo modeling has a single source: tables and defineOntology agree', async () => {
  for (const demoId of DEMO_IDS) {
    const demo = demoById(demoId);
    const fromFn = new CozoDb('mem', '');
    await demo.defineOntology(fromFn);
    const snapshotFn = await ontologySnapshot(fromFn);
    fromFn.close?.();

    const fromTables = new CozoDb('mem', '');
    await workshop.defineOntologyFromTables(
      fromTables,
      workshop.tableMapFromTables(demo.defaultTables)
    );
    const snapshotTables = await ontologySnapshot(fromTables);
    fromTables.close?.();

    expect(snapshotTables).toEqual(snapshotFn);
  }
});

test('adding relation metadata does not break the legacy defineRelation path', async () => {
  const db = new CozoDb('mem', '');
  await om.initSchema(db);
  await om.defineType(db, 'L', 'l');
  await om.defineType(db, 'R', 'r');
  // Legacy 5-arg call: no metadata argument.
  await om.defineRelation(db, 'legacy_rel', 'L', 'R', true, '旧调用');
  expect(await om.getRelationMeta(db, 'legacy_rel')).toBeNull();
  expect(await om.listOwnerRelations(db)).toEqual([]);

  // Invalid metadata is rejected rather than silently stored.
  await expect(
    om.defineRelation(db, 'bad_rel', 'L', 'R', true, 'bad', { cardinality: 'nope' })
  ).rejects.toThrow();
  await expect(
    om.defineRelation(db, 'bad_rel2', 'L', 'R', true, 'bad', { role: 'nope' })
  ).rejects.toThrow();
  db.close?.();
});

test('HTTP tree route derives its default relation set from the model', async () => {
  const { createApp } = require('./index');
  const { app, close } = createApp();
  try {
    const roots = { crm: 'acct:acme', hr: 'emp:alice', procurement: 's:acme' };
    for (const [demoId, rootId] of Object.entries(roots)) {
      const res = await app.handle(
        new Request(
          `http://localhost/api/demos/${demoId}/graph/tree/${encodeURIComponent(rootId)}?maxDepth=3`
        )
      );
      const data = await res.json();
      expect(data.status).toBe('ok');
      // Before the model-derived default this returned a single root node, because the
      // fallback names ('owns'/'contains') do not exist in any demo.
      expect(data.stats.nodeCount).toBeGreaterThan(1);
      expect(data.stats.edgeCount).toBeGreaterThan(0);
    }
  } finally {
    close();
  }
});

test('owner swap is derived from declared cardinality, not hand-written per relation', async () => {
  const { db } = await seededDb('crm');
  // Functional relations: a swap plan exists and is a pure description (no writes yet).
  const plan = await om.deriveRelationSwap(db, {
    fromId: 'lead:web-ship',
    relName: 'assigned_to',
    toId: 'rep:wang',
  });
  expect(plan.cardinality).toBe('many_to_one');
  expect(plan.unlink).toEqual(['rep:li']);
  expect(plan.link).toBe('rep:wang');
  const before = await om.getNeighbors(db, 'lead:web-ship', 'assigned_to', 'outgoing');
  expect(before.outgoing.map((o) => o.entityId)).toEqual(['rep:li']);

  // Re-pointing at the already-linked target is recognised as a no-op.
  const noop = await om.deriveRelationSwap(db, {
    fromId: 'lead:web-ship',
    relName: 'assigned_to',
    toId: 'rep:li',
  });
  expect(noop.isNoop).toBe(true);

  // many_to_many has no owner to replace — derivation refuses rather than guessing.
  await expect(
    om.deriveRelationSwap(db, { fromId: 'emp:alice', relName: 'nope', toId: 'x' })
  ).rejects.toThrow();
  db.close?.();
});

test('many_to_many relations refuse owner-swap derivation', async () => {
  const { db } = await seededDb('hr');
  await expect(
    om.deriveRelationSwap(db, { fromId: 'emp:alice', relName: 'has_skill', toId: 'sk:js' })
  ).rejects.toThrow(/many_to_many/);
  // A relation with no declared cardinality cannot be derived either.
  const bare = new CozoDb('mem', '');
  await om.initSchema(bare);
  await om.defineType(bare, 'A', 'a');
  await om.defineType(bare, 'B', 'b');
  await om.defineRelation(bare, 'bare_rel', 'A', 'B', true, 'no meta');
  await om.createEntity(bare, 'a:1', 'A', 'a1');
  await om.createEntity(bare, 'b:1', 'B', 'b1');
  await expect(
    om.deriveRelationSwap(bare, { fromId: 'a:1', relName: 'bare_rel', toId: 'b:1' })
  ).rejects.toThrow(/cardinality/);
  bare.close?.();
  db.close?.();
});

test('composite relation rewrites are atomic: a mid-way failure leaves nothing behind', async () => {
  // The claim "one Operation = one atomic association rewrite" is only proven by a
  // failure, not by a happy path. This injects a failing mutation between the writes.
  const { db, runtime } = await seededDb('crm');
  await om.defineMutation(runtime, 'Lead', 'boom', 'injected failure for the atomicity probe');
  om.registerMutation(runtime, 'Lead', 'boom', async () => {
    throw new Error('intentional mid-way failure');
  });

  const oppId = 'opp:atomicity-probe';
  await om.createEntity(runtime, 'lead:atomicity', 'Lead', '原子性探针线索');

  const before = await om.getEntityView(runtime, 'lead:atomicity');
  expect(before.outgoing).toEqual([]);

  await expect(
    om.executeMutations(runtime, 'lead:atomicity', [
      { mutation: 'createAndLinkOpportunity', params: {
        leadId: 'lead:atomicity',
        opportunityId: oppId,
        opportunityLabel: '不该存在的商机',
        accountId: 'acct:acme',
        amount: 1,
        stage: 'qualify',
      } },
      { mutation: 'boom', params: {} },
    ])
  ).rejects.toThrow(/intentional mid-way failure/);

  // Every write from the first mutation must be gone: entity, properties, and edges.
  expect(await om.getEntityView(runtime, oppId)).toBeNull();
  const after = await om.getEntityView(runtime, 'lead:atomicity');
  expect(after.outgoing).toEqual([]);
  expect(after.properties.status).not.toBe('converted');
  const acct = await om.getEntityView(runtime, 'acct:acme');
  expect(acct.outgoing.filter((e) => e.toId === oppId)).toEqual([]);
  db.close?.();
});

// ─── IR v0.3 fields: each must have a runtime consumer, not just a contract entry ───

test('v0.3 list surface exposes subjectKind / behaviorKind / outcomeKind', async () => {
  const { createApp } = require('./index');
  const { app, close } = createApp();
  try {
    for (const demoId of DEMO_IDS) {
      const res = await app.handle(new Request(`http://localhost/api/demos/${demoId}/operations`));
      const ops = (await res.json()).operations;
      expect(ops.length).toBeGreaterThan(0);
      for (const op of ops) {
        expect(['none', 'single', 'selection']).toContain(op.subjectKind);
        expect([
          'action', 'mutation', 'transition', 'validate', 'computed', 'query', 'composed', 'raw',
        ]).toContain(op.behaviorKind);
        expect([
          'scalar', 'entity', 'collection', 'table', 'graph', 'tree', 'composite',
        ]).toContain(op.outcomeKind);
        // subjectKind must agree with entry — the two cannot contradict.
        if (op.entry === 'effect') expect(op.subjectKind).toBe('none');
        else expect(['single', 'selection']).toContain(op.subjectKind);
      }
    }
  } finally {
    close();
  }
});

test('v0.3 list and detail agree on the derived fields', async () => {
  const { createApp } = require('./index');
  const { app, close } = createApp();
  try {
    const listRes = await app.handle(new Request('http://localhost/api/demos/crm/operations'));
    const ops = (await listRes.json()).operations;
    for (const listed of ops) {
      const detailRes = await app.handle(
        new Request(`http://localhost/api/demos/crm/operations/${encodeURIComponent(listed.fqn)}`)
      );
      const detail = (await detailRes.json()).operation;
      // List previously hand-built a narrower field set than detail.
      expect(detail.subjectKind).toBe(listed.subjectKind);
      expect(detail.behaviorKind).toBe(listed.behaviorKind);
      expect(detail.outcomeKind).toBe(listed.outcomeKind);
    }
  } finally {
    close();
  }
});

test('query operations are first-class and report graph / tree outcomes', async () => {
  const { createApp } = require('./index');
  const { app, close } = createApp();
  try {
    const roots = { crm: 'acct:acme', hr: 'emp:alice', procurement: 'po:1001' };
    for (const [demoId, rootId] of Object.entries(roots)) {
      const listRes = await app.handle(new Request(`http://localhost/api/demos/${demoId}/operations`));
      const ops = (await listRes.json()).operations;
      const queryOps = ops.filter((o) => o.behaviorKind === 'query');
      // Read operations now have a declared home rather than masquerading as effects.
      expect(queryOps.length).toBeGreaterThan(0);
      for (const q of queryOps) expect(q.sideEffectLevel).toBe('read');

      const impact = ops.find((o) => o.fqn.endsWith('ImpactAnalysis'));
      const impactRes = await app.handle(
        new Request(`http://localhost/api/demos/${demoId}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fqn: impact.fqn,
            entry: 'effect',
            input: { rootId, maxDepth: 2 },
          }),
        })
      );
      const impactOut = await impactRes.json();
      expect(impactOut.status).toBe('ok');
      expect(impactOut.outcomeKind).toBe('graph');
      expect(impactOut.result.nodes.length).toBeGreaterThan(0);

      const tree = ops.find((o) => o.fqn.endsWith('OwnershipTree'));
      const treeRes = await app.handle(
        new Request(`http://localhost/api/demos/${demoId}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fqn: tree.fqn, entry: 'effect', input: { rootId, maxDepth: 2 } }),
        })
      );
      const treeOut = await treeRes.json();
      expect(treeOut.status).toBe('ok');
      expect(treeOut.outcomeKind).toBe('tree');
    }
  } finally {
    close();
  }
});

test('rejections carry structured issues pointing at the offending field', async () => {
  const { createApp } = require('./index');
  const { app, close } = createApp();
  try {
    // effect entry given addressed fields
    const bad = await app.handle(
      new Request('http://localhost/api/demos/crm/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fqn: 'ontology.crm.op.CreateLead',
          entry: 'effect',
          selector: { kind: 'one', id: 'lead:x' },
          input: { label: 'a', source: 'b' },
        }),
      })
    );
    const badOut = await bad.json();
    expect(badOut.status).toBe('rejected');
    expect(badOut.rejected.code).toBe('ENTRY_MISMATCH');
    expect(Array.isArray(badOut.rejected.issues)).toBe(true);
    expect(badOut.rejected.issues[0].path).toBe('selector');
    expect(badOut.rejected.issues[0].code).toBe('ENTRY_MISMATCH');

    // unknown fqn
    const unknown = await app.handle(
      new Request('http://localhost/api/demos/crm/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fqn: 'ontology.crm.op.Nope', entry: 'effect', input: {} }),
      })
    );
    const unknownOut = await unknown.json();
    expect(unknownOut.rejected.issues[0].path).toBe('fqn');

    // messages stay readable even with issues present
    expect(typeof badOut.rejected.message).toBe('string');
    expect(badOut.rejected.message.length).toBeGreaterThan(0);
  } finally {
    close();
  }
});

test('a declared subjectKind is enforced, and undeclared ones are not', async () => {
  const { createApp } = require('./index');
  const { app, close } = createApp();
  try {
    // ConvertLead declares subjectKind: 'single' — an ids selector must not be
    // accepted silently for an operation that creates a 1:1 opportunity.
    const wrong = await app.handle(
      new Request('http://localhost/api/demos/crm/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fqn: 'ontology.crm.op.ConvertLead',
          entry: 'addressed',
          selector: { kind: 'ids', objectType: 'Lead', ids: ['lead:web-ship'] },
          invocation: {
            type: 'Lead.convert',
            kind: 'action',
            payload: { accountId: 'acct:acme' },
          },
        }),
      })
    );
    const out = await wrong.json();
    expect(out.status).toBe('rejected');
    expect(out.rejected.issues[0].path).toBe('selector.kind');
    expect(out.rejected.issues[0].expected).toBe('one');

    // Handlers that legitimately loop over a selection must keep working — the
    // unenforced case is deliberate, not an oversight.
    const ok = await app.handle(
      new Request('http://localhost/api/demos/crm/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fqn: 'ontology.crm.op.SetLeadStatus',
          entry: 'addressed',
          selector: { kind: 'ids', objectType: 'Lead', ids: ['lead:web-ship'] },
          invocation: { type: 'Lead.setStatus', kind: 'action', payload: { status: 'qualified' } },
        }),
      })
    );
    const okOut = await ok.json();
    expect(okOut.status).toBe('ok');
  } finally {
    close();
  }
});
