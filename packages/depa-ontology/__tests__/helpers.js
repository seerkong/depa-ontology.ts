const { CozoDb } = require('../index');
const om = require('../cozo-om');

/**
 * Create a fresh in-memory CozoDB with om schema initialized.
 *
 * Returns `{ db, om, runtime }`. Behavior registration/execution and the write/read
 * APIs that consult constraints require an explicit runtime now (there is no
 * process-wide registry), so tests use `runtime` for those and `db` for the APIs that
 * take a plain runner (type/attribute/relation definitions, entity creation, graph reads).
 */
async function createTestDb() {
  const db = new CozoDb('mem', '', {});
  await om.initSchema(db);
  const runtime = om.createOmRuntime(db);
  return { db, om, runtime };
}

/**
 * Create a test DB with a standard type hierarchy pre-seeded:
 *   Resource (root)
 *     ├─ ExecutableResource
 *     │    ├─ ApiService
 *     │    └─ Worker
 *     └─ Dataset
 */
async function createTestDbWithHierarchy() {
  const { db, runtime } = await createTestDb();
  await om.defineType(db, 'Resource', 'Resource');
  await om.defineType(db, 'ExecutableResource', 'Executable Resource', { parentType: 'Resource' });
  await om.defineType(db, 'ApiService', 'ApiService', { parentType: 'ExecutableResource' });
  await om.defineType(db, 'Worker', 'Worker', { parentType: 'ExecutableResource' });
  await om.defineType(db, 'Dataset', 'Dataset', { parentType: 'Resource' });
  return { db, om, runtime };
}

module.exports = { createTestDb, createTestDbWithHierarchy };
