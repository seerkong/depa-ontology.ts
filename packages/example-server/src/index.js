const { Elysia } = require('elysia');
const { cors } = require('@elysiajs/cors');
const { CozoDb, om } = require('depa-ontology');
const { allDemos, demoMap } = require('./demos');
const { parseSheetsIntoBatch } = require('./helpers');
const { permissionModels, permissionModelMap } = require('./permission/models');
const {
  getDemoProjection,
  listObjectsByType,
  getObjectDetail,
  getImpactGraph,
  getOwnershipTree,
  closeWorkshopDbs,
  configureWorkshop,
  resetWorkshopConfig,
} = require('./workshop');
const {
  listOperations,
  getOperation,
  invokeOperation,
} = require('./operations');

// cozo-om keeps its behavior registries at module scope (global per process).
// Serializes the two routes that REPLACE a shared db binding (/governance/seed and
// /governance/integrity/seed-demo) so a request cannot observe a half-swapped handle.
//
// It used to guard every route because the behavior registry was a process-wide
// singleton; registries are now per-runtime (see createOmRuntime), so the other routes
// no longer share mutable state and run concurrently.
function createSerialQueue() {
  let tail = Promise.resolve();
  return function withLock(fn) {
    const task = tail.then(() => fn(), () => fn());
    tail = task.catch(() => {});
    return task;
  };
}

const withOmRegistryLock = createSerialQueue();

/**
 * 把一次异常转成 HTTP 错误响应体。
 *
 * 背景：`depa-ontology` 的 `error-surface-contract` mission 之前，库抛的错误没有机器可判据
 * （重复 id 只有 Cozo 的 `transact::assertion_failure`，且 message 是
 * `"when executing against relation 'om_entity'"`），所以这里只能把 `display` 当字符串吐出去。
 * 现在库给出稳定的 `code` 与结构化字段，响应体就把它们一并带出。
 *
 * **`error` 字段保持字符串**（既有测试断言 `typeof data.error === 'string'`）；
 * 新增的是并列的结构化字段，因此这个改动是**纯增量**、对老消费者无破坏。
 *
 * 引擎词汇（`transact::*`）不出现在响应里 —— 那是 AT1 I5，库侧已翻译干净。
 */
function errorResponse(err) {
  const message = err.display || err.message || String(err);
  const body = { status: 'error', error: message };
  if (err && typeof err === 'object' && typeof err.code === 'string' && err.code) {
    body.code = err.code;
    // 只带白名单字段，避免把内部结构（如 cause）泄进 HTTP 响应。
    for (const k of ['entityId', 'typeName', 'attrName', 'relName', 'constraintName', 'version', 'stepKind']) {
      if (err[k] !== undefined) body[k] = err[k];
    }
  }
  return body;
}

const TABLE_NAMES = {
  types: '类型定义',
  attributes: '属性定义',
  relations: '关系定义',
  entities: '实体数据',
  properties: '属性数据',
  edges: '边数据',
};

const GOVERNANCE_TABLE_NAMES = {
  permActions: '权限动作',
  permPolicies: '权限策略',
  permPathRules: '路径规则',
  permAbacRules: 'ABAC 规则',
};

function tableMapFromTables(tables) {
  const map = Object.create(null);
  for (const t of Array.isArray(tables) ? tables : []) {
    if (!t || typeof t !== 'object') continue;
    map[t.name] = t;
  }
  return map;
}

function ensureTableShape(table) {
  return table && typeof table === 'object'
    ? { columns: Array.isArray(table.columns) ? table.columns : [], rows: Array.isArray(table.rows) ? table.rows : [] }
    : { columns: [], rows: [] };
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

function parseBool(value, defaultValue = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return defaultValue;
  const t = value.trim().toLowerCase();
  if (t === 'true' || t === '1' || t === 'yes' || t === 'y') return true;
  if (t === 'false' || t === '0' || t === 'no' || t === 'n') return false;
  return defaultValue;
}

function getDefaultGovernanceSeedTables() {
  return [
    {
      name: TABLE_NAMES.types,
      columns: ['typeName', 'description', 'parent_type', 'mixins'],
      rows: [
        { typeName: 'User', description: 'User', parent_type: '', mixins: '' },
        { typeName: 'Resource', description: 'Resource', parent_type: '', mixins: '' },
      ],
    },
    {
      name: TABLE_NAMES.attributes,
      columns: ['typeName', 'attrName', 'valueType', 'required', 'description'],
      rows: [
        { typeName: 'User', attrName: 'role', valueType: 'String', required: false, description: 'Role' },
      ],
    },
    {
      name: TABLE_NAMES.relations,
      columns: ['relName', 'fromType', 'toType', 'directed', 'description'],
      rows: [
        { relName: 'owns', fromType: 'User', toType: 'Resource', directed: true, description: 'User owns Resource' },
      ],
    },
    {
      name: TABLE_NAMES.entities,
      columns: ['id', 'typeName', 'label'],
      rows: [
        { id: 'u:1', typeName: 'User', label: 'User 1' },
        { id: 'r:1', typeName: 'Resource', label: 'Resource 1' },
      ],
    },
    {
      name: TABLE_NAMES.properties,
      columns: ['entityId', 'attrName', 'value'],
      rows: [
        { entityId: 'u:1', attrName: 'role', value: 'admin' },
      ],
    },
    {
      name: TABLE_NAMES.edges,
      columns: ['fromId', 'relName', 'toId', 'props'],
      rows: [
        { fromId: 'u:1', relName: 'owns', toId: 'r:1', props: '{}' },
      ],
    },
    {
      name: GOVERNANCE_TABLE_NAMES.permActions,
      columns: ['action', 'description'],
      rows: [
        { action: 'read', description: 'Read' },
      ],
    },
    {
      name: GOVERNANCE_TABLE_NAMES.permPolicies,
      columns: ['policy_id', 'effect', 'action', 'resource_type', 'enabled', 'description'],
      rows: [
        {
          policy_id: 'pol:demo:allow-admin-owner',
          effect: 'allow',
          action: 'read',
          resource_type: 'Resource',
          enabled: true,
          description: 'Allow read when owns + admin',
        },
      ],
    },
    {
      name: GOVERNANCE_TABLE_NAMES.permPathRules,
      columns: ['policy_id', 'path'],
      rows: [
        { policy_id: 'pol:demo:allow-admin-owner', path: 'owns' },
      ],
    },
    {
      name: GOVERNANCE_TABLE_NAMES.permAbacRules,
      columns: ['policy_id', 'left_ref', 'op', 'right_ref'],
      rows: [
        { policy_id: 'pol:demo:allow-admin-owner', left_ref: 'subject.role', op: '==', right_ref: 'admin' },
      ],
    },
  ];
}

function tableRowsToObjects(table) {
  const cols = Array.isArray(table?.columns) ? table.columns : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    }
    return row || {};
  });
}

function extractPermissionSeedFromTables(tableMap) {
  const actionsTable = ensureTableShape(tableMap[GOVERNANCE_TABLE_NAMES.permActions]);
  const policiesTable = ensureTableShape(tableMap[GOVERNANCE_TABLE_NAMES.permPolicies]);
  const pathRulesTable = ensureTableShape(tableMap[GOVERNANCE_TABLE_NAMES.permPathRules]);
  const abacRulesTable = ensureTableShape(tableMap[GOVERNANCE_TABLE_NAMES.permAbacRules]);

  const actions = tableRowsToObjects(actionsTable)
    .map((r) => ({ action: String(r.action ?? '').trim(), description: r.description != null ? String(r.description) : '' }))
    .filter((r) => r.action);

  const policies = tableRowsToObjects(policiesTable)
    .map((r) => ({
      policy_id: String(r.policy_id ?? r.policyId ?? '').trim(),
      effect: String(r.effect ?? 'allow').trim(),
      action: String(r.action ?? '').trim(),
      resource_type: String(r.resource_type ?? r.resourceType ?? '').trim(),
      enabled: parseBool(r.enabled, true),
      description: r.description != null ? String(r.description) : '',
    }))
    .filter((r) => r.policy_id);

  const pathRules = tableRowsToObjects(pathRulesTable)
    .map((r) => ({ policy_id: String(r.policy_id ?? r.policyId ?? '').trim(), path: String(r.path ?? '').trim() }))
    .filter((r) => r.policy_id && r.path);

  const abacRules = tableRowsToObjects(abacRulesTable)
    .map((r) => ({
      policy_id: String(r.policy_id ?? r.policyId ?? '').trim(),
      left_ref: String(r.left_ref ?? r.leftRef ?? '').trim(),
      op: String(r.op ?? '').trim(),
      right_ref: String(r.right_ref ?? r.rightRef ?? '').trim(),
    }))
    .filter((r) => r.policy_id && r.left_ref && r.op && r.right_ref);

  return { actions, policies, pathRules, abacRules };
}

async function defineOntologyFromTables(db, tableMap) {
  const typeTable = ensureTableShape(tableMap[TABLE_NAMES.types]);
  const attrTable = ensureTableShape(tableMap[TABLE_NAMES.attributes]);
  const relTable = ensureTableShape(tableMap[TABLE_NAMES.relations]);

  await om.initSchema(db);

  // Mixins must exist before types reference them.
  // We infer mixin names from the `mixins` column in the type table.
  const typeRowObjects = typeTable.rows
    .map((row) => Array.isArray(row)
      ? Object.fromEntries(typeTable.columns.map((c, i) => [c, row[i]]))
      : row)
    .filter((obj) => obj && typeof obj === 'object');

  const mixinNames = new Set();
  for (const obj of typeRowObjects) {
    if (!obj.mixins) continue;
    for (const m of String(obj.mixins).split(',').map(s => s.trim()).filter(Boolean)) {
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
      const list = String(obj.mixins).split(',').map(s => s.trim()).filter(Boolean);
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
    await om.defineRelation(db, String(obj.relName), String(obj.fromType), String(obj.toType), parseBool(obj.directed, true), obj.description != null ? String(obj.description) : undefined);
  }
}

function tablesToDataSheets(tableMap) {
  return {
    entities: ensureTableShape(tableMap[TABLE_NAMES.entities]),
    properties: ensureTableShape(tableMap[TABLE_NAMES.properties]),
    edges: ensureTableShape(tableMap[TABLE_NAMES.edges]),
  };
}

function visualToGraph(visual) {
  const graph = visual?.graph;
  if (!graph) return { nodes: [], edges: [] };
  const nodes = (graph.nodes || []).map((n) => ({
    id: n.id,
    label: n.label,
    group: n.group || n.kind || n.typeName,
  }));
  const edges = (graph.edges || []).map((e) => ({
    from: e.source,
    to: e.target,
    label: e.label || e.kind,
  }));
  return { nodes, edges };
}

function visualToTreeNodes(visual) {
  const tree = visual?.tree;
  const graph = visual?.graph;
  if (!tree || !graph) return [];
  const nodeMap = graph.nodeMap || {};
  const childrenById = tree.childrenById || {};

  function buildNode(id, seen) {
    if (seen.has(id)) return { id, label: nodeMap[id]?.label ?? id, children: [] };
    const nextSeen = new Set(seen);
    nextSeen.add(id);
    const label = nodeMap[id]?.label ?? id;
    const childEdges = childrenById[id] || [];
    const children = childEdges.map((edge) => buildNode(edge.toId, nextSeen));
    return { id, label, children };
  }

  return [buildNode(tree.rootId, new Set())];
}

function rankingVisualToTable(visual) {
  const ranking = visual?.ranking || [];
  const columns = ['rank', 'label', 'score', 'id', 'degree', 'baseScore', 'degreeWeight'];
  const rows = ranking.map((r) => ({
    rank: r.rank,
    label: r.label,
    score: r.score,
    id: r.id,
    degree: r.factors?.degree,
    baseScore: r.factors?.baseScore,
    degreeWeight: r.factors?.degreeWeight,
  }));
  return { columns, rows };
}

async function seedGovernanceDemo(runner) {
  const tables = getDefaultGovernanceSeedTables();
  await seedGovernanceFromTables(runner, tables);
}

const INTEGRITY_DEMO_RULE = 'resource_must_have_owner';

// Seeds a FRESH db for the integrity demo: governance ontology + the demo
// rule + unowned resources. Callers swap the previous integrityDb for the result,
// so "初始化演示数据" is a deterministic reset.
async function seedIntegrityDemo(runner) {
  await om.initSchema(runner);
  await seedGovernanceFromTables(runner);

  await om.defineExistentialRule(runner, INTEGRITY_DEMO_RULE, {
    forEach: { type: 'Resource' },
    exists: { rel: 'owns', direction: 'in', toType: 'User' },
    mode: 'materialize',
    message: '每个资源必须有归属用户',
    materialize: { labelTemplate: 'auto owner for {fromId}' },
  });

  // Unowned resources so the demo has violations to detect and materialize.
  await om.upsertEntity(runner, 'r:unowned-1', 'Resource', 'Unowned Resource 1');
  await om.upsertEntity(runner, 'r:unowned-2', 'Resource', 'Unowned Resource 2');

  return om.listExistentialRules(runner);
}

async function seedGovernanceFromTables(runner, tables) {
  const inputTables = Array.isArray(tables) && tables.length > 0 ? tables : getDefaultGovernanceSeedTables();
  const tableMap = tableMapFromTables(inputTables);

  await defineOntologyFromTables(runner, tableMap);
  const attrSchema = buildAttrSchema(tableMap);
  const dataSheets = tablesToDataSheets(tableMap);
  const batch = parseSheetsIntoBatch(dataSheets, attrSchema);
  await om.ingestBatch(runner, batch);

  const permSeed = extractPermissionSeedFromTables(tableMap);
  if (typeof om.seedPermissionMetadata === 'function') {
    await om.seedPermissionMetadata(runner, permSeed);
  }
}

function createApp(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.workshop && typeof opts.workshop === 'object') {
    configureWorkshop(opts.workshop);
  } else if (opts.workshopPersist != null || opts.workshopDataDir) {
    configureWorkshop({
      ...(opts.workshopPersist != null ? { persist: !!opts.workshopPersist } : {}),
      ...(opts.workshopDataDir ? { dataDir: opts.workshopDataDir } : {}),
    });
  }
  const sharedDb = opts.db || new CozoDb();
  // The shared schema/governance db gets its own runtime so those routes resolve a
  // registry explicitly instead of relying on a process-wide one.
  const sharedRuntime = om.createOmRuntime(sharedDb);
  let governanceDb = opts.governanceDb || new CozoDb();
  // Kept in step with governanceDb: /governance/seed swaps the db, so the runtime
  // (and therefore the registry those routes read) is rebuilt with it.
  let governanceRuntime = om.createOmRuntime(governanceDb);
  // The integrity demo keeps its own db so /api/governance/seed (used by the
  // 数据准备 tab and other test files running in parallel) cannot wipe it.
  let integrityDb = opts.integrityDb || new CozoDb();
  // Same pattern as governanceRuntime: integrity/seed-demo swaps the db.
  let integrityRuntime = om.createOmRuntime(integrityDb);

  const app = new Elysia()
    .use(cors())

    // GET /health — readiness probe for e2e
    .get('/health', () => ({ status: 'ok' }))

    // GET /api/demos — list all demos with queries and default sheet data
    .get('/api/demos', () => {
      const demos = allDemos.map(demo => ({
        id: demo.demoId,
        label: demo.label,
        tables: demo.defaultTables,
        queries: demo.queries.map(q => ({
          id: q.queryId,
          label: q.label,
          meaning: q.meaning,
          description: q.meaning,
          dsl: q.dsl || '',
          defaultView: q.defaultView,
        })),
      }));
      return { demos };
    })

    // POST /api/run — execute a query for a demo
    .post('/api/run', async ({ body }) => {
      const { demoId, queryId, tables, sheets } = body || {};

      const demo = demoMap[demoId];
      if (!demo) {
        return { status: 'error', error: `Unknown demo: ${demoId}` };
      }

      const queryDef = demo.queries.find(q => q.queryId === queryId);
      if (!queryDef) {
        return { status: 'error', error: `Unknown query: ${queryId}` };
      }

      // sheets currently come from workbook tables, but keep it in the request shape.
      void sheets;

      return (async () => {
        const db = new CozoDb();
        // A scratch db gets a scratch runtime: behaviors registered for this run stay
        // in this run's registry and cannot leak into another request or demo.
        const runtime = om.createOmRuntime(db);
        try {
          // 1. Define ontology (types, attrs, rels)
          const inputTables = Array.isArray(tables) && tables.length > 0 ? tables : demo.defaultTables;
          const tableMap = tableMapFromTables(inputTables);
          await defineOntologyFromTables(db, tableMap);

          const attrSchema = buildAttrSchema(tableMap);

          // 2. Ingest sheet data (use provided sheets or fall back to defaults)
          const dataSheets = tablesToDataSheets(tableMap);
          const batch = parseSheetsIntoBatch(dataSheets, attrSchema);
          await om.ingestBatch(runtime, batch);

          // 2.5 Register JS-only behavior layer (actions/constraints/computed)
          // These handlers are not represented in the workbook tables.
          if (typeof demo.registerBehaviors === 'function') {
            await demo.registerBehaviors(runtime);
          }

          // 3. Execute query
          const result = await queryDef.run(runtime);

          if (result.view === 'graph') {
            return {
              status: 'ok',
              graph: visualToGraph(result.data),
            };
          }
          if (result.view === 'tree') {
            return {
              status: 'ok',
              tree: visualToTreeNodes(result.data),
            };
          }
          // table
          if (result.data && result.data.primary === 'ranking') {
            return { status: 'ok', table: rankingVisualToTable(result.data) };
          }
          return {
            status: 'ok',
            table: result.data,
          };
        } catch (err) {
          return errorResponse(err);
        } finally {
          try { db.close(); } catch (_) { /* ignore */ }
        }
      })();
    })

    // GET /api/permission/models — list permission demo models
    // 中文说明：/permission demo 走“直接 CozoDb 跑表 + 查询”的路径（seed 使用 :replace 写入表，查询使用 db.run）。
    // 这里刻意不通过 cozo-om 的本体论封装能力，以防后续迭代把该 demo 的实现路径误替换为上层封装。
    .get('/api/permission/models', () => {
      const models = permissionModels.map((m) => ({
        id: m.modelId,
        label: m.label,
        description: m.description,
        tables: m.defaultTables,
        queries: (m.queries || []).map((q) => ({
          id: q.queryId,
          label: q.label,
          meaning: q.meaning,
          cozo: q.cozo,
          params: q.params,
        })),
      }));
      return { models };
    })

    // POST /api/permission/run — execute a permission model query
    // 中文说明：该端点为 demo 每次请求创建独立 CozoDb 实例，并直接执行 permission/models.js 里的 setup + query.run。
    // 不调用 cozo-om，也不依赖其全局 registry / lock 机制。
    .post('/api/permission/run', async ({ body }) => {
      const { modelId, queryId, params, tables } = body || {};

      const model = permissionModelMap[modelId];
      if (!model) {
        return { status: 'error', error: `Unknown model: ${modelId}` };
      }

      const queryDef = (model.queries || []).find((q) => q.queryId === queryId);
      if (!queryDef) {
        return { status: 'error', error: `Unknown query: ${queryId}` };
      }

      const db = new CozoDb();
      try {
        if (typeof model.setup === 'function') {
          await model.setup(db, Array.isArray(tables) && tables.length > 0 ? tables : undefined);
        }
        const result = await queryDef.run(db, params || {});
        return { status: 'ok', ...(result || {}) };
      } catch (err) {
        return errorResponse(err);
      } finally {
        try { db.close(); } catch (_) { /* ignore */ }
      }
    })

    // GET /api/schema/state
    .get('/api/schema/state', async () => {
      return (async () => {
        await om.initSchema(sharedDb);
        return await om.getSchemaState(sharedDb);
      })();
    })

    // GET /api/schema/versions
    .get('/api/schema/versions', async () => {
      return (async () => {
        await om.initSchema(sharedDb);
        const versions = await om.listSchemaVersions(sharedDb);
        return { versions };
      })();
    })

    // POST /api/schema/diff { fromVersion, toVersion }
    .post('/api/schema/diff', async ({ body }) => {
      const { fromVersion, toVersion } = body || {};
      return (async () => {
        await om.initSchema(sharedDb);
        const diff = await om.diffSchemaVersions(sharedDb, fromVersion, toVersion);
        return { diff };
      })();
    })

    // POST /api/schema/apply { spec }
    .post('/api/schema/apply', async ({ body }) => {
      const { spec } = body || {};
      return (async () => {
        await om.initSchema(sharedDb);
        await om.applySchemaMigration(sharedRuntime, spec);
        const state = await om.getSchemaState(sharedDb);
        return { ok: true, state };
      })();
    })

    // POST /api/schema/rollback { targetVersion, strict }
    .post('/api/schema/rollback', async ({ body }) => {
      const { targetVersion, strict } = body || {};
      return (async () => {
        await om.initSchema(sharedDb);
        const result = await om.rollbackSchema(sharedRuntime, targetVersion, { strict: strict !== false });
        const state = await om.getSchemaState(sharedDb);
        return { ok: true, result, state };
      })();
    })

    // GET /api/governance/seed-template
    .get('/api/governance/seed-template', async () => {
      const tables = getDefaultGovernanceSeedTables();
      return { ok: true, tables, subjectId: 'u:1', resourceId: 'r:1', action: 'read' };
    })

    // POST /api/governance/seed (optional { tables })
    .post('/api/governance/seed', async ({ body }) => {
      const tables = body && typeof body === 'object' ? body.tables : undefined;
      return withOmRegistryLock(async () => {
        const nextDb = new CozoDb();
        const nextRuntime = om.createOmRuntime(nextDb);
        try {
          await seedGovernanceFromTables(nextRuntime, tables);
        } catch (err) {
          try { nextDb.close(); } catch (_) { /* ignore */ }
          throw err;
        }

        try { governanceDb.close(); } catch (_) { /* ignore */ }
        governanceDb = nextDb;
        governanceRuntime = om.createOmRuntime(governanceDb);

        return { ok: true, subjectId: 'u:1', resourceId: 'r:1', action: 'read' };
      });
    })

    // POST /api/governance/checkAccess { subjectId, action, resourceId }
    .post('/api/governance/checkAccess', async ({ body }) => {
      const { subjectId, action, resourceId } = body || {};
      return (async () => {
        await om.initSchema(governanceDb);
        const result = await om.checkAccess(governanceRuntime, { subjectId, action, resourceId });
        return { result };
      })();
    })

    // POST /api/governance/explain { subjectId, action, resourceId }
    // Alias for checkAccess (result includes explanation).
    .post('/api/governance/explain', async ({ body }) => {
      const { subjectId, action, resourceId } = body || {};
      return (async () => {
        await om.initSchema(governanceDb);
        const result = await om.checkAccess(governanceRuntime, { subjectId, action, resourceId });
        return { result };
      })();
    })

    // POST /api/governance/integrity/seed-demo — deterministic reset:
    // fresh db with ontology + demo rule + unowned resources.
    .post('/api/governance/integrity/seed-demo', async () => {
      return withOmRegistryLock(async () => {
        const nextDb = new CozoDb();
        const nextRuntime = om.createOmRuntime(nextDb);
        let rules;
        try {
          rules = await seedIntegrityDemo(nextRuntime);
        } catch (err) {
          try { nextDb.close(); } catch (_) { /* ignore */ }
          throw err;
        }

        try { integrityDb.close(); } catch (_) { /* ignore */ }
        integrityDb = nextDb;
        integrityRuntime = om.createOmRuntime(integrityDb);

        return { ok: true, rules };
      });
    })

    // GET /api/governance/integrity/rules
    .get('/api/governance/integrity/rules', async () => {
      return (async () => {
        await om.initSchema(integrityDb);
        const rules = await om.listExistentialRules(integrityDb);
        return { rules };
      })();
    })

    // POST /api/governance/integrity/check { rules?, asOf? }
    .post('/api/governance/integrity/check', async ({ body }) => {
      const { rules, asOf } = body || {};
      return (async () => {
        await om.initSchema(integrityDb);
        const violations = await om.checkExistentialRules(integrityDb, {
          ...(Array.isArray(rules) && rules.length ? { rules } : {}),
          ...(asOf ? { asOf } : {}),
        });
        return { violations };
      })();
    })

    // POST /api/governance/integrity/apply { rules?, maxIterations? }
    .post('/api/governance/integrity/apply', async ({ body }) => {
      const { rules, maxIterations } = body || {};
      return (async () => {
        await om.initSchema(integrityDb);
        const result = await om.applyExistentialRules(integrityRuntime, {
          ...(Array.isArray(rules) && rules.length ? { rules } : {}),
          ...(maxIterations != null ? { maxIterations } : {}),
        });
        return { ok: true, result };
      })();
    })

    // GET /api/demos/:id/projection — OntologyProjection for a demo
    .get('/api/demos/:id/projection', async ({ params }) => {
      const demoId = params.id;
      return (async () => {
        try {
          const projection = await getDemoProjection(demoId);
          return { status: 'ok', projection };
        } catch (err) {
          // 两分支都是 'error'（原样保留的既有行为，不顺手改语义）。
          return errorResponse(err);
        }
      })();
    })

    // GET /api/demos/:id/objects/:typeName — list entities of a type
    .get('/api/demos/:id/objects/:typeName', async ({ params, query }) => {
      const demoId = params.id;
      const typeName = params.typeName;
      return (async () => {
        try {
          const filter = query && query.filter ? JSON.parse(query.filter) : {};
          const entities = await listObjectsByType(demoId, typeName, filter);
          return { status: 'ok', typeName, entities };
        } catch (err) {
          return errorResponse(err);
        }
      })();
    })

    // GET /api/demos/:id/objects/:typeName/:entityId — entity detail + links
    .get('/api/demos/:id/objects/:typeName/:entityId', async ({ params }) => {
      const { id: demoId, typeName, entityId } = params;
      return (async () => {
        try {
          const entity = await getObjectDetail(demoId, typeName, entityId);
          return { status: 'ok', entity };
        } catch (err) {
          return errorResponse(err);
        }
      })();
    })

    // GET /api/demos/:id/graph/impact/:entityId — OM impactAnalysis (no JOIN)
    .get('/api/demos/:id/graph/impact/:entityId', async ({ params, query }) => {
      const demoId = params.id;
      const entityId = decodeURIComponent(params.entityId);
      return (async () => {
        try {
          const graph = await getImpactGraph(demoId, entityId, {
            maxDepth: query && query.maxDepth,
            direction: query && query.direction,
            relNames: query && query.relNames,
          });
          return { status: 'ok', ...graph };
        } catch (err) {
          return errorResponse(err);
        }
      })();
    })

    // GET /api/demos/:id/graph/tree/:entityId — OM ownershipTree
    .get('/api/demos/:id/graph/tree/:entityId', async ({ params, query }) => {
      const demoId = params.id;
      const entityId = decodeURIComponent(params.entityId);
      return (async () => {
        try {
          const tree = await getOwnershipTree(demoId, entityId, {
            maxDepth: query && query.maxDepth,
            ownerRelNames: query && (query.ownerRelNames || query.relNames),
          });
          return { status: 'ok', ...tree };
        } catch (err) {
          return errorResponse(err);
        }
      })();
    })

    // GET /api/demos/:demoId/operations — OntologyOperation list
    .get('/api/demos/:id/operations', async ({ params }) => {
      const demoId = params.id;
      try {
        const operations = listOperations(demoId);
        return { status: 'ok', operations };
      } catch (err) {
        return errorResponse(err);
      }
    })

    // GET /api/demos/:demoId/operations/:fqnOrId — OntologyOperation detail
    .get('/api/demos/:id/operations/:fqnOrId', async ({ params }) => {
      const demoId = params.id;
      const fqnOrId = decodeURIComponent(params.fqnOrId);
      try {
        const operation = getOperation(demoId, fqnOrId);
        return { status: 'ok', operation };
      } catch (err) {
        return errorResponse(err);
      }
    })

    // POST /api/demos/:demoId/invoke — OntologyOperation invoke
    .post('/api/demos/:id/invoke', async ({ params, body }) => {
      const demoId = params.id;
      return (async () => {
        try {
          return await invokeOperation(demoId, body || {});
        } catch (err) {
          // invoke 的响应形状与只读路由**不同**（`error` 是嵌套对象而非字符串），
          // 这是既有的公开契约，前端 `data.error.code` 依赖它 —— 不改成扁平。
          // 内层的 `code` 已由 operations.js 的分派层按 ontology 的稳定 code 填好
          // （见那边 catch 里的说明），这里只做最后的兜底。
          return { status: 'error', ok: false, error: { code: 'RUNTIME', message: err.display || err.message || String(err) } };
        }
      })();
    });

  function close() {
    try { sharedDb.close(); } catch (_) { /* ignore */ }
    try { governanceDb.close(); } catch (_) { /* ignore */ }
    try { integrityDb.close(); } catch (_) { /* ignore */ }
    try { closeWorkshopDbs(); } catch (_) { /* ignore */ }
    try { resetWorkshopConfig(); } catch (_) { /* ignore */ }
  }

  return { app, close, db: sharedDb };
}

module.exports = { createApp, withOmRegistryLock, listOperations, getOperation, invokeOperation };

if (require.main === module) {
  const { app } = createApp();
  app.listen(4175);
  console.log(`cozo-viz server running at http://localhost:${app.server.port}`);
}
