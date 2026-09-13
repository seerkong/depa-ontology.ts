const { expect, test, describe } = require('bun:test');

describe('Phase 2 (track add-action-and-constraints): module exports', () => {
  test('cozo-om exports new behavior-layer APIs', async () => {
    const om = require('../cozo-om');

    // Definition and registration are separate APIs: define* persists the definition,
    // register* attaches the runtime callback. `addInterceptor` became `defineInterceptor`.
    const expectedFns = [
      'defineMutation', 'registerMutation',
      'defineAction', 'registerAction', 'executeAction', 'callParentAction',
      'defineConstraint', 'registerConstraint', 'registerValidator', 'validateConstraints',
      'defineComputed', 'registerComputed',
      'defineInterceptor', 'registerInterceptor',
      'executeMutations', 'clearRegistry',
    ];

    for (const name of expectedFns) {
      expect(typeof om[name]).toBe('function');
    }
  });

  test('inferValueType exposes the public OM value classification contract', () => {
    const om = require('../cozo-om');

    expect(om.inferValueType('text')).toBe('String');
    expect(om.inferValueType(42)).toBe('Number');
    expect(om.inferValueType(true)).toBe('Bool');
    expect(om.inferValueType({ nested: true })).toBe('Json');
    expect(om.inferValueType(null)).toBe('Unknown');
    expect(om.inferValueType(Number.NaN)).toBe('Unknown');
  });
});

describe('Phase 3 (track add-temporal-dimension): module exports', () => {
  test('cozo-om exports temporal and unlinkEntities APIs', async () => {
    const om = require('../cozo-om');

    const expectedFns = [
      'unlinkEntities',
      'getPropertyHistory',
      'getPropertyAsOf',
      'getEntityViewAsOf',
      'getNeighborsAsOf',
      'getEdgeHistory',
      'validatePropertyType',
      'validateRelation',
      'validateRequiredProperties',
      'finalizeEntity',
    ];

    for (const name of expectedFns) {
      expect(typeof om[name]).toBe('function');
    }
  });
});

describe('Phase 4 (track add-schema-versioning-permission-integration): module exports', () => {
  test('cozo-om exports checkAccess API', async () => {
    const om = require('../cozo-om');
    expect(typeof om.checkAccess).toBe('function');
  });
});
