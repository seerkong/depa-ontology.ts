const { describe, expect, test } = require('bun:test');

const { CozoDb } = require('../index');
const om = require('../cozo-om');

async function createRuntimeDb() {
  const db = new CozoDb('mem', '', {});
  await om.initSchema(db);
  return { db, runtime: om.createOmRuntime(db) };
}

describe('OM runtime registry lifecycle', () => {
  test('same behavior key is isolated per runtime and clear targets one runtime', async () => {
    const db = new CozoDb('mem', '', {});
    await om.initSchema(db);
    const left = om.createOmRuntime(db);
    const right = om.createOmRuntime(db);
    const calls = [];

    try {
      expect(Object.keys(left)).toEqual(['runner']);
      expect(left.run).toBeUndefined();
      await om.defineType(left, 'Resource', 'Resource');
      await om.createEntity(left, 'resource:1', 'Resource', 'Resource');

      // Definition is persisted once; each runtime attaches its own callback.
      await om.defineAction(left, 'Resource', 'inspect');
      om.registerAction(left, 'Resource', 'inspect', async () => {
        calls.push('left');
        return [];
      });
      om.registerAction(right, 'Resource', 'inspect', async () => {
        calls.push('right');
        return [];
      });

      await om.executeAction(left, 'resource:1', 'inspect', {});
      await om.executeAction(right, 'resource:1', 'inspect', {});
      expect(calls).toEqual(['left', 'right']);

      om.clearRegistry(left);

      // Clearing one runtime leaves the other intact — no shared registry to wipe.
      await expect(
        om.executeAction(left, 'resource:1', 'inspect', {})
      ).rejects.toThrow("Action 'inspect' not defined");
      await om.executeAction(right, 'resource:1', 'inspect', {});
      expect(calls).toEqual(['left', 'right', 'right']);
    } finally {
      db.close();
    }
  });

  test('a bare runner cannot register behaviors at all', async () => {
    const db = new CozoDb('mem', '', {});
    await om.initSchema(db);
    await om.defineType(db, 'Resource', 'Resource');
    await om.createEntity(db, 'resource:1', 'Resource', 'Resource');

    try {
      // Previously a bare runner silently fell back to a module-level registry, which
      // let two databases share (and overwrite) each other's callbacks. Registration now
      // requires an explicit runtime, and the old no-arg clear is gone.
      expect(() => om.registerAction(db, 'Resource', 'inspect', async () => [])).toThrow(
        /createOmRuntime/
      );
      expect(() => om.clearRegistry()).toThrow(/createOmRuntime/);
      await expect(om.defineAction(db, 'Resource', 'inspect', 'd')).rejects.toThrow(
        /createOmRuntime/
      );
    } finally {
      db.close();
    }
  });

  test('two databases never share a behavior callback', async () => {
    const leftDb = new CozoDb('mem', '', {});
    const rightDb = new CozoDb('mem', '', {});
    const calls = [];

    await om.initSchema(leftDb);
    await om.initSchema(rightDb);

    try {
      const leftRuntime = om.createOmRuntime(leftDb);
      const rightRuntime = om.createOmRuntime(rightDb);

      await om.defineType(leftRuntime, 'Resource', 'Resource');
      await om.defineType(rightRuntime, 'Resource', 'Resource');
      await om.createEntity(leftRuntime, 'left:1', 'Resource', 'Left resource');
      await om.createEntity(rightRuntime, 'right:1', 'Resource', 'Right resource');

      await om.defineAction(leftRuntime, 'Resource', 'inspect');
      om.registerAction(leftRuntime, 'Resource', 'inspect', async () => {
        calls.push('left');
        return [];
      });
      om.registerAction(rightRuntime, 'Resource', 'inspect', async () => {
        calls.push('right');
        return [];
      });

      // Each database runs its own callback — the isolation this contract guarantees.
      await om.executeAction(leftRuntime, 'left:1', 'inspect', {});
      await om.executeAction(rightRuntime, 'right:1', 'inspect', {});
      expect(calls).toEqual(['left', 'right']);

      // Clearing the left registry must not disturb the right one.
      om.clearRegistry(leftRuntime);
      await expect(
        om.executeAction(leftRuntime, 'left:1', 'inspect', {})
      ).rejects.toThrow("Action 'inspect' not defined");
      await om.executeAction(rightRuntime, 'right:1', 'inspect', {});
      expect(calls).toEqual(['left', 'right', 'right']);
    } finally {
      leftDb.close();
      rightDb.close();
    }
  });

  test('transaction and indirect behavior paths retain the explicit runtime scope', async () => {
    const { db, runtime } = await createRuntimeDb();
    const phases = [];

    try {
      await om.defineType(runtime, 'Resource', 'Resource');
      await om.defineType(runtime, 'ApiService', 'ApiService', { parentType: 'Resource' });
      await om.defineAttribute(runtime, 'Resource', 'status', 'String', false);
      await om.defineAttribute(runtime, 'Resource', 'base', 'Number', false);
      await om.defineAttribute(runtime, 'Resource', 'note', 'String', false);
      await om.defineRelation(runtime, 'depends_on', 'Resource', 'Resource');
      await om.createEntity(runtime, 'apiService:1', 'ApiService', 'ApiService 1');
      await om.createEntity(runtime, 'apiService:2', 'ApiService', 'ApiService 2');
      await om.createEntity(runtime, 'apiService:3', 'ApiService', 'ApiService 3');

      await om.defineComputed(runtime, 'Resource', 'bonus');
      om.registerComputed(runtime, 'Resource', 'bonus', async () => 1000);
      await om.defineComputed(runtime, 'Resource', 'score');
      om.registerComputed(runtime, 'Resource', 'score', async (ctx) => {
        phases.push('computed');
        const base = await om.getProperty(ctx.runtime, ctx.entityId, 'base');
        const bonus = await om.getProperty(ctx.runtime, ctx.entityId, 'bonus');
        return Number(base) * 2 + Number(bonus);
      });
      await om.defineComputed(runtime, 'Resource', 'temporal_score');
      om.registerComputed(runtime, 'Resource', 'temporal_score', async (ctx) => {
        const base = await om.getPropertyAsOf(ctx.runtime, ctx.entityId, 'base', ctx.asOf);
        return Number(base) * 3;
      });

      await om.defineConstraint(runtime, 'Resource', 'score_limit', { scope: 'conditional' });
      om.registerConstraint(
        runtime, 'Resource', 'score_limit',
        async () => true,
        async (ctx) => Number(await om.getProperty(ctx.runtime, ctx.entityId, 'score')) <= 2000
      );

      await om.setProperty(runtime, 'apiService:1', 'base', 4);
      await om.setProperty(runtime, 'apiService:1', 'status', 'active');
      expect(await om.getProperty(runtime, 'apiService:1', 'score')).toBe(1008);
      expect((await om.validateConstraints(runtime, 'apiService:1')).valid).toBe(true);

      // The constraint runs inside the write, so a violating value is rejected on write
      // rather than merely reported later.
      const rejected = await om
        .setProperty(runtime, 'apiService:2', 'base', 2000)
        .then(() => null)
        .catch((err) => err);
      expect(rejected).toBeTruthy();
      expect(String(rejected.message)).toContain('score_limit');
      expect(phases).toContain('computed');
    } finally {
      db.close();
    }
  });

  test('an in-flight action completes on one registry snapshot while later commands see clear', async () => {
    const { db, runtime } = await createRuntimeDb();
    const calls = [];

    try {
      await om.defineType(runtime, 'Resource', 'Resource');
      await om.createEntity(runtime, 'resource:1', 'Resource', 'Resource');

      await om.defineAction(runtime, 'Resource', 'inspect');
      om.registerAction(runtime, 'Resource', 'inspect', async () => {
        calls.push('first');
        return [];
      });

      await om.executeAction(runtime, 'resource:1', 'inspect', {});
      expect(calls).toEqual(['first']);

      om.clearRegistry(runtime);
      await expect(
        om.executeAction(runtime, 'resource:1', 'inspect', {})
      ).rejects.toThrow("Action 'inspect' not defined");

      om.registerAction(runtime, 'Resource', 'inspect', async () => {
        calls.push('second');
        return [];
      });
      await om.executeAction(runtime, 'resource:1', 'inspect', {});
      expect(calls).toEqual(['first', 'second']);
    } finally {
      db.close();
    }
  });
});
