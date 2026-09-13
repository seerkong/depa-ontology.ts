const { describe, expect, test } = require('bun:test');

const { CozoDb } = require('../index');
const om = require('../cozo-om');

/**
 * Registry isolation across databases.
 *
 * Two databases in one process are two authorities: each one's registered behaviors
 * must stay its own. The failure this guards against is silent — a later registration
 * overwrote an earlier one, so callers executed someone else's executor with no error.
 */
async function initDb() {
  const db = new CozoDb('mem', '', {});
  await om.initSchema(db);
  await om.defineType(db, 'Thing', 'Thing');
  await om.createEntity(db, 'thing:1', 'Thing', 'Thing');
  return db;
}

describe('OM registry isolation across databases', () => {
  test('two runtimes each execute their own same-named mutation', async () => {
    const dbA = await initDb();
    const dbB = await initDb();
    const ran = [];

    try {
      const runtimeA = om.createOmRuntime(dbA);
      const runtimeB = om.createOmRuntime(dbB);

      om.registerMutation(runtimeA, 'Thing', 'flavor', async () => {
        ran.push('A');
      });
      om.registerMutation(runtimeB, 'Thing', 'flavor', async () => {
        ran.push('B');
      });

      await om.executeMutations(runtimeA, 'thing:1', [{ mutation: 'flavor', params: {} }]);
      await om.executeMutations(runtimeB, 'thing:1', [{ mutation: 'flavor', params: {} }]);

      // Registering B must not have replaced A's executor.
      expect(ran).toEqual(['A', 'B']);
    } finally {
      dbA.close?.();
      dbB.close?.();
    }
  });

  test('clearing one runtime does not clear another runtime registry', async () => {
    const dbA = await initDb();
    const dbB = await initDb();
    const ran = [];

    try {
      const runtimeA = om.createOmRuntime(dbA);
      const runtimeB = om.createOmRuntime(dbB);

      om.registerMutation(runtimeA, 'Thing', 'onlyA', async () => {
        ran.push('A');
      });

      // Simulate a second demo coming online: it clears only its own registry.
      om.clearRegistry(runtimeB);
      om.registerMutation(runtimeB, 'Thing', 'onlyB', async () => {
        ran.push('B');
      });

      await om.executeMutations(runtimeA, 'thing:1', [{ mutation: 'onlyA', params: {} }]);
      await om.executeMutations(runtimeB, 'thing:1', [{ mutation: 'onlyB', params: {} }]);

      expect(ran).toEqual(['A', 'B']);
    } finally {
      dbA.close?.();
      dbB.close?.();
    }
  });

  test('a bare runner cannot register, so no registry can leak across databases', async () => {
    const dbA = await initDb();
    const dbB = await initDb();
    const ran = [];

    try {
      // A bare CozoDb is not an authority boundary for behaviors. Registration must be
      // refused outright — previously it fell back to a module-level registry, which let
      // dbB execute dbA's executor with no error at all.
      await expect(om.defineMutation(dbA, 'Thing', 'flavor', 'd')).rejects.toThrow();
      expect(() =>
        om.registerMutation(dbA, 'Thing', 'flavor', async () => {
          ran.push('A');
        })
      ).toThrow();

      let outcome = 'executed';
      try {
        await om.executeMutations(dbB, 'thing:1', [{ mutation: 'flavor', params: {} }]);
      } catch (err) {
        outcome = 'rejected';
      }

      // Nothing ran, and dbB cannot reach a behavior that was never validly registered.
      expect(ran).toEqual([]);
      expect(outcome).toBe('rejected');
    } finally {
      dbA.close?.();
      dbB.close?.();
    }
  });

  test('define* persists the definition while register* supplies the callback', async () => {
    const db = await initDb();
    const ran = [];
    try {
      const runtime = om.createOmRuntime(db);
      // The split: definition is data (persisted), callback is a runtime resource.
      await om.defineMutation(runtime, 'Thing', 'flavor', 'Flavor description');
      om.registerMutation(runtime, 'Thing', 'flavor', async () => {
        ran.push('ran');
      });

      const catalog = await om.getBehaviorCatalog(runtime);
      const entry = catalog.behaviors.find((b) => b.name === 'flavor');
      expect(entry).toBeTruthy();
      expect(entry.description).toBe('Flavor description');

      await om.executeMutations(runtime, 'thing:1', [{ mutation: 'flavor', params: {} }]);
      expect(ran).toEqual(['ran']);
    } finally {
      db.close?.();
    }
  });

  test('registration APIs require an explicit runtime instead of a singleton fallback', async () => {
    const db = await initDb();

    try {
      // Every registration API demands an explicit runtime; a bare runner fails loudly
      // rather than quietly using module-level state.
      await expect(om.defineMutation(db, 'Thing', 'm', 'd')).rejects.toThrow();
      await expect(om.defineAction(db, 'Thing', 'a', 'd')).rejects.toThrow();
      await expect(om.defineComputed(db, 'Thing', 'attr', 'd')).rejects.toThrow();
      await expect(
        om.defineConstraint(db, 'Thing', 'c', { scope: 'conditional', message: 'm' })
      ).rejects.toThrow();
      await expect(
        om.defineInterceptor(db, 'Thing', 'a', 'before', async () => {})
      ).rejects.toThrow();

      expect(() => om.registerMutation(db, 'Thing', 'm', async () => {})).toThrow();
      expect(() => om.registerAction(db, 'Thing', 'a', async () => [])).toThrow();
      // The no-arg clear is gone: clearing "the" registry was the shared-state bug.
      expect(() => om.clearRegistry()).toThrow();
    } finally {
      db.close?.();
    }
  });
});
