'use strict';
const { CozoDb } = require('depa-cozo');
process.once('message', async query => {
  let db, response;
  try {
    db = new CozoDb('mem');
    response = { result: await db.run(query.script, query.params, true) };
  } catch (error) {
    response = { error: { message: error.message || error.display || String(error), code: error.code } };
  } finally {
    if (db) db.close();
  }
  process.send(response, () => process.disconnect());
});
