'use strict';

/**
 * Metadata-driven mutations shared by composite OntologyOperations.
 *
 * These are declared once and executed through om.executeMutations, so a composite
 * operation's multi-step association write lands in a single transaction instead of
 * N independent ones. They live in their own module because both workshop.js (which
 * must register them whenever a demo DB is seeded or evolved) and operations.js
 * (which plans the swap and invokes them) need them — importing across those two
 * directly would be circular.
 */

const { om } = require('depa-ontology');

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** True when the type is defined in this database. */
/**
 * True when the type is defined in this database.
 *
 * Takes an om runtime (the registration path) and runs through its runner, not the
 * runtime object itself — a runtime intentionally has no `.run`.
 */
async function typeExists(runtime, typeName) {
  try {
    const runner = runtime.runner;
    const rows = await runner.run(
      '?[name] := *om_type{name}, name = $name',
      { name: typeName }
    );
    return rows.rows.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * "换 owner" as one declared mutation: retract the old targets, then link the new one.
 * The unlink/link shape comes from the relation's declared cardinality (see
 * om.deriveRelationSwap), not from hand-written per-relation logic.
 */
async function swapOwnerRelation(ctx, params) {
  await om.applyRelationSwap(ctx.runtime, params);
}

/**
 * Convert a lead: create the Opportunity, wire converts_to / belongs_to /
 * has_opportunity (and optional for_product), then mark the lead converted.
 *
 * has_opportunity is written explicitly: its `from` is the account, not the addressed
 * lead, so the single-entity ctx.linkEntities binding cannot express it. Writing through
 * ctx.runtime keeps it inside the same transaction.
 */
async function createAndLinkOpportunity(ctx, params) {
  const p = params || {};
  await om.createEntity(ctx.runtime, p.opportunityId, 'Opportunity', p.opportunityLabel);
  await om.setProperty(ctx.runtime, p.opportunityId, 'amount', p.amount);
  await om.setProperty(ctx.runtime, p.opportunityId, 'stage', p.stage);
  await om.linkEntities(ctx.runtime, p.leadId, 'converts_to', p.opportunityId, {
    converted_on: todayIsoDate(),
  });
  await om.linkEntities(ctx.runtime, p.leadId, 'belongs_to', p.accountId, {});
  await om.linkEntities(ctx.runtime, p.accountId, 'has_opportunity', p.opportunityId, {});
  if (p.productId) {
    await om.linkEntities(ctx.runtime, p.opportunityId, 'for_product', p.productId, {});
  }
  await om.setProperty(ctx.runtime, p.leadId, 'status', 'converted');
}

const SWAP_OWNER_TYPES = ['Lead', 'Employee', 'PurchaseOrder'];

/**
 * Register the composite-operation mutations for a demo DB (idempotent).
 *
 * Declaration and callback are separate calls now: `define*` persists the definition,
 * `register*` attaches the runtime callback. Only types that exist in this demo are
 * registered — a CRM database has no Employee, and defineMutation throws on an unknown
 * type, which would break every invoke in that demo.
 */
async function registerModelDrivenMutations(runtime) {
  for (const typeName of SWAP_OWNER_TYPES) {
    if (!(await typeExists(runtime, typeName))) continue;
    await om.defineMutation(runtime, typeName, 'swapOwnerRelation', '按声明的基数换 owner');
    om.registerMutation(runtime, typeName, 'swapOwnerRelation', swapOwnerRelation);
  }
  if (await typeExists(runtime, 'Lead')) {
    await om.defineMutation(
      runtime,
      'Lead',
      'createAndLinkOpportunity',
      '转化线索：建商机 + 多条边 + 改状态（单事务）'
    );
    om.registerMutation(runtime, 'Lead', 'createAndLinkOpportunity', createAndLinkOpportunity);
  }
}

module.exports = {
  registerModelDrivenMutations,
  swapOwnerRelation,
  createAndLinkOpportunity,
  SWAP_OWNER_TYPES,
};
