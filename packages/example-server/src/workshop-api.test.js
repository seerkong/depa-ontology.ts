process.env.WORKSHOP_PERSIST = process.env.WORKSHOP_PERSIST || '0';
const { test, expect } = require('bun:test');

const { createApp } = require('./index');

async function requestJson(app, method, path, body) {
  const init = {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const data = await res.json();
  return { res, data };
}

function findAttr(projection, typeName, attrName) {
  const type = (projection.types || []).find((t) => t.name === typeName);
  if (!type) return null;
  return (type.attributes || []).find((a) => a.name === attrName) || null;
}

test('workshop API: CRM + HR projections expose types, relations, and statusLike hints', async () => {
  const { app, close } = createApp();
  try {
    const crm = await requestJson(app, 'GET', '/api/demos/crm/projection');
    expect(crm.res.status).toBe(200);
    expect(crm.data.status).toBe('ok');
    expect(crm.data.projection && typeof crm.data.projection === 'object').toBe(true);
    expect(Array.isArray(crm.data.projection.types)).toBe(true);
    expect(crm.data.projection.types.length).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(crm.data.projection.relations)).toBe(true);
    expect(crm.data.projection.relations.length).toBeGreaterThanOrEqual(6);

    const leadStatus = findAttr(crm.data.projection, 'Lead', 'status');
    const oppStage = findAttr(crm.data.projection, 'Opportunity', 'stage');
    expect(leadStatus && leadStatus.statusLike).toBe(true);
    expect(oppStage && oppStage.statusLike).toBe(true);
    expect(Array.isArray(leadStatus.enumHints)).toBe(true);
    expect(leadStatus.enumHints).toContain('qualified');
    expect(Array.isArray(oppStage.enumHints)).toBe(true);
    expect(oppStage.enumHints.length).toBeGreaterThanOrEqual(1);

    const hr = await requestJson(app, 'GET', '/api/demos/hr/projection');
    expect(hr.res.status).toBe(200);
    expect(hr.data.status).toBe('ok');
    expect(hr.data.projection.types.length).toBeGreaterThanOrEqual(5);
    expect(hr.data.projection.relations.length).toBeGreaterThanOrEqual(5);

    const reviewStatus = findAttr(hr.data.projection, 'ReviewCycle', 'status');
    expect(reviewStatus && reviewStatus.statusLike).toBe(true);
    expect(Array.isArray(reviewStatus.enumHints)).toBe(true);
    expect(reviewStatus.enumHints).toContain('completed');
    expect(reviewStatus.enumHints).toContain('in_progress');
  } finally {
    close();
  }
});

test('workshop API: CRM Opportunity list + detail (one type)', async () => {
  const { app, close } = createApp();
  try {
    const list = await requestJson(app, 'GET', '/api/demos/crm/objects/Opportunity');
    expect(list.res.status).toBe(200);
    expect(list.data.status).toBe('ok');
    expect(list.data.typeName).toBe('Opportunity');
    expect(Array.isArray(list.data.entities)).toBe(true);
    expect(list.data.entities.length).toBeGreaterThanOrEqual(2);

    const first = list.data.entities.find((e) => e.id === 'opp:acme-renew') || list.data.entities[0];
    expect(first && typeof first.id === 'string').toBe(true);
    expect(first.typeName).toBe('Opportunity');
    expect(first.properties && typeof first.properties === 'object').toBe(true);
    expect(first.properties.stage != null).toBe(true);

    const detail = await requestJson(
      app,
      'GET',
      `/api/demos/crm/objects/Opportunity/${encodeURIComponent(first.id)}`,
    );
    expect(detail.res.status).toBe(200);
    expect(detail.data.status).toBe('ok');
    expect(detail.data.entity && typeof detail.data.entity === 'object').toBe(true);
    expect(detail.data.entity.id).toBe(first.id);
    expect(detail.data.entity.typeName).toBe('Opportunity');
    expect(detail.data.entity.properties && typeof detail.data.entity.properties === 'object').toBe(true);
    expect(Array.isArray(detail.data.entity.outgoing)).toBe(true);
    expect(Array.isArray(detail.data.entity.incoming)).toBe(true);
  } finally {
    close();
  }
});

test('workshop API: unknown demo projection returns error payload', async () => {
  const { app, close } = createApp();
  try {
    const bad = await requestJson(app, 'GET', '/api/demos/no-such-demo/projection');
    expect(bad.res.status).toBe(200);
    expect(bad.data.status).toBe('error');
    expect(typeof bad.data.error).toBe('string');
    expect(bad.data.error.length).toBeGreaterThan(0);
  } finally {
    close();
  }
});
