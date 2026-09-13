'use strict';

/**
 * Ontology Workshop helpers — seed demo DBs and wrap om find/view/neighbor APIs.
 * Projection via om.exportOntologyProjection from depa-ontology.
 *
 * Persistence (working default):
 * - WORKSHOP_DATA_DIR (default: packages/example-server/.data/workshop)
 * - WORKSHOP_PERSIST=0 forces in-memory
 * - createApp({ workshop: { persist, dataDir, engine } }) overrides env for process
 * - Per demo file: {demoId}.db via Cozo sqlite engine (preferred)
 */

const fs = require('fs');
const path = require('path');
const { CozoDb, om } = require('depa-ontology');
const { demoMap, allDemos } = require('./demos');
const { parseSheetsIntoBatch } = require('./helpers');
const { registerModelDrivenMutations } = require('./model-driven-mutations');

const TABLE_NAMES = {
  types: '类型定义',
  attributes: '属性定义',
  relations: '关系定义',
  entities: '实体数据',
  properties: '属性数据',
  edges: '边数据',
};

const workshopDbCache = new Map();

/** @type {{ persist?: boolean, dataDir?: string, engine?: string }} */
let workshopConfig = {};

function configureWorkshop(opts) {
  workshopConfig = opts && typeof opts === 'object' ? { ...opts } : {};
}

function resetWorkshopConfig() {
  workshopConfig = {};
}

function parseBool(value, defaultValue = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return defaultValue;
  const t = value.trim().toLowerCase();
  if (t === 'true' || t === '1' || t === 'yes' || t === 'y') return true;
  if (t === 'false' || t === '0' || t === 'no' || t === 'n') return false;
  return defaultValue;
}

function envPersistDefault() {
  if (process.env.WORKSHOP_PERSIST != null && String(process.env.WORKSHOP_PERSIST).trim() !== '') {
    return parseBool(process.env.WORKSHOP_PERSIST, true);
  }
  // Production default: persist. Tests should set WORKSHOP_PERSIST=0 or pass workshop.persist=false.
  return true;
}

function resolveWorkshopSettings() {
  const persist =
    workshopConfig.persist != null ? !!workshopConfig.persist : envPersistDefault();
  const dataDir =
    workshopConfig.dataDir ||
    process.env.WORKSHOP_DATA_DIR ||
    path.join(__dirname, '..', '.data', 'workshop');
  const engine = workshopConfig.engine || process.env.WORKSHOP_DB_ENGINE || 'sqlite';
  return { persist, dataDir, engine };
}

function ensureTableShape(table) {
  return table && typeof table === 'object'
    ? { columns: Array.isArray(table.columns) ? table.columns : [], rows: Array.isArray(table.rows) ? table.rows : [] }
    : { columns: [], rows: [] };
}

function tableMapFromTables(tables) {
  const map = Object.create(null);
  for (const t of Array.isArray(tables) ? tables : []) {
    if (!t || typeof t !== 'object') continue;
    map[t.name] = t;
  }
  return map;
}

function buildAttrSchema(tableMap) {
  const attrTable = ensureTableShape(tableMap[TABLE_NAMES.attributes]);
  const cols = attrTable.columns;
  const schema = new Map();
  for (const row of attrTable.rows) {
    const obj = Array.isArray(row)
      ? Object.fromEntries(cols.map((c, i) => [c, row[i]]))
      : row;
    if (!obj || !obj.attrName) continue;
    const key = String(obj.attrName).trim();
    const valueType = String(obj.valueType ?? '').trim();
    if (!key) continue;
    schema.set(key, { valueType });
  }
  return schema;
}

async function defineOntologyFromTables(db, tableMap) {
  const typeTable = ensureTableShape(tableMap[TABLE_NAMES.types]);
  const attrTable = ensureTableShape(tableMap[TABLE_NAMES.attributes]);
  const relTable = ensureTableShape(tableMap[TABLE_NAMES.relations]);

  await om.initSchema(db);

  const typeRowObjects = typeTable.rows
    .map((row) => Array.isArray(row)
      ? Object.fromEntries(typeTable.columns.map((c, i) => [c, row[i]]))
      : row)
    .filter((obj) => obj && typeof obj === 'object');

  const mixinNames = new Set();
  for (const obj of typeRowObjects) {
    if (!obj.mixins) continue;
    for (const m of String(obj.mixins).split(',').map((s) => s.trim()).filter(Boolean)) {
      mixinNames.add(m);
    }
  }

  for (const mixinName of mixinNames) {
    const row = typeRowObjects.find((r) => String(r.typeName ?? '').trim() === mixinName);
    const description = row ? String(row.description ?? '') : '';
    await om.defineMixin(db, mixinName, description);
  }

  for (const obj of typeRowObjects) {
    if (!obj || !obj.typeName) continue;
    const parentType = obj.parent_type ? String(obj.parent_type).trim() : undefined;
    const opts = {};
    if (parentType) opts.parentType = parentType;
    if (obj.mixins) {
      const list = String(obj.mixins).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) opts.mixins = list;
    }
    await om.defineType(db, String(obj.typeName), String(obj.description ?? ''), opts);
  }

  for (const row of attrTable.rows) {
    const obj = Array.isArray(row)
      ? Object.fromEntries(attrTable.columns.map((c, i) => [c, row[i]]))
      : row;
    if (!obj || !obj.typeName || !obj.attrName || !obj.valueType) continue;
    await om.defineAttribute(
      db,
      String(obj.typeName),
      String(obj.attrName),
      String(obj.valueType),
      parseBool(obj.required, false),
      obj.description != null ? String(obj.description) : undefined
    );
  }

  for (const row of relTable.rows) {
    const obj = Array.isArray(row)
      ? Object.fromEntries(relTable.columns.map((c, i) => [c, row[i]]))
      : row;
    if (!obj || !obj.relName || !obj.fromType || !obj.toType) continue;
    await om.defineRelation(
      db,
      String(obj.relName),
      String(obj.fromType),
      String(obj.toType),
      parseBool(obj.directed, true),
      obj.description != null ? String(obj.description) : undefined
    );
  }
}

function resolveDemo(demoId) {
  const demo = demoMap[demoId];
  if (!demo) {
    const err = new Error(`Unknown demo: ${demoId}`);
    err.status = 404;
    throw err;
  }
  return demo;
}

function sheetsFromDemo(demo) {
  if (demo.defaultSheets && typeof demo.defaultSheets === 'object') {
    return {
      entities: ensureTableShape(demo.defaultSheets.entities),
      properties: ensureTableShape(demo.defaultSheets.properties),
      edges: ensureTableShape(demo.defaultSheets.edges),
    };
  }
  const tableMap = tableMapFromTables(demo.defaultTables);
  return {
    entities: ensureTableShape(tableMap[TABLE_NAMES.entities]),
    properties: ensureTableShape(tableMap[TABLE_NAMES.properties]),
    edges: ensureTableShape(tableMap[TABLE_NAMES.edges]),
  };
}

async function dbHasOntologySchema(db) {
  try {
    const r = await db.run('?[name] := *om_type{name}');
    return Array.isArray(r && r.rows) && r.rows.length > 0;
  } catch (_) {
    return false;
  }
}

function demoDbPath(dataDir, demoId, engine) {
  const ext = engine === 'rocksdb' ? '' : '.db';
  return path.join(dataDir, `${demoId}${ext}`);
}

function openCozoDb(engine, databasePath) {
  try {
    return new CozoDb(engine, databasePath, {});
  } catch (err) {
    if (engine === 'sqlite') {
      try {
        const rocksPath = databasePath.endsWith('.db')
          ? databasePath.slice(0, -3)
          : databasePath;
        return new CozoDb('rocksdb', rocksPath, {});
      } catch (_) {
        throw err;
      }
    }
    throw err;
  }
}

async function seedWorkshopDb(demo, existingDb) {
  const db = existingDb || new CozoDb('mem', '', {});
  // Each demo gets its own runtime: the registry is a runtime-scoped resource, so two
  // demos in one process no longer share (and overwrite) each other's behaviors.
  const runtime = om.createOmRuntime(db);
  om.clearRegistry(runtime);

  if (typeof demo.defineOntology === 'function') {
    await demo.defineOntology(db);
  } else {
    const tableMap = tableMapFromTables(demo.defaultTables);
    await defineOntologyFromTables(db, tableMap);
  }

  const tableMap = tableMapFromTables(demo.defaultTables || []);
  const attrSchema = buildAttrSchema(tableMap);
  const dataSheets = sheetsFromDemo(demo);
  const batch = parseSheetsIntoBatch(dataSheets, attrSchema);
  await om.ingestBatch(runtime, batch);

  if (typeof demo.registerBehaviors === 'function') {
    await demo.registerBehaviors(runtime);
  }

  await registerModelDrivenMutations(runtime);

  return { db, runtime };
}

/**
 * Evolve an already-seeded persist DB: re-define ontology (upsert), then
 * create missing seed entities / fill missing properties / link missing edges.
 * Does not overwrite existing property values.
 */
async function evolveWorkshopDb(demo, db) {
  const runtime = om.createOmRuntime(db);
  om.clearRegistry(runtime);

  if (typeof demo.defineOntology === 'function') {
    await demo.defineOntology(db);
  } else {
    const tableMap = tableMapFromTables(demo.defaultTables);
    await defineOntologyFromTables(db, tableMap);
  }

  const tableMap = tableMapFromTables(demo.defaultTables || []);
  const attrSchema = buildAttrSchema(tableMap);
  const dataSheets = sheetsFromDemo(demo);
  const batch = parseSheetsIntoBatch(dataSheets, attrSchema);

  for (const entity of batch.entities || []) {
    if (!entity || !entity.id) continue;
    const view = await om.getEntityView(runtime, entity.id);
    if (!view) {
      await om.createEntity(runtime, entity.id, entity.typeName, entity.label);
    }
  }

  for (const prop of batch.properties || []) {
    if (!prop || !prop.entityId || !prop.attrName) continue;
    const view = await om.getEntityView(runtime, prop.entityId);
    if (!view) continue;
    const existing = view.properties || {};
    if (existing[prop.attrName] === undefined) {
      await om.setProperty(runtime, prop.entityId, prop.attrName, prop.value);
    }
  }

  for (const edge of batch.edges || []) {
    if (!edge || !edge.fromId || !edge.relName || !edge.toId) continue;
    const neighbors = await om.getNeighbors(db, edge.fromId, edge.relName, 'outgoing');
    const outgoing = (neighbors && neighbors.outgoing) || [];
    const already = outgoing.some((n) => n.entityId === edge.toId);
    if (!already) {
      await om.linkEntities(runtime, edge.fromId, edge.relName, edge.toId, edge.props || {});
    }
  }

  if (typeof demo.registerBehaviors === 'function') {
    await demo.registerBehaviors(runtime);
  }

  await registerModelDrivenMutations(runtime);

  return { db, runtime };
}

/**
 * Resolve a demo's { demo, db, runtime }, seeding or evolving as needed.
 *
 * The runtime is cached with the db so every caller in the process shares one registry
 * per demo — and, crucially, a *different* one from every other demo.
 */
async function getWorkshopDb(demoId) {
  const demo = resolveDemo(demoId);
  const cached = workshopDbCache.get(demoId);
  if (cached) return { demo, db: cached.db, runtime: cached.runtime };

  const settings = resolveWorkshopSettings();

  if (!settings.persist) {
    const seeded = await seedWorkshopDb(demo);
    workshopDbCache.set(demoId, seeded);
    return { demo, db: seeded.db, runtime: seeded.runtime };
  }

  fs.mkdirSync(settings.dataDir, { recursive: true });
  const dbPath = demoDbPath(settings.dataDir, demoId, settings.engine);

  let db;
  try {
    db = openCozoDb(settings.engine, dbPath);
  } catch (err) {
    const seeded = await seedWorkshopDb(demo);
    workshopDbCache.set(demoId, seeded);
    return { demo, db: seeded.db, runtime: seeded.runtime };
  }

  const hasSchema = await dbHasOntologySchema(db);
  const prepared = hasSchema
    ? await evolveWorkshopDb(demo, db)
    : await seedWorkshopDb(demo, db);

  workshopDbCache.set(demoId, prepared);
  return { demo, db: prepared.db, runtime: prepared.runtime };
}

async function getDemoProjection(demoId) {
  const { demo, db, runtime } = await getWorkshopDb(demoId);
  if (typeof om.exportOntologyProjection !== 'function') {
    throw new Error('om.exportOntologyProjection is not available in depa-ontology');
  }
  const projection = await om.exportOntologyProjection(runtime, {
    name: demo.demoId,
    includeEnumHintsFromInstances: true,
  });
  return projection;
}

async function listObjectsByType(demoId, typeName, filter) {
  const { db } = await getWorkshopDb(demoId);
  const entities = await om.findByType(db, typeName, filter || {}, { exact: true });
  return entities.map((e) => ({
    id: e.id,
    label: e.label,
    typeName,
    properties: e.properties || {},
  }));
}

async function getObjectDetail(demoId, typeName, entityId) {
  const { db, runtime } = await getWorkshopDb(demoId);
  const view = await om.getEntityView(runtime, entityId);
  if (!view) {
    const err = new Error(`Entity not found: ${entityId}`);
    err.status = 404;
    throw err;
  }
  if (typeName && view.typeName !== typeName) {
    // Soft check: still return if id matches
  }
  const neighbors = await om.getNeighbors(db, entityId, null, 'both');
  return {
    id: view.id,
    typeName: view.typeName,
    label: view.label,
    properties: view.properties || {},
    outgoing: view.outgoing || neighbors.outgoing || [],
    incoming: (neighbors.incoming || []).map((entry) => ({
      relName: entry.relName,
      fromId: entry.entityId,
      fromType: entry.typeName,
      fromLabel: entry.label,
    })),
  };
}

function parseRelNames(raw) {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

async function getImpactGraph(demoId, entityId, opts) {
  const { db, runtime } = await getWorkshopDb(demoId);
  const options = opts && typeof opts === 'object' ? opts : {};
  const maxDepthRaw = Number(options.maxDepth);
  const maxDepth = Number.isInteger(maxDepthRaw) && maxDepthRaw >= 0 ? maxDepthRaw : 3;
  const direction = options.direction || 'outgoing';
  const relNames = parseRelNames(options.relNames);
  const result = await om.impactAnalysis(runtime, {
    rootId: entityId,
    relNames,
    maxDepth,
    direction,
  });
  return {
    template: result.template,
    input: result.input,
    visual: result.data && result.data.visual,
    stats: result.stats,
  };
}

async function getOwnershipTree(demoId, entityId, opts) {
  const { db, runtime } = await getWorkshopDb(demoId);
  const options = opts && typeof opts === 'object' ? opts : {};
  const maxDepthRaw = Number(options.maxDepth);
  const maxDepth = Number.isInteger(maxDepthRaw) && maxDepthRaw >= 0 ? maxDepthRaw : 3;
  const requested = parseRelNames(options.ownerRelNames || options.relNames);
  // Default to what the model declares, not a built-in name list: a demo's ownership
  // relations are whatever it marked as ownership/composition.
  const ownerRelNames = requested.length ? requested : await om.listOwnerRelations(db);
  const result = await om.ownershipTree(runtime, { rootId: entityId, maxDepth, ownerRelNames });
  return {
    template: result.template,
    input: result.input,
    visual: result.data && result.data.visual,
    stats: result.stats,
  };
}

function listDemoSummaries() {
  return allDemos.map((demo) => ({
    id: demo.demoId,
    label: demo.label,
  }));
}

function closeWorkshopDbs() {
  for (const db of workshopDbCache.values()) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  workshopDbCache.clear();
}

module.exports = {
  getWorkshopDb,
  getDemoProjection,
  listObjectsByType,
  getObjectDetail,
  getImpactGraph,
  getOwnershipTree,
  listDemoSummaries,
  closeWorkshopDbs,
  resolveDemo,
  configureWorkshop,
  resetWorkshopConfig,
  resolveWorkshopSettings,
  evolveWorkshopDb,
  // Exposed so tests can diff the table-declared ontology against demo.defineOntology
  // while the two sources are being collapsed into one.
  defineOntologyFromTables,
  tableMapFromTables,
};
