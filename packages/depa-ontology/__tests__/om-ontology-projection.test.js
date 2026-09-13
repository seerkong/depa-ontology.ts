const { describe, expect, test } = require('bun:test');
const { createTestDb } = require('./helpers');

async function seedCrmLikeOntology(db, runtime, om) {
  await om.defineType(db, 'Account', '客户公司 / 账户');
  await om.defineType(db, 'Contact', '客户联系人');
  await om.defineType(db, 'Lead', '销售线索');
  await om.defineType(db, 'Opportunity', '销售商机');
  await om.defineType(db, 'Activity', '跟进活动');
  await om.defineType(db, 'SalesRep', '销售代表');

  await om.defineAttribute(db, 'Account', 'industry', 'String', true);
  await om.defineAttribute(db, 'Account', 'annual_revenue', 'Number', false);
  await om.defineAttribute(db, 'Account', 'tier', 'String', false);
  await om.defineAttribute(db, 'Contact', 'email', 'String', true);
  await om.defineAttribute(db, 'Contact', 'phone', 'String', false);
  await om.defineAttribute(db, 'Contact', 'title', 'String', false);
  await om.defineAttribute(db, 'Lead', 'source', 'String', true);
  await om.defineAttribute(db, 'Lead', 'score', 'Number', false);
  await om.defineAttribute(db, 'Lead', 'status', 'String', false);
  await om.defineAttribute(db, 'Opportunity', 'amount', 'Number', true);
  await om.defineAttribute(db, 'Opportunity', 'stage', 'String', true);
  await om.defineAttribute(db, 'Opportunity', 'close_probability', 'Number', false);
  await om.defineAttribute(db, 'Activity', 'activity_type', 'String', true);
  await om.defineAttribute(db, 'Activity', 'due_date', 'String', false);
  await om.defineAttribute(db, 'Activity', 'completed', 'Bool', false);
  await om.defineAttribute(db, 'SalesRep', 'region', 'String', true);
  await om.defineAttribute(db, 'SalesRep', 'quota', 'Number', false);
  await om.defineAttribute(db, 'SalesRep', 'active', 'Bool', false);

  await om.defineRelation(db, 'has_contact', 'Account', 'Contact', true);
  await om.defineRelation(db, 'has_opportunity', 'Account', 'Opportunity', true);
  await om.defineRelation(db, 'owned_by', 'Opportunity', 'SalesRep', true);
  await om.defineRelation(db, 'has_activity', 'Opportunity', 'Activity', true);
  await om.defineRelation(db, 'assigned_to', 'Lead', 'SalesRep', true);
  await om.defineRelation(db, 'converts_to', 'Lead', 'Opportunity', true);

  await om.ingestBatch(runtime, {
    entities: [
      { id: 'lead:a', typeName: 'Lead', label: 'L1' },
      { id: 'lead:b', typeName: 'Lead', label: 'L2' },
      { id: 'opp:a', typeName: 'Opportunity', label: 'O1' },
      { id: 'opp:b', typeName: 'Opportunity', label: 'O2' },
    ],
    properties: [
      { entityId: 'lead:a', attrName: 'source', value: 'website' },
      { entityId: 'lead:a', attrName: 'status', value: 'qualified' },
      { entityId: 'lead:b', attrName: 'source', value: 'expo' },
      { entityId: 'lead:b', attrName: 'status', value: 'new' },
      { entityId: 'opp:a', attrName: 'amount', value: 88000 },
      { entityId: 'opp:a', attrName: 'stage', value: 'proposal' },
      { entityId: 'opp:b', attrName: 'amount', value: 145000 },
      { entityId: 'opp:b', attrName: 'stage', value: 'negotiation' },
    ],
    edges: [],
  });
}

describe('exportOntologyProjection', () => {
  test('exports CRM-like projection with statusLike and optional enumHints', async () => {
    const { db, om , runtime } = await createTestDb();
    try {
      expect(typeof om.exportOntologyProjection).toBe('function');

      await seedCrmLikeOntology(db, runtime, om);

      const withoutHints = await om.exportOntologyProjection(db, { name: 'crm' });
      expect(withoutHints.meta.source).toBe('depa-ontology');
      expect(withoutHints.meta.name).toBe('crm');
      expect(typeof withoutHints.meta.exportedAt).toBe('string');
      expect(withoutHints.types.map((t) => t.name)).toEqual([
        'Account',
        'Activity',
        'Contact',
        'Lead',
        'Opportunity',
        'SalesRep',
      ]);
      expect(withoutHints.relations).toHaveLength(6);
      expect(Array.isArray(withoutHints.behaviors)).toBe(true);
      expect(withoutHints.gaps.length).toBeGreaterThan(0);

      const lead = withoutHints.types.find((t) => t.name === 'Lead');
      const opportunity = withoutHints.types.find((t) => t.name === 'Opportunity');
      const leadStatus = lead.attributes.find((a) => a.name === 'status');
      const oppStage = opportunity.attributes.find((a) => a.name === 'stage');
      expect(leadStatus.statusLike).toBe(true);
      expect(oppStage.statusLike).toBe(true);
      expect(leadStatus.enumHints).toBeUndefined();
      expect(oppStage.enumHints).toBeUndefined();
      expect(
        withoutHints.gaps.some((g) => g.includes('includeEnumHintsFromInstances'))
      ).toBe(true);

      const withHints = await om.exportOntologyProjection(db, {
        name: 'crm',
        includeEnumHintsFromInstances: true,
      });
      const lead2 = withHints.types.find((t) => t.name === 'Lead');
      const opp2 = withHints.types.find((t) => t.name === 'Opportunity');
      expect(lead2.attributes.find((a) => a.name === 'status').enumHints).toEqual([
        'new',
        'qualified',
      ]);
      expect(opp2.attributes.find((a) => a.name === 'stage').enumHints).toEqual([
        'negotiation',
        'proposal',
      ]);
      expect(
        withHints.gaps.some((g) => g.includes('includeEnumHintsFromInstances'))
      ).toBe(false);
    } finally {
      db.close();
    }
  });
});
