const { expect, test, describe } = require('bun:test');

const { createTestDb } = require('./helpers');
const dsl = require('depa-datalog');

describe('Phase 2 (track add-action-and-constraints): actions', () => {
  test('defineAction stores metadata in om_action_def', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Resource', 'Resource');

      await om.registerAction(
        runtime,
        'Resource',
        'approve',
        async () => []
      );
      await om.defineAction(runtime,
        'Resource',
        'approve', 'Approve resource');

      const q = dsl.query()
        .select(['description'])
        .fromStored('om_action_def', {
          type_name: dsl.param('type_name', 'Resource'),
          action_name: dsl.param('action_name', 'approve'),
          description: dsl.var('description'),
        })
        .limit(1)
        .build();
      const result = await db.run(q.script, q.params);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0][0]).toBe('Approve resource');
    } finally {
      db.close();
    }
  });

  test('executeAction runs handler and applies returned mutations', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Resource', 'Resource');
      await om.defineAttribute(db, 'Resource', 'status', 'String', true);
      await om.createEntity(db, 'resource:1', 'Resource', 'Resource #1');
      await om.setProperty(runtime, 'resource:1', 'status', 'pending');

      await om.registerMutation(
        runtime,
        'Resource',
        'setStatus',
        async (ctx, params) => {
          await ctx.setProperty('status', String(params.status));
        }
      );
      await om.defineMutation(runtime,
        'Resource',
        'setStatus');

      await om.registerAction(
        runtime,
        'Resource',
        'approve',
        async () => [{ mutation: 'setStatus', params: { status: 'approved' } }]
      );
      await om.defineAction(runtime,
        'Resource',
        'approve');

      await om.executeAction(runtime, 'resource:1', 'approve', {});
      const status = await om.getProperty(runtime, 'resource:1', 'status');
      expect(status).toBe('approved');
    } finally {
      db.close();
    }
  });

  test('executeAction errors if action is not defined', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Resource', 'Resource');
      await om.createEntity(db, 'resource:2', 'Resource', 'Resource #2');

      await expect(om.executeAction(runtime, 'resource:2', 'reject', {})).rejects.toThrow(
        /Action 'reject' not defined|Action not defined|does not exist/i
      );
    } finally {
      db.close();
    }
  });

  test('action inheritance: subtype can execute parent action', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Resource', 'Resource');
      await om.defineType(db, 'ExecutableResource', 'ExecutableResource', { parentType: 'Resource' });
      await om.defineAttribute(db, 'Resource', 'status', 'String', true);

      await om.createEntity(db, 'exec:1', 'ExecutableResource', 'ExecutableResource #1');
      await om.setProperty(runtime, 'exec:1', 'status', 'pending');

      await om.registerMutation(
        runtime, 'Resource', 'setStatus',
        async (ctx, params) => {
        await ctx.setProperty('status', String(params.status));
      }
      );
      await om.defineMutation(runtime, 'Resource', 'setStatus');

      await om.registerAction(
        runtime, 'Resource', 'decommission',
        async () => [
        { mutation: 'setStatus', params: { status: 'decommissioned' } },
      ]
      );
      await om.defineAction(runtime, 'Resource', 'decommission');

      await om.executeAction(runtime, 'exec:1', 'decommission', {});
      expect(await om.getProperty(runtime, 'exec:1', 'status')).toBe('decommissioned');
    } finally {
      db.close();
    }
  });

  test('action override: subtype can callParentAction and extend mutations', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Resource', 'Resource');
      await om.defineType(db, 'ExecutableResource', 'ExecutableResource', { parentType: 'Resource' });

      await om.defineAttribute(db, 'Resource', 'status', 'String', true);
      await om.defineAttribute(db, 'ExecutableResource', 'ip_address', 'String', false);

      await om.createEntity(db, 'exec:2', 'ExecutableResource', 'ExecutableResource #2');
      await om.setProperty(runtime, 'exec:2', 'status', 'pending');
      await om.setProperty(runtime, 'exec:2', 'ip_address', '10.0.0.1');

      await om.registerMutation(
        runtime, 'Resource', 'setStatus',
        async (ctx, params) => {
        await ctx.setProperty('status', String(params.status));
      }
      );
      await om.defineMutation(runtime, 'Resource', 'setStatus');
      await om.registerMutation(
        runtime, 'ExecutableResource', 'clearIp',
        async (ctx) => {
        await ctx.setProperty('ip_address', '');
      }
      );
      await om.defineMutation(runtime, 'ExecutableResource', 'clearIp');

      await om.registerAction(
        runtime, 'Resource', 'decommission',
        async () => [
        { mutation: 'setStatus', params: { status: 'decommissioned' } },
      ]
      );
      await om.defineAction(runtime, 'Resource', 'decommission');

      await om.registerAction(
        runtime, 'ExecutableResource', 'decommission',
        async (ctx, params) => {
        const parent = await ctx.callParentAction('decommission', params);
        return [...parent, { mutation: 'clearIp', params: {} }];
      }
      );
      await om.defineAction(runtime, 'ExecutableResource', 'decommission');

      await om.executeAction(runtime, 'exec:2', 'decommission', {});
      expect(await om.getProperty(runtime, 'exec:2', 'status')).toBe('decommissioned');
      expect(await om.getProperty(runtime, 'exec:2', 'ip_address')).toBe('');
    } finally {
      db.close();
    }
  });

  test('nearest ancestor action is used when child does not override', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Resource', 'Resource');
      await om.defineType(db, 'ExecutableResource', 'ExecutableResource', { parentType: 'Resource' });
      await om.defineType(db, 'ApiService', 'ApiService', { parentType: 'ExecutableResource' });

      await om.defineAttribute(db, 'Resource', 'status', 'String', true);
      await om.defineAttribute(db, 'ExecutableResource', 'ip_address', 'String', false);

      await om.createEntity(db, 'srv:1', 'ApiService', 'ApiService #1');
      await om.setProperty(runtime, 'srv:1', 'status', 'pending');
      await om.setProperty(runtime, 'srv:1', 'ip_address', '10.0.0.2');

      await om.registerMutation(
        runtime, 'Resource', 'setStatus',
        async (ctx, params) => {
        await ctx.setProperty('status', String(params.status));
      }
      );
      await om.defineMutation(runtime, 'Resource', 'setStatus');
      await om.registerMutation(
        runtime, 'ExecutableResource', 'clearIp',
        async (ctx) => {
        await ctx.setProperty('ip_address', '');
      }
      );
      await om.defineMutation(runtime, 'ExecutableResource', 'clearIp');

      await om.registerAction(
        runtime, 'Resource', 'decommission',
        async () => [
        { mutation: 'setStatus', params: { status: 'decommissioned' } },
      ]
      );
      await om.defineAction(runtime, 'Resource', 'decommission');

      await om.registerAction(
        runtime, 'ExecutableResource', 'decommission',
        async (ctx, params) => {
        const parent = await ctx.callParentAction('decommission', params);
        return [...parent, { mutation: 'clearIp', params: {} }];
      }
      );
      await om.defineAction(runtime, 'ExecutableResource', 'decommission');

      // ApiService does NOT override, so it should use ExecutableResource's nearest-ancestor version.
      await om.executeAction(runtime, 'srv:1', 'decommission', {});
      expect(await om.getProperty(runtime, 'srv:1', 'status')).toBe('decommissioned');
      expect(await om.getProperty(runtime, 'srv:1', 'ip_address')).toBe('');
    } finally {
      db.close();
    }
  });

  test('three-level action overrides call each owner and commit parent and child mutations once', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Root', 'Root');
      await om.defineType(db, 'Middle', 'Middle', { parentType: 'Root' });
      await om.defineType(db, 'Leaf', 'Leaf', { parentType: 'Middle' });

      await om.defineAttribute(db, 'Root', 'parent_effect', 'String', false);
      await om.defineAttribute(db, 'Leaf', 'child_effect', 'String', false);
      await om.createEntity(db, 'leaf:three-level', 'Leaf', 'Three-level leaf');

      const actionOwners = [];
      const mutationCalls = [];

      await om.registerMutation(
        runtime, 'Root', 'applyParentEffect',
        async (ctx) => {
        mutationCalls.push('parent');
        await ctx.setProperty('parent_effect', 'committed');
      }
      );
      await om.defineMutation(runtime, 'Root', 'applyParentEffect');
      await om.registerMutation(
        runtime, 'Leaf', 'applyChildEffect',
        async (ctx) => {
        mutationCalls.push('child');
        await ctx.setProperty('child_effect', 'committed');
      }
      );
      await om.defineMutation(runtime, 'Leaf', 'applyChildEffect');

      await om.registerAction(
        runtime, 'Root', 'cascade',
        async (ctx) => {
        actionOwners.push(ctx.actionOwnerType);
        return [{ mutation: 'applyParentEffect', params: {} }];
      }
      );
      await om.defineAction(runtime, 'Root', 'cascade');
      await om.registerAction(
        runtime, 'Middle', 'cascade',
        async (ctx, params) => {
        actionOwners.push(ctx.actionOwnerType);
        return ctx.callParentAction('cascade', params);
      }
      );
      await om.defineAction(runtime, 'Middle', 'cascade');
      await om.registerAction(
        runtime, 'Leaf', 'cascade',
        async (ctx, params) => {
        actionOwners.push(ctx.actionOwnerType);
        const parent = await ctx.callParentAction('cascade', params);
        return [...parent, { mutation: 'applyChildEffect', params: {} }];
      }
      );
      await om.defineAction(runtime, 'Leaf', 'cascade');

      await om.executeAction(runtime, 'leaf:three-level', 'cascade', {});

      expect(actionOwners).toEqual(['Leaf', 'Middle', 'Root']);
      expect(mutationCalls).toEqual(['parent', 'child']);
      expect(await om.getProperty(runtime, 'leaf:three-level', 'parent_effect')).toBe('committed');
      expect(await om.getProperty(runtime, 'leaf:three-level', 'child_effect')).toBe('committed');
    } finally {
      db.close();
    }
  });

  test('three-level parent and child mutations roll back when a later mutation fails', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Root', 'Root');
      await om.defineType(db, 'Middle', 'Middle', { parentType: 'Root' });
      await om.defineType(db, 'Leaf', 'Leaf', { parentType: 'Middle' });

      await om.defineAttribute(db, 'Root', 'parent_effect', 'String', false);
      await om.defineAttribute(db, 'Leaf', 'child_effect', 'String', false);
      await om.createEntity(db, 'leaf:rollback', 'Leaf', 'Rollback leaf');
      await om.setProperty(runtime, 'leaf:rollback', 'parent_effect', 'initial-parent');
      await om.setProperty(runtime, 'leaf:rollback', 'child_effect', 'initial-child');

      await om.registerMutation(
        runtime, 'Root', 'applyParentEffect',
        async (ctx) => {
        await ctx.setProperty('parent_effect', 'changed-parent');
      }
      );
      await om.defineMutation(runtime, 'Root', 'applyParentEffect');
      await om.registerMutation(
        runtime, 'Leaf', 'applyChildEffect',
        async (ctx) => {
        await ctx.setProperty('child_effect', 'changed-child');
      }
      );
      await om.defineMutation(runtime, 'Leaf', 'applyChildEffect');
      await om.registerMutation(
        runtime, 'Leaf', 'failAfterEffects',
        async () => {
        throw new Error('later mutation failed');
      }
      );
      await om.defineMutation(runtime, 'Leaf', 'failAfterEffects');

      await om.registerAction(
        runtime, 'Root', 'cascade',
        async () => [
        { mutation: 'applyParentEffect', params: {} },
      ]
      );
      await om.defineAction(runtime, 'Root', 'cascade');
      await om.registerAction(
        runtime, 'Middle', 'cascade',
        async (ctx, params) =>
        ctx.callParentAction('cascade', params)
      );
      await om.defineAction(runtime, 'Middle', 'cascade');
      await om.registerAction(
        runtime, 'Leaf', 'cascade',
        async (ctx, params) => {
        const parent = await ctx.callParentAction('cascade', params);
        return [
          ...parent,
          { mutation: 'applyChildEffect', params: {} },
          { mutation: 'failAfterEffects', params: {} },
        ];
      }
      );
      await om.defineAction(runtime, 'Leaf', 'cascade');

      await expect(om.executeAction(runtime, 'leaf:rollback', 'cascade', {})).rejects.toThrow(
        'later mutation failed'
      );
      expect(await om.getProperty(runtime, 'leaf:rollback', 'parent_effect')).toBe('initial-parent');
      expect(await om.getProperty(runtime, 'leaf:rollback', 'child_effect')).toBe('initial-child');
    } finally {
      db.close();
    }
  });

  test('child action resolves an ancestor mutation from the nearest owner', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      await om.defineType(db, 'Root', 'Root');
      await om.defineType(db, 'Middle', 'Middle', { parentType: 'Root' });
      await om.defineType(db, 'Leaf', 'Leaf', { parentType: 'Middle' });
      await om.defineAttribute(db, 'Root', 'mutation_owner', 'String', false);
      await om.createEntity(db, 'leaf:mutation-owner', 'Leaf', 'Mutation owner leaf');

      const mutationOwners = [];
      await om.registerMutation(
        runtime, 'Root', 'recordOwner',
        async (ctx) => {
        mutationOwners.push('Root');
        await ctx.setProperty('mutation_owner', 'Root');
      }
      );
      await om.defineMutation(runtime, 'Root', 'recordOwner');
      await om.registerMutation(
        runtime, 'Middle', 'recordOwner',
        async (ctx) => {
        mutationOwners.push('Middle');
        await ctx.setProperty('mutation_owner', 'Middle');
      }
      );
      await om.defineMutation(runtime, 'Middle', 'recordOwner');
      await om.registerAction(
        runtime, 'Leaf', 'recordMutationOwner',
        async () => [
        { mutation: 'recordOwner', params: {} },
      ]
      );
      await om.defineAction(runtime, 'Leaf', 'recordMutationOwner');

      await om.executeAction(runtime, 'leaf:mutation-owner', 'recordMutationOwner', {});

      expect(mutationOwners).toEqual(['Middle']);
      expect(await om.getProperty(runtime, 'leaf:mutation-owner', 'mutation_owner')).toBe('Middle');
    } finally {
      db.close();
    }
  });
});
