'use strict';

/**
 * OntologyOperation registry + invoke runtime for Workshop API.
 * Aligns with ontology-operation.md v0.2.1 (§2/§5/§8/§10/§14).
 *
 * FQN routing: depa-processor DispatchEngine ROUTE_KEY
 * (DispatchStrategyConfig.forRouteKeyStrategy + createRouteKeyDispatchRequest).
 *
 * entry: "effect" | "addressed"
 * addressed invocation: { type, kind?, payload?, metadata? }
 *
 * Deviation note: CRM also exposes ConvertLead (composite create+link) using
 * converts_to / belongs_to / has_opportunity — object-graph mutation as one facade.
 */

const { om } = require('depa-ontology');
const {
  DispatchEngine,
  DispatchStrategyConfig,
  createRouteKeyDispatchRequest,
} = require('depa-processor');
const { getWorkshopDb, resolveDemo } = require('./workshop');

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'item';
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function reject(code, message, details) {
  return {
    status: 'rejected',
    ok: false,
    rejected: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function okResult(result) {
  return { status: 'ok', ok: true, result };
}

function errorResult(code, message, details) {
  return {
    status: 'error',
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/** Compat: old formula input/selector → entry effect/addressed */
function normalizeEntry(op) {
  if (op.entry === 'effect' || op.entry === 'addressed') return op.entry;
  if (op.formula === 'input') return 'effect';
  if (op.formula === 'selector') return 'addressed';
  return op.entry;
}

function resolveSelectorIds(selector) {
  if (!selector || typeof selector !== 'object') {
    return { error: reject('INVALID_SELECTOR', 'selector is required') };
  }
  const kind = selector.kind;
  if (kind === 'one') {
    if (!selector.id) return { error: reject('INVALID_SELECTOR', 'selector.id required for kind=one') };
    return { ids: [String(selector.id)], objectType: selector.objectType };
  }
  if (kind === 'ids') {
    if (!Array.isArray(selector.ids) || selector.ids.length === 0) {
      return { error: reject('INVALID_SELECTOR', 'selector.ids must be a non-empty array') };
    }
    return { ids: selector.ids.map(String), objectType: selector.objectType };
  }
  if (kind === 'query') {
    return { error: reject('UNSUPPORTED_SELECTOR', 'selector.kind=query is not supported in v0.1') };
  }
  return { error: reject('INVALID_SELECTOR', `Unknown selector.kind: ${kind}`) };
}

/**
 * Validate addressed invocation envelope.
 * Rejects flat magic bags (e.g. { stage } without type/payload).
 */
function validateInvocationEnvelope(invocation, expectedType) {
  if (invocation == null || typeof invocation !== 'object' || Array.isArray(invocation)) {
    return reject('VALIDATION', 'invocation must be an object envelope { type, kind?, payload?, metadata? }');
  }
  const keys = Object.keys(invocation);
  const hasType = typeof invocation.type === 'string' && invocation.type.trim().length > 0;
  const hasPayload = invocation.payload != null && typeof invocation.payload === 'object' && !Array.isArray(invocation.payload);
  const looksFlat =
    !hasType &&
    !hasPayload &&
    keys.some((k) => !['type', 'kind', 'payload', 'metadata'].includes(k));
  if (looksFlat) {
    return reject(
      'INVALID_INVOCATION',
      'flat invocation rejected; use { type, kind?, payload, metadata? }',
      { got: invocation },
    );
  }
  if (!hasType) {
    return reject('VALIDATION', 'invocation.type is required');
  }
  if (!hasPayload) {
    return reject('VALIDATION', 'invocation.payload is required (object)');
  }
  if (expectedType && invocation.type !== expectedType) {
    return reject('INVOCATION_TYPE_MISMATCH', `invocation.type must be '${expectedType}'`, {
      expected: expectedType,
      got: invocation.type,
    });
  }
  return null;
}

async function ensureEntityExists(db, entityId, expectedType) {
  const view = await om.getEntityView(db, entityId);
  if (!view) {
    return null;
  }
  if (expectedType && view.typeName !== expectedType) {
    return { mismatch: true, view };
  }
  return view;
}

async function unlinkOutgoing(db, fromId, relName) {
  const neighbors = await om.getNeighbors(db, fromId, relName, 'outgoing');
  const outgoing = (neighbors && neighbors.outgoing) || [];
  const removed = [];
  for (const n of outgoing) {
    await om.unlinkEntities(db, fromId, relName, n.entityId);
    removed.push(n.entityId);
  }
  return removed;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// ── CRM handlers ────────────────────────────────────────────────────────────

async function handleCreateLead(db, input) {
  const label = input && input.label != null ? String(input.label).trim() : '';
  const source = input && input.source != null ? String(input.source).trim() : '';
  if (!label) return reject('VALIDATION', 'input.label is required');
  if (!source) return reject('VALIDATION', 'input.source is required');

  const id =
    input.id != null && String(input.id).trim()
      ? String(input.id).trim()
      : `lead:${slugify(label)}-${shortId()}`;

  const status = input.status != null ? String(input.status) : 'new';
  const score = input.score != null ? Number(input.score) : undefined;

  await om.createEntity(db, id, 'Lead', label);
  await om.setProperty(db, id, 'source', source);
  await om.setProperty(db, id, 'status', status);
  if (score !== undefined && !Number.isNaN(score)) {
    await om.setProperty(db, id, 'score', score);
  }

  return okResult({ id, typeName: 'Lead', label, properties: { source, status, ...(score !== undefined ? { score } : {}) } });
}

async function handleCreateOpportunity(db, input) {
  const label = input && input.label != null ? String(input.label).trim() : '';
  if (!label) return reject('VALIDATION', 'input.label is required');
  if (input.amount == null || Number.isNaN(Number(input.amount))) {
    return reject('VALIDATION', 'input.amount is required (number)');
  }
  const stage = input.stage != null ? String(input.stage).trim() : '';
  if (!stage) return reject('VALIDATION', 'input.stage is required');

  const id =
    input.id != null && String(input.id).trim()
      ? String(input.id).trim()
      : `opp:${slugify(label)}-${shortId()}`;

  const amount = Number(input.amount);
  const close_probability =
    input.close_probability != null ? Number(input.close_probability) : undefined;

  await om.createEntity(db, id, 'Opportunity', label);
  await om.setProperty(db, id, 'amount', amount);
  await om.setProperty(db, id, 'stage', stage);
  if (close_probability !== undefined && !Number.isNaN(close_probability)) {
    await om.setProperty(db, id, 'close_probability', close_probability);
  }

  return okResult({
    id,
    typeName: 'Opportunity',
    label,
    properties: {
      amount,
      stage,
      ...(close_probability !== undefined ? { close_probability } : {}),
    },
  });
}

async function handleCreateAccount(db, input) {
  const label = input && input.label != null ? String(input.label).trim() : '';
  const industry = input && input.industry != null ? String(input.industry).trim() : '';
  if (!label) return reject('VALIDATION', 'input.label is required');
  if (!industry) return reject('VALIDATION', 'input.industry is required');

  const id =
    input.id != null && String(input.id).trim()
      ? String(input.id).trim()
      : `acct:${slugify(label)}-${shortId()}`;

  const tier = input.tier != null ? String(input.tier) : undefined;
  const annual_revenue =
    input.annual_revenue != null ? Number(input.annual_revenue) : undefined;

  await om.createEntity(db, id, 'Account', label);
  await om.setProperty(db, id, 'industry', industry);
  if (tier != null) await om.setProperty(db, id, 'tier', tier);
  if (annual_revenue !== undefined && !Number.isNaN(annual_revenue)) {
    await om.setProperty(db, id, 'annual_revenue', annual_revenue);
  }

  return okResult({
    id,
    typeName: 'Account',
    label,
    properties: {
      industry,
      ...(tier != null ? { tier } : {}),
      ...(annual_revenue !== undefined ? { annual_revenue } : {}),
    },
  });
}

async function handleSetLeadStatus(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;

  const invErr = validateInvocationEnvelope(invocation, 'Lead.setStatus');
  if (invErr) return invErr;

  const status =
    invocation.payload && invocation.payload.status != null
      ? String(invocation.payload.status).trim()
      : '';
  if (!status) return reject('VALIDATION', 'invocation.payload.status is required');

  const updated = [];
  for (const id of resolved.ids) {
    const view = await ensureEntityExists(db, id, 'Lead');
    if (!view) return reject('ENTITY_NOT_FOUND', `Lead not found: ${id}`, { id });
    if (view.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${id} is not Lead`, { typeName: view.view.typeName });
    }
    await om.setProperty(db, id, 'status', status);
    updated.push({ id, status });
  }
  return okResult({ updated });
}

async function handleAdvanceOpportunityStage(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;

  const invErr = validateInvocationEnvelope(invocation, 'Opportunity.advanceStage');
  if (invErr) return invErr;

  const stage =
    invocation.payload && invocation.payload.stage != null
      ? String(invocation.payload.stage).trim()
      : '';
  if (!stage) return reject('VALIDATION', 'invocation.payload.stage is required');

  const updated = [];
  for (const id of resolved.ids) {
    const view = await ensureEntityExists(db, id, 'Opportunity');
    if (!view) {
      return reject('ENTITY_NOT_FOUND', `Opportunity not found: ${id}`, { id });
    }
    if (view.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${id} is not Opportunity`, { typeName: view.view.typeName });
    }
    await om.setProperty(db, id, 'stage', stage);
    updated.push({ id, stage });
  }
  return okResult({ updated });
}

/**
 * Link Lead → Opportunity via existing relation `converts_to`.
 */
async function handleLinkLeadToOpportunity(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;

  const invErr = validateInvocationEnvelope(invocation, 'Lead.linkToOpportunity');
  if (invErr) return invErr;

  const payload = invocation.payload || {};
  const opportunityId =
    payload.opportunityId != null || payload.toId != null
      ? String(payload.opportunityId ?? payload.toId).trim()
      : '';
  if (!opportunityId) {
    return reject('VALIDATION', 'invocation.payload.opportunityId is required');
  }

  const opp = await ensureEntityExists(db, opportunityId, 'Opportunity');
  if (!opp) return reject('ENTITY_NOT_FOUND', `Opportunity not found: ${opportunityId}`);
  if (opp.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${opportunityId} is not Opportunity`, { typeName: opp.view.typeName });
  }

  const linked = [];
  for (const leadId of resolved.ids) {
    const lead = await ensureEntityExists(db, leadId, 'Lead');
    if (!lead) return reject('ENTITY_NOT_FOUND', `Lead not found: ${leadId}`);
    if (lead.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${leadId} is not Lead`, { typeName: lead.view.typeName });
    }
    await om.linkEntities(db, leadId, 'converts_to', opportunityId, {
      converted_on: new Date().toISOString().slice(0, 10),
    });
    linked.push({ fromId: leadId, relName: 'converts_to', toId: opportunityId });
  }
  return okResult({ linked });
}

// ── HR handlers ─────────────────────────────────────────────────────────────

async function handleCreateEmployee(db, input) {
  const label = input && input.label != null ? String(input.label).trim() : '';
  const email = input && input.email != null ? String(input.email).trim() : '';
  if (!label) return reject('VALIDATION', 'input.label is required');
  if (!email) return reject('VALIDATION', 'input.email is required');
  if (input.salary == null || Number.isNaN(Number(input.salary))) {
    return reject('VALIDATION', 'input.salary is required (number)');
  }

  const id =
    input.id != null && String(input.id).trim()
      ? String(input.id).trim()
      : `emp:${slugify(label)}-${shortId()}`;

  const salary = Number(input.salary);
  const performance_score =
    input.performance_score != null ? Number(input.performance_score) : undefined;

  await om.createEntity(db, id, 'Employee', label);
  await om.setProperty(db, id, 'email', email);
  await om.setProperty(db, id, 'salary', salary);
  if (performance_score !== undefined && !Number.isNaN(performance_score)) {
    await om.setProperty(db, id, 'performance_score', performance_score);
  }

  return okResult({
    id,
    typeName: 'Employee',
    label,
    properties: {
      email,
      salary,
      ...(performance_score !== undefined ? { performance_score } : {}),
    },
  });
}

async function handleSetReviewCycleStatus(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;

  const invErr = validateInvocationEnvelope(invocation, 'ReviewCycle.setStatus');
  if (invErr) return invErr;

  const status =
    invocation.payload && invocation.payload.status != null
      ? String(invocation.payload.status).trim()
      : '';
  if (!status) return reject('VALIDATION', 'invocation.payload.status is required');

  const updated = [];
  for (const id of resolved.ids) {
    const view = await ensureEntityExists(db, id, 'ReviewCycle');
    if (!view) return reject('ENTITY_NOT_FOUND', `ReviewCycle not found: ${id}`);
    if (view.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${id} is not ReviewCycle`, { typeName: view.view.typeName });
    }
    await om.setProperty(db, id, 'status', status);
    updated.push({ id, status });
  }
  return okResult({ updated });
}

// ── Procurement handlers ────────────────────────────────────────────────────

async function handleCreatePurchaseOrder(db, input) {
  const label = input && input.label != null ? String(input.label).trim() : '';
  if (!label) return reject('VALIDATION', 'input.label is required');
  if (input.total_amount == null || Number.isNaN(Number(input.total_amount))) {
    return reject('VALIDATION', 'input.total_amount is required (number)');
  }
  const status = input.status != null ? String(input.status).trim() : '';
  if (!status) return reject('VALIDATION', 'input.status is required');

  const id =
    input.id != null && String(input.id).trim()
      ? String(input.id).trim()
      : `po:${slugify(label)}-${shortId()}`;

  const total_amount = Number(input.total_amount);
  const order_date =
    input.order_date != null ? String(input.order_date) : new Date().toISOString().slice(0, 10);

  await om.createEntity(db, id, 'PurchaseOrder', label);
  await om.setProperty(db, id, 'total_amount', total_amount);
  await om.setProperty(db, id, 'status', status);
  await om.setProperty(db, id, 'order_date', order_date);

  return okResult({
    id,
    typeName: 'PurchaseOrder',
    label,
    properties: { total_amount, status, order_date },
  });
}

async function handleSetPurchaseOrderStatus(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;

  const invErr = validateInvocationEnvelope(invocation, 'PurchaseOrder.setStatus');
  if (invErr) return invErr;

  const status =
    invocation.payload && invocation.payload.status != null
      ? String(invocation.payload.status).trim()
      : '';
  if (!status) return reject('VALIDATION', 'invocation.payload.status is required');

  const updated = [];
  for (const id of resolved.ids) {
    const view = await ensureEntityExists(db, id, 'PurchaseOrder');
    if (!view) return reject('ENTITY_NOT_FOUND', `PurchaseOrder not found: ${id}`);
    if (view.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${id} is not PurchaseOrder`, { typeName: view.view.typeName });
    }
    await om.setProperty(db, id, 'status', status);
    updated.push({ id, status });
  }
  return okResult({ updated });
}

/**
 * Composite: create Opportunity + converts_to + belongs_to + has_opportunity
 * (+ optional for_product) and mark Lead converted — one addressed facade.
 */
async function handleConvertLead(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;
  if (resolved.ids.length !== 1) {
    return reject('VALIDATION', 'ConvertLead requires selector.kind=one');
  }

  const invErr = validateInvocationEnvelope(invocation, 'Lead.convert');
  if (invErr) return invErr;

  const leadId = resolved.ids[0];
  const payload = invocation.payload || {};
  const accountId = payload.accountId != null ? String(payload.accountId).trim() : '';
  if (!accountId) return reject('VALIDATION', 'invocation.payload.accountId is required');

  const lead = await ensureEntityExists(db, leadId, 'Lead');
  if (!lead) return reject('ENTITY_NOT_FOUND', `Lead not found: ${leadId}`, { id: leadId });
  if (lead.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${leadId} is not Lead`, { typeName: lead.view.typeName });
  }
  const account = await ensureEntityExists(db, accountId, 'Account');
  if (!account) return reject('ENTITY_NOT_FOUND', `Account not found: ${accountId}`);
  if (account.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${accountId} is not Account`, { typeName: account.view.typeName });
  }

  const oppLabel =
    payload.opportunityLabel != null && String(payload.opportunityLabel).trim()
      ? String(payload.opportunityLabel).trim()
      : `${lead.label || leadId} 商机`;
  const amount = payload.amount != null ? Number(payload.amount) : 0;
  if (Number.isNaN(amount)) return reject('VALIDATION', 'invocation.payload.amount must be a number');
  const stage = payload.stage != null && String(payload.stage).trim() ? String(payload.stage).trim() : 'qualify';
  const oppId =
    payload.opportunityId != null && String(payload.opportunityId).trim()
      ? String(payload.opportunityId).trim()
      : `opp:${slugify(oppLabel)}-${shortId()}`;

  await om.createEntity(db, oppId, 'Opportunity', oppLabel);
  await om.setProperty(db, oppId, 'amount', amount);
  await om.setProperty(db, oppId, 'stage', stage);
  await om.linkEntities(db, leadId, 'converts_to', oppId, { converted_on: todayIsoDate() });
  await om.linkEntities(db, leadId, 'belongs_to', accountId, {});
  await om.linkEntities(db, accountId, 'has_opportunity', oppId, {});
  const productId = payload.productId != null ? String(payload.productId).trim() : '';
  if (productId) {
    const product = await ensureEntityExists(db, productId, 'Product');
    if (!product) return reject('ENTITY_NOT_FOUND', `Product not found: ${productId}`);
    if (product.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${productId} is not Product`, { typeName: product.view.typeName });
    }
    await om.linkEntities(db, oppId, 'for_product', productId, {});
  }
  await om.setProperty(db, leadId, 'status', 'converted');

  return okResult({
    leadId,
    opportunityId: oppId,
    accountId,
    status: 'converted',
    linked: [
      { fromId: leadId, relName: 'converts_to', toId: oppId },
      { fromId: leadId, relName: 'belongs_to', toId: accountId },
      { fromId: accountId, relName: 'has_opportunity', toId: oppId },
      ...(productId ? [{ fromId: oppId, relName: 'for_product', toId: productId }] : []),
    ],
  });
}

async function handleAssignLead(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;
  const invErr = validateInvocationEnvelope(invocation, 'Lead.assign');
  if (invErr) return invErr;

  const payload = invocation.payload || {};
  const salesRepId = payload.salesRepId != null ? String(payload.salesRepId).trim() : '';
  if (!salesRepId) return reject('VALIDATION', 'invocation.payload.salesRepId is required');

  const rep = await ensureEntityExists(db, salesRepId, 'SalesRep');
  if (!rep) return reject('ENTITY_NOT_FOUND', `SalesRep not found: ${salesRepId}`);
  if (rep.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${salesRepId} is not SalesRep`, { typeName: rep.view.typeName });
  }

  const assigned = [];
  for (const leadId of resolved.ids) {
    const lead = await ensureEntityExists(db, leadId, 'Lead');
    if (!lead) return reject('ENTITY_NOT_FOUND', `Lead not found: ${leadId}`);
    if (lead.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${leadId} is not Lead`, { typeName: lead.view.typeName });
    }
    const unlinked = await unlinkOutgoing(db, leadId, 'assigned_to');
    await om.linkEntities(db, leadId, 'assigned_to', salesRepId, { assigned_on: todayIsoDate() });
    assigned.push({ leadId, salesRepId, unlinked });
  }
  return okResult({ assigned });
}

async function handleTransferEmployee(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;
  const invErr = validateInvocationEnvelope(invocation, 'Employee.transfer');
  if (invErr) return invErr;

  const payload = invocation.payload || {};
  const departmentId = payload.departmentId != null ? String(payload.departmentId).trim() : '';
  if (!departmentId) return reject('VALIDATION', 'invocation.payload.departmentId is required');

  const dept = await ensureEntityExists(db, departmentId, 'Department');
  if (!dept) return reject('ENTITY_NOT_FOUND', `Department not found: ${departmentId}`);
  if (dept.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${departmentId} is not Department`, { typeName: dept.view.typeName });
  }

  const transferred = [];
  for (const empId of resolved.ids) {
    const emp = await ensureEntityExists(db, empId, 'Employee');
    if (!emp) return reject('ENTITY_NOT_FOUND', `Employee not found: ${empId}`);
    if (emp.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${empId} is not Employee`, { typeName: emp.view.typeName });
    }
    const unlinked = await unlinkOutgoing(db, empId, 'works_in');
    await om.linkEntities(db, empId, 'works_in', departmentId, { since: todayIsoDate() });
    transferred.push({ employeeId: empId, departmentId, unlinked });
  }
  return okResult({ transferred });
}

async function handleAssignSkill(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;
  const invErr = validateInvocationEnvelope(invocation, 'Employee.assignSkill');
  if (invErr) return invErr;

  const payload = invocation.payload || {};
  const skillId = payload.skillId != null ? String(payload.skillId).trim() : '';
  if (!skillId) return reject('VALIDATION', 'invocation.payload.skillId is required');
  const proficiency = payload.proficiency != null ? String(payload.proficiency).trim() : 'intermediate';

  const skill = await ensureEntityExists(db, skillId, 'Skill');
  if (!skill) return reject('ENTITY_NOT_FOUND', `Skill not found: ${skillId}`);
  if (skill.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${skillId} is not Skill`, { typeName: skill.view.typeName });
  }

  const linked = [];
  for (const empId of resolved.ids) {
    const emp = await ensureEntityExists(db, empId, 'Employee');
    if (!emp) return reject('ENTITY_NOT_FOUND', `Employee not found: ${empId}`);
    if (emp.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${empId} is not Employee`, { typeName: emp.view.typeName });
    }
    await om.linkEntities(db, empId, 'has_skill', skillId, { proficiency });
    linked.push({ fromId: empId, relName: 'has_skill', toId: skillId, proficiency });
  }
  return okResult({ linked });
}

async function handlePlaceOrderWithSupplier(db, input) {
  const created = await handleCreatePurchaseOrder(db, input);
  if (!created.ok) return created;
  const supplierId = input && input.supplierId != null ? String(input.supplierId).trim() : '';
  if (!supplierId) return reject('VALIDATION', 'input.supplierId is required');
  const supplier = await ensureEntityExists(db, supplierId, 'Supplier');
  if (!supplier) return reject('ENTITY_NOT_FOUND', `Supplier not found: ${supplierId}`);
  if (supplier.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${supplierId} is not Supplier`, { typeName: supplier.view.typeName });
  }
  const poId = created.result.id;
  await om.linkEntities(db, poId, 'placed_with', supplierId, { buyer: input.buyer != null ? String(input.buyer) : '采购' });
  return okResult({
    ...created.result,
    supplierId,
    linked: [{ fromId: poId, relName: 'placed_with', toId: supplierId }],
  });
}

async function handleCoverOrderWithContract(db, selector, invocation) {
  const resolved = resolveSelectorIds(selector);
  if (resolved.error) return resolved.error;
  const invErr = validateInvocationEnvelope(invocation, 'PurchaseOrder.coverWithContract');
  if (invErr) return invErr;

  const payload = invocation.payload || {};
  const contractId = payload.contractId != null ? String(payload.contractId).trim() : '';
  if (!contractId) return reject('VALIDATION', 'invocation.payload.contractId is required');

  const contract = await ensureEntityExists(db, contractId, 'Contract');
  if (!contract) return reject('ENTITY_NOT_FOUND', `Contract not found: ${contractId}`);
  if (contract.mismatch) {
    return reject('TYPE_MISMATCH', `Entity ${contractId} is not Contract`, { typeName: contract.view.typeName });
  }

  const covered = [];
  for (const poId of resolved.ids) {
    const po = await ensureEntityExists(db, poId, 'PurchaseOrder');
    if (!po) return reject('ENTITY_NOT_FOUND', `PurchaseOrder not found: ${poId}`);
    if (po.mismatch) {
      return reject('TYPE_MISMATCH', `Entity ${poId} is not PurchaseOrder`, { typeName: po.view.typeName });
    }
    const unlinked = await unlinkOutgoing(db, poId, 'covered_by');
    await om.linkEntities(db, poId, 'covered_by', contractId, {
      clause: payload.clause != null ? String(payload.clause) : '主条款',
    });
    covered.push({ purchaseOrderId: poId, contractId, unlinked });
  }
  return okResult({ covered });
}

// ── Registry ────────────────────────────────────────────────────────────────

const OPERATIONS = {
  crm: [
    {
      id: 'crm-create-lead',
      fqn: 'ontology.crm.op.CreateLead',
      demoId: 'crm',
      label: '创建线索',
      description: 'Effect：无实例寻址，创建 Lead',
      entry: 'effect',
      ownerType: 'Lead',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'input → Lead entity' },
          { kind: 'om', primitive: 'setProperty', argsMapping: 'source/status/score' },
        ],
      },
      inputSchema: {
        type: 'object',
        required: ['label', 'source'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          source: { type: 'string' },
          status: { type: 'string' },
          score: { type: 'number' },
        },
      },
      sideEffectLevel: 'write',
      idempotency: { supported: true, scope: 'fqn+idempotencyKey' },
      examples: [
        {
          title: '最小创建',
          request: {
            fqn: 'ontology.crm.op.CreateLead',
            input: { label: 'Acme Inquiry', source: 'website' },
          },
        },
      ],
      handler: handleCreateLead,
    },
    {
      id: 'crm-create-opportunity',
      fqn: 'ontology.crm.op.CreateOpportunity',
      demoId: 'crm',
      label: '创建商机',
      description: 'Effect：创建 Opportunity（amount/stage）',
      entry: 'effect',
      ownerType: 'Opportunity',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'input → Opportunity' },
          { kind: 'om', primitive: 'setProperty', argsMapping: 'amount/stage/close_probability' },
        ],
      },
      inputSchema: {
        type: 'object',
        required: ['label', 'amount', 'stage'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          amount: { type: 'number' },
          stage: { type: 'string' },
          close_probability: { type: 'number' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '新建商机',
          request: {
            fqn: 'ontology.crm.op.CreateOpportunity',
            input: { label: 'New Deal', amount: 50000, stage: 'qualify' },
          },
        },
      ],
      handler: handleCreateOpportunity,
    },
    {
      id: 'crm-create-account',
      fqn: 'ontology.crm.op.CreateAccount',
      demoId: 'crm',
      label: '创建客户',
      description: 'Effect：创建 Account（industry）',
      entry: 'effect',
      ownerType: 'Account',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'input → Account' },
          { kind: 'om', primitive: 'setProperty', argsMapping: 'industry/tier/annual_revenue' },
        ],
      },
      inputSchema: {
        type: 'object',
        required: ['label', 'industry'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          industry: { type: 'string' },
          tier: { type: 'string' },
          annual_revenue: { type: 'number' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '新建客户',
          request: {
            fqn: 'ontology.crm.op.CreateAccount',
            input: { label: 'Contoso', industry: 'software' },
          },
        },
      ],
      handler: handleCreateAccount,
    },
    {
      id: 'crm-set-lead-status',
      fqn: 'ontology.crm.op.SetLeadStatus',
      demoId: 'crm',
      label: '设置线索状态',
      description: 'Addressed：对选中 Lead 设置 status',
      entry: 'addressed',
      ownerType: 'Lead',
      expectedInvocationType: 'Lead.setStatus',
      effectBinding: {
        kind: 'om',
        primitive: 'setProperty',
        argsMapping: 'invocation.payload.status → Lead.status',
      },
      selectorSchema: {
        type: 'object',
        description: 'Selector.kind one|ids；objectType=Lead',
      },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Lead.setStatus' },
          kind: { type: 'string' },
          payload: {
            type: 'object',
            required: ['status'],
            properties: { status: { type: 'string' } },
          },
          metadata: { type: 'object' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '设置状态',
          request: {
            fqn: 'ontology.crm.op.SetLeadStatus',
            selector: { kind: 'one', objectType: 'Lead', id: 'lead:web-ship' },
            invocation: {
              type: 'Lead.setStatus',
              kind: 'action',
              payload: { status: 'qualified' },
            },
          },
        },
      ],
      handler: handleSetLeadStatus,
    },
    {
      id: 'crm-advance-opp-stage',
      fqn: 'ontology.crm.op.AdvanceOpportunityStage',
      demoId: 'crm',
      label: '推进商机阶段',
      description: 'Addressed：对选中 Opportunity 推进 stage（invocation 信封）',
      entry: 'addressed',
      ownerType: 'Opportunity',
      expectedInvocationType: 'Opportunity.advanceStage',
      effectBinding: {
        kind: 'om',
        primitive: 'setProperty',
        argsMapping: 'invocation.payload.stage → Opportunity.stage',
      },
      selectorSchema: {
        type: 'object',
        description: 'Selector.kind one|ids；objectType=Opportunity',
      },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Opportunity.advanceStage' },
          kind: { type: 'string' },
          payload: {
            type: 'object',
            required: ['stage'],
            properties: { stage: { type: 'string' } },
          },
          metadata: { type: 'object' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '单条推进',
          request: {
            fqn: 'ontology.crm.op.AdvanceOpportunityStage',
            selector: { kind: 'one', objectType: 'Opportunity', id: 'opp:acme-renew' },
            invocation: {
              type: 'Opportunity.advanceStage',
              kind: 'action',
              payload: { stage: 'negotiation' },
            },
          },
        },
      ],
      handler: handleAdvanceOpportunityStage,
    },
    {
      id: 'crm-link-lead-opp',
      fqn: 'ontology.crm.op.LinkLeadToOpportunity',
      demoId: 'crm',
      label: '关联线索到商机',
      description:
        'Addressed：Lead→Opportunity via converts_to (no Lead→Account relation in demo-crm; replaces contract LinkLeadToAccount example)',
      entry: 'addressed',
      ownerType: 'Lead',
      expectedInvocationType: 'Lead.linkToOpportunity',
      effectBinding: {
        kind: 'om',
        primitive: 'linkEntities',
        argsMapping: 'selector → Lead; invocation.payload.opportunityId → Opportunity; rel=converts_to',
      },
      selectorSchema: {
        type: 'object',
        description: '选中 Lead（one 或 ids）',
      },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Lead.linkToOpportunity' },
          kind: { type: 'string' },
          payload: {
            type: 'object',
            required: ['opportunityId'],
            properties: {
              opportunityId: { type: 'string' },
              relationName: { type: 'string', default: 'converts_to' },
            },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: 'Lead → Opportunity',
          request: {
            fqn: 'ontology.crm.op.LinkLeadToOpportunity',
            selector: { kind: 'one', objectType: 'Lead', id: 'lead:expo-mfg' },
            invocation: {
              type: 'Lead.linkToOpportunity',
              kind: 'action',
              payload: { opportunityId: 'opp:globex-new' },
            },
          },
        },
      ],
      handler: handleLinkLeadToOpportunity,
    },
    {
      id: 'crm-convert-lead',
      fqn: 'ontology.crm.op.ConvertLead',
      demoId: 'crm',
      label: '转化线索',
      description: 'Addressed 复合：创建商机并一次挂 converts_to / belongs_to / has_opportunity，线索标 converted',
      entry: 'addressed',
      ownerType: 'Lead',
      expectedInvocationType: 'Lead.convert',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'payload → Opportunity' },
          { kind: 'om', primitive: 'linkEntities', argsMapping: 'converts_to / belongs_to / has_opportunity' },
          { kind: 'om', primitive: 'setProperty', argsMapping: 'Lead.status=converted' },
        ],
      },
      selectorSchema: { type: 'object', description: '选中一条 Lead（kind=one）' },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Lead.convert' },
          kind: { type: 'string' },
          payload: {
            type: 'object',
            required: ['accountId'],
            properties: {
              accountId: { type: 'string' },
              amount: { type: 'number' },
              stage: { type: 'string' },
              opportunityLabel: { type: 'string' },
              opportunityId: { type: 'string' },
              productId: { type: 'string' },
            },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '转化线索为商机',
          request: {
            fqn: 'ontology.crm.op.ConvertLead',
            selector: { kind: 'one', objectType: 'Lead', id: 'lead:web-ship' },
            invocation: {
              type: 'Lead.convert',
              kind: 'action',
              payload: { accountId: 'acct:acme', amount: 42000, stage: 'qualify' },
            },
          },
        },
      ],
      handler: handleConvertLead,
    },
    {
      id: 'crm-assign-lead',
      fqn: 'ontology.crm.op.AssignLead',
      demoId: 'crm',
      label: '分配线索',
      description: 'Addressed：卸旧 assigned_to 边，再挂到新 SalesRep',
      entry: 'addressed',
      ownerType: 'Lead',
      expectedInvocationType: 'Lead.assign',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'unlinkEntities', argsMapping: 'outgoing assigned_to' },
          { kind: 'om', primitive: 'linkEntities', argsMapping: 'Lead → SalesRep assigned_to' },
        ],
      },
      selectorSchema: { type: 'object', description: '选中 Lead（one 或 ids）' },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Lead.assign' },
          payload: {
            type: 'object',
            required: ['salesRepId'],
            properties: { salesRepId: { type: 'string' } },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '分配给李雷',
          request: {
            fqn: 'ontology.crm.op.AssignLead',
            selector: { kind: 'one', objectType: 'Lead', id: 'lead:web-ship' },
            invocation: { type: 'Lead.assign', kind: 'action', payload: { salesRepId: 'rep:li' } },
          },
        },
      ],
      handler: handleAssignLead,
    },
  ],
  hr: [
    {
      id: 'hr-create-employee',
      fqn: 'ontology.hr.op.CreateEmployee',
      demoId: 'hr',
      label: '创建员工',
      description: 'Effect：创建 Employee（email/salary）',
      entry: 'effect',
      ownerType: 'Employee',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'input → Employee' },
          { kind: 'om', primitive: 'setProperty', argsMapping: 'email/salary/performance_score' },
        ],
      },
      inputSchema: {
        type: 'object',
        required: ['label', 'email', 'salary'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          email: { type: 'string' },
          salary: { type: 'number' },
          performance_score: { type: 'number' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '新建员工',
          request: {
            fqn: 'ontology.hr.op.CreateEmployee',
            input: { label: '张三', email: 'zhang@example.com', salary: 120000 },
          },
        },
      ],
      handler: handleCreateEmployee,
    },
    {
      id: 'hr-set-review-status',
      fqn: 'ontology.hr.op.SetReviewCycleStatus',
      demoId: 'hr',
      label: '设置考核周期状态',
      description: 'Addressed：对选中 ReviewCycle 设置 status',
      entry: 'addressed',
      ownerType: 'ReviewCycle',
      expectedInvocationType: 'ReviewCycle.setStatus',
      effectBinding: {
        kind: 'om',
        primitive: 'setProperty',
        argsMapping: 'invocation.payload.status → ReviewCycle.status',
      },
      selectorSchema: {
        type: 'object',
        description: 'Selector.kind one|ids；objectType=ReviewCycle',
      },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'ReviewCycle.setStatus' },
          kind: { type: 'string' },
          payload: {
            type: 'object',
            required: ['status'],
            properties: { status: { type: 'string' } },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '设置状态',
          request: {
            fqn: 'ontology.hr.op.SetReviewCycleStatus',
            selector: { kind: 'one', objectType: 'ReviewCycle', id: 'cycle:2026-h1' },
            invocation: {
              type: 'ReviewCycle.setStatus',
              kind: 'action',
              payload: { status: 'active' },
            },
          },
        },
      ],
      handler: handleSetReviewCycleStatus,
    },
    {
      id: 'hr-transfer-employee',
      fqn: 'ontology.hr.op.TransferEmployee',
      demoId: 'hr',
      label: '调动员工部门',
      description: 'Addressed 复合：RETRACT 旧 works_in，再挂新部门（边属性 since）',
      entry: 'addressed',
      ownerType: 'Employee',
      expectedInvocationType: 'Employee.transfer',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'unlinkEntities', argsMapping: 'outgoing works_in' },
          { kind: 'om', primitive: 'linkEntities', argsMapping: 'Employee → Department works_in' },
        ],
      },
      selectorSchema: { type: 'object', description: '选中 Employee' },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Employee.transfer' },
          payload: {
            type: 'object',
            required: ['departmentId'],
            properties: { departmentId: { type: 'string' } },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '调入产品部',
          request: {
            fqn: 'ontology.hr.op.TransferEmployee',
            selector: { kind: 'one', objectType: 'Employee', id: 'emp:frank' },
            invocation: { type: 'Employee.transfer', kind: 'action', payload: { departmentId: 'dept:product' } },
          },
        },
      ],
      handler: handleTransferEmployee,
    },
    {
      id: 'hr-assign-skill',
      fqn: 'ontology.hr.op.AssignSkill',
      demoId: 'hr',
      label: '分配技能',
      description: 'Addressed：Employee —has_skill→ Skill（边属性 proficiency）',
      entry: 'addressed',
      ownerType: 'Employee',
      expectedInvocationType: 'Employee.assignSkill',
      effectBinding: {
        kind: 'om',
        primitive: 'linkEntities',
        argsMapping: 'selector → Employee; payload.skillId → Skill; rel=has_skill',
      },
      selectorSchema: { type: 'object', description: '选中 Employee' },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'Employee.assignSkill' },
          payload: {
            type: 'object',
            required: ['skillId'],
            properties: {
              skillId: { type: 'string' },
              proficiency: { type: 'string' },
            },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '掌握系统设计',
          request: {
            fqn: 'ontology.hr.op.AssignSkill',
            selector: { kind: 'one', objectType: 'Employee', id: 'emp:dave' },
            invocation: {
              type: 'Employee.assignSkill',
              kind: 'action',
              payload: { skillId: 'sk:sys', proficiency: 'intermediate' },
            },
          },
        },
      ],
      handler: handleAssignSkill,
    },
  ],
  procurement: [
    {
      id: 'proc-create-po',
      fqn: 'ontology.procurement.op.CreatePurchaseOrder',
      demoId: 'procurement',
      label: '创建采购单',
      description: 'Effect：创建 PurchaseOrder（total_amount/status）',
      entry: 'effect',
      ownerType: 'PurchaseOrder',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'input → PurchaseOrder' },
          { kind: 'om', primitive: 'setProperty', argsMapping: 'total_amount/status/order_date' },
        ],
      },
      inputSchema: {
        type: 'object',
        required: ['label', 'total_amount', 'status'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          total_amount: { type: 'number' },
          status: { type: 'string' },
          order_date: { type: 'string' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '新建采购单',
          request: {
            fqn: 'ontology.procurement.op.CreatePurchaseOrder',
            input: { label: 'Q3 Parts', total_amount: 18000, status: 'draft' },
          },
        },
      ],
      handler: handleCreatePurchaseOrder,
    },
    {
      id: 'proc-set-po-status',
      fqn: 'ontology.procurement.op.SetPurchaseOrderStatus',
      demoId: 'procurement',
      label: '设置采购单状态',
      description: 'Addressed：对选中 PurchaseOrder 设置 status',
      entry: 'addressed',
      ownerType: 'PurchaseOrder',
      expectedInvocationType: 'PurchaseOrder.setStatus',
      effectBinding: {
        kind: 'om',
        primitive: 'setProperty',
        argsMapping: 'invocation.payload.status → PurchaseOrder.status',
      },
      selectorSchema: {
        type: 'object',
        description: 'Selector.kind one|ids；objectType=PurchaseOrder',
      },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'PurchaseOrder.setStatus' },
          kind: { type: 'string' },
          payload: {
            type: 'object',
            required: ['status'],
            properties: { status: { type: 'string' } },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '设置状态',
          request: {
            fqn: 'ontology.procurement.op.SetPurchaseOrderStatus',
            selector: { kind: 'one', objectType: 'PurchaseOrder', id: 'po:1001' },
            invocation: {
              type: 'PurchaseOrder.setStatus',
              kind: 'action',
              payload: { status: 'approved' },
            },
          },
        },
      ],
      handler: handleSetPurchaseOrderStatus,
    },
    {
      id: 'proc-place-order-supplier',
      fqn: 'ontology.procurement.op.PlaceOrderWithSupplier',
      demoId: 'procurement',
      label: '向供应商下单',
      description: 'Effect 复合：创建采购单并挂 placed_with',
      entry: 'effect',
      ownerType: 'PurchaseOrder',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'createEntity', argsMapping: 'input → PurchaseOrder' },
          { kind: 'om', primitive: 'linkEntities', argsMapping: 'placed_with supplierId' },
        ],
      },
      inputSchema: {
        type: 'object',
        required: ['label', 'total_amount', 'status', 'supplierId'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          total_amount: { type: 'number' },
          status: { type: 'string' },
          order_date: { type: 'string' },
          supplierId: { type: 'string' },
          buyer: { type: 'string' },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '向先达下单',
          request: {
            fqn: 'ontology.procurement.op.PlaceOrderWithSupplier',
            input: { label: 'Q4 钢材', total_amount: 22000, status: 'draft', supplierId: 's:acme' },
          },
        },
      ],
      handler: handlePlaceOrderWithSupplier,
    },
    {
      id: 'proc-cover-order-contract',
      fqn: 'ontology.procurement.op.CoverOrderWithContract',
      demoId: 'procurement',
      label: '合同覆盖订单',
      description: 'Addressed 复合：卸旧 covered_by，再挂新合同',
      entry: 'addressed',
      ownerType: 'PurchaseOrder',
      expectedInvocationType: 'PurchaseOrder.coverWithContract',
      effectBinding: {
        kind: 'composite',
        steps: [
          { kind: 'om', primitive: 'unlinkEntities', argsMapping: 'outgoing covered_by' },
          { kind: 'om', primitive: 'linkEntities', argsMapping: 'PO → Contract covered_by' },
        ],
      },
      selectorSchema: { type: 'object', description: '选中 PurchaseOrder' },
      invocationSchema: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type: { const: 'PurchaseOrder.coverWithContract' },
          payload: {
            type: 'object',
            required: ['contractId'],
            properties: {
              contractId: { type: 'string' },
              clause: { type: 'string' },
            },
          },
        },
      },
      sideEffectLevel: 'write',
      examples: [
        {
          title: '用主协议覆盖 PO-1002',
          request: {
            fqn: 'ontology.procurement.op.CoverOrderWithContract',
            selector: { kind: 'one', objectType: 'PurchaseOrder', id: 'po:1002' },
            invocation: {
              type: 'PurchaseOrder.coverWithContract',
              kind: 'action',
              payload: { contractId: 'ct:master' },
            },
          },
        },
      ],
      handler: handleCoverOrderWithContract,
    },
  ],
};

function summarizeOperation(op) {
  const entry = normalizeEntry(op);
  const summary = {
    id: op.id,
    fqn: op.fqn,
    demoId: op.demoId,
    label: op.label,
    description: op.description,
    entry,
    ownerType: op.ownerType,
    sideEffectLevel: op.sideEffectLevel,
    effectBinding: op.effectBinding,
  };
  if (op.expectedInvocationType) summary.expectedInvocationType = op.expectedInvocationType;
  if (op.inputSchema) summary.inputSchema = op.inputSchema;
  if (op.selectorSchema) summary.selectorSchema = op.selectorSchema;
  if (op.invocationSchema) summary.invocationSchema = op.invocationSchema;
  if (op.idempotency) summary.idempotency = op.idempotency;
  if (op.examples) summary.examples = op.examples;
  return summary;
}

function listOperations(demoId) {
  resolveDemo(demoId);
  const ops = OPERATIONS[demoId] || [];
  return ops.map((op) => ({
    id: op.id,
    fqn: op.fqn,
    label: op.label,
    description: op.description,
    entry: normalizeEntry(op),
    ownerType: op.ownerType,
    sideEffectLevel: op.sideEffectLevel,
  }));
}

function getOperation(demoId, fqnOrId) {
  resolveDemo(demoId);
  const raw = decodeURIComponent(String(fqnOrId || ''));
  const ops = OPERATIONS[demoId] || [];
  const op = ops.find((o) => o.fqn === raw || o.id === raw);
  if (!op) {
    const err = new Error(`Unknown operation: ${raw}`);
    err.status = 404;
    throw err;
  }
  return summarizeOperation(op);
}

function findOperation(demoId, fqnOrId) {
  const raw = String(fqnOrId || '');
  const ops = OPERATIONS[demoId] || [];
  return ops.find((o) => o.fqn === raw || o.id === raw) || null;
}

function findOperationByFqnGlobal(fqnOrId) {
  const raw = String(fqnOrId || '');
  for (const ops of Object.values(OPERATIONS)) {
    const hit = ops.find((o) => o.fqn === raw || o.id === raw);
    if (hit) return hit;
  }
  return null;
}

/** Map optional client echo of old formula / new entry into canonical entry */
function clientEntryEcho(body) {
  if (body.entry === 'effect' || body.entry === 'addressed') return body.entry;
  if (body.formula === 'input') return 'effect';
  if (body.formula === 'selector') return 'addressed';
  if (body.entry != null) return body.entry;
  if (body.formula != null) return body.formula;
  return null;
}

function buildDispatchHandlerMap() {
  /** @type {Map<string, (dispatchInput: any) => Promise<any>>} */
  const handlerMap = new Map();

  for (const ops of Object.values(OPERATIONS)) {
    for (const op of ops) {
      const run = async (dispatchInput) => {
        const runtime = (dispatchInput && dispatchInput.runtime) || {};
        const db = runtime.db;
        const entry = normalizeEntry(op);
        try {
          if (entry === 'effect') {
            return await op.handler(db, dispatchInput.input, dispatchInput.config);
          }
          if (entry === 'addressed') {
            return await op.handler(
              db,
              dispatchInput.selector,
              dispatchInput.invocation,
              dispatchInput.config,
            );
          }
          return errorResult('INTERNAL', `Unsupported entry: ${entry}`);
        } catch (err) {
          const message = err.display || err.message || String(err);
          return errorResult('RUNTIME', message);
        }
      };
      handlerMap.set(op.fqn, run);
      // Also allow stable internal id as route key
      if (op.id && !handlerMap.has(op.id)) {
        handlerMap.set(op.id, run);
      }
    }
  }

  return handlerMap;
}

const invokeDispatchEngine = new DispatchEngine();
invokeDispatchEngine.registerStrategy(
  DispatchStrategyConfig.forRouteKeyStrategy({
    handlerMap: buildDispatchHandlerMap(),
  }),
);

async function invokeOperation(demoId, request) {
  try {
    resolveDemo(demoId);
  } catch (err) {
    return errorResult('UNKNOWN_DEMO', err.message || String(err));
  }

  const body = request && typeof request === 'object' ? request : {};
  const fqnOrId = body.fqn || body.operationId;
  if (!fqnOrId) {
    return reject('VALIDATION', 'fqn (or operationId) is required');
  }

  const op = findOperation(demoId, fqnOrId);
  // Meta validation when known; unknown FQN still goes through DispatchEngine → notHandled
  if (op) {
    const entry = normalizeEntry(op);
    const echo = clientEntryEcho(body);
    if (echo != null && echo !== entry) {
      return reject('ENTRY_MISMATCH', `Operation entry is '${entry}', got '${echo}'`, {
        expected: entry,
        got: echo,
      });
    }

    if (entry === 'effect') {
      if (body.selector != null || body.invocation != null) {
        return reject(
          'ENTRY_MISMATCH',
          'effect-entry operations must not include selector or invocation',
        );
      }
      if (body.input == null || typeof body.input !== 'object' || Array.isArray(body.input)) {
        return reject('VALIDATION', 'input object is required for effect-entry operations');
      }
    } else if (entry === 'addressed') {
      if (!body.selector) {
        return reject('VALIDATION', 'selector is required for addressed-entry operations');
      }
      if (body.invocation == null) {
        return reject('VALIDATION', 'invocation envelope is required for addressed-entry operations');
      }
      const invErr = validateInvocationEnvelope(body.invocation, op.expectedInvocationType || null);
      if (invErr) return invErr;
    }
  }

  const { db } = await getWorkshopDb(demoId);
  const routeKey = op ? op.fqn : String(fqnOrId);
  const dispatchInput = {
    demoId,
    runtime: { db, demoId, om },
    input: body.input,
    selector: body.selector,
    invocation: body.invocation,
    config: body.config,
    body,
    op: op || undefined,
  };

  const dispatchResult = await invokeDispatchEngine.dispatch(
    createRouteKeyDispatchRequest(routeKey, dispatchInput, true),
  );

  if (!dispatchResult.isHandled()) {
    return reject('UNKNOWN_OPERATION', `Unknown operation: ${fqnOrId}`, { fqn: fqnOrId });
  }

  return dispatchResult.getResult();
}

module.exports = {
  listOperations,
  getOperation,
  invokeOperation,
  OPERATIONS,
  normalizeEntry,
  validateInvocationEnvelope,
  invokeDispatchEngine,
};
