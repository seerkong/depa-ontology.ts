process.env.WORKSHOP_PERSIST = process.env.WORKSHOP_PERSIST || '0';
const { test, expect } = require('bun:test');

const { createApp } = require('./index');

async function requestJson(app, method, path, body) {
  const init = {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await app.handle(new Request('http://localhost' + path, init));
  const data = await res.json();
  return { res, data };
}

test('operations API: composite FQNs are listed', async () => {
  const { app, close } = createApp();
  try {
    const crm = await requestJson(app, 'GET', '/api/demos/crm/operations');
    const crmFqns = crm.data.operations.map((o) => o.fqn);
    expect(crmFqns).toContain('ontology.crm.op.ConvertLead');
    expect(crmFqns).toContain('ontology.crm.op.AssignLead');

    const hr = await requestJson(app, 'GET', '/api/demos/hr/operations');
    const hrFqns = hr.data.operations.map((o) => o.fqn);
    expect(hrFqns).toContain('ontology.hr.op.TransferEmployee');
    expect(hrFqns).toContain('ontology.hr.op.AssignSkill');

    const po = await requestJson(app, 'GET', '/api/demos/procurement/operations');
    const poFqns = po.data.operations.map((o) => o.fqn);
    expect(poFqns).toContain('ontology.procurement.op.PlaceOrderWithSupplier');
    expect(poFqns).toContain('ontology.procurement.op.CoverOrderWithContract');
  } finally {
    close();
  }
});

test('ConvertLead creates Opportunity and graph-links Lead', async () => {
  const { app, close } = createApp();
  try {
    const oppId = 'opp:test-convert-' + Date.now();
    const invoke = await requestJson(app, 'POST', '/api/demos/crm/invoke', {
      fqn: 'ontology.crm.op.ConvertLead',
      selector: { kind: 'one', objectType: 'Lead', id: 'lead:web-ship' },
      invocation: {
        type: 'Lead.convert',
        kind: 'action',
        payload: {
          accountId: 'acct:acme',
          amount: 42000,
          stage: 'qualify',
          opportunityId: oppId,
          opportunityLabel: '测试转化商机',
          productId: 'prod:platform',
        },
      },
    });
    expect(invoke.data.status).toBe('ok');
    expect(invoke.data.ok).toBe(true);
    expect(invoke.data.result.opportunityId).toBe(oppId);

    const opps = await requestJson(app, 'GET', '/api/demos/crm/objects/Opportunity');
    expect(opps.data.entities.map((e) => e.id)).toContain(oppId);

    const lead = await requestJson(
      app,
      'GET',
      '/api/demos/crm/objects/Lead/' + encodeURIComponent('lead:web-ship'),
    );
    expect(lead.data.entity.properties.status).toBe('converted');
    const outRels = lead.data.entity.outgoing.map((l) => l.relName);
    expect(outRels).toContain('converts_to');
    expect(outRels).toContain('belongs_to');
  } finally {
    close();
  }
});

test('TransferEmployee rewires works_in without JOIN', async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, 'POST', '/api/demos/hr/invoke', {
      fqn: 'ontology.hr.op.TransferEmployee',
      selector: { kind: 'one', objectType: 'Employee', id: 'emp:frank' },
      invocation: {
        type: 'Employee.transfer',
        kind: 'action',
        payload: { departmentId: 'dept:platform' },
      },
    });
    expect(invoke.data.ok).toBe(true);

    const detail = await requestJson(
      app,
      'GET',
      '/api/demos/hr/objects/Employee/' + encodeURIComponent('emp:frank'),
    );
    const works = detail.data.entity.outgoing.filter((l) => l.relName === 'works_in');
    expect(works.length).toBe(1);
    expect(works[0].toId).toBe('dept:platform');
  } finally {
    close();
  }
});

test('CoverOrderWithContract swaps covered_by edge', async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, 'POST', '/api/demos/procurement/invoke', {
      fqn: 'ontology.procurement.op.CoverOrderWithContract',
      selector: { kind: 'one', objectType: 'PurchaseOrder', id: 'po:1002' },
      invocation: {
        type: 'PurchaseOrder.coverWithContract',
        kind: 'action',
        payload: { contractId: 'ct:master' },
      },
    });
    expect(invoke.data.ok).toBe(true);

    const detail = await requestJson(
      app,
      'GET',
      '/api/demos/procurement/objects/PurchaseOrder/' + encodeURIComponent('po:1002'),
    );
    const covered = detail.data.entity.outgoing.filter((l) => l.relName === 'covered_by');
    expect(covered.some((l) => l.toId === 'ct:master')).toBe(true);
  } finally {
    close();
  }
});

test('graph impact and tree endpoints return visual graphs', async () => {
  const { app, close } = createApp();
  try {
    const impact = await requestJson(
      app,
      'GET',
      '/api/demos/hr/graph/impact/' + encodeURIComponent('emp:alice') + '?maxDepth=3&direction=incoming',
    );
    expect(impact.data.status).toBe('ok');
    expect(impact.data.visual && impact.data.visual.graph).toBeTruthy();
    expect(Array.isArray(impact.data.visual.graph.nodes)).toBe(true);
    expect(impact.data.visual.graph.nodes.length).toBeGreaterThan(0);

    const tree = await requestJson(
      app,
      'GET',
      '/api/demos/procurement/graph/tree/' + encodeURIComponent('po:1001') + '?maxDepth=3',
    );
    expect(tree.data.status).toBe('ok');
    expect(tree.data.visual).toBeTruthy();
  } finally {
    close();
  }
});

test('thickened types appear in object lists', async () => {
  const { app, close } = createApp();
  try {
    const campaigns = await requestJson(app, 'GET', '/api/demos/crm/objects/Campaign');
    expect(campaigns.data.status).toBe('ok');
    expect(campaigns.data.entities.length).toBeGreaterThan(0);

    const products = await requestJson(app, 'GET', '/api/demos/crm/objects/Product');
    expect(products.data.entities.length).toBeGreaterThan(0);

    const shipments = await requestJson(app, 'GET', '/api/demos/procurement/objects/Shipment');
    expect(shipments.data.status).toBe('ok');
    expect(shipments.data.entities.length).toBeGreaterThan(0);

    const platform = await requestJson(
      app,
      'GET',
      '/api/demos/hr/objects/Department/' + encodeURIComponent('dept:platform'),
    );
    expect(platform.data.status).toBe('ok');
    expect(platform.data.entity.label).toBe('平台组');
  } finally {
    close();
  }
});
