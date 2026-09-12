'use strict';
const { infer, factId, explain } = require('depa-inference-logic');
const { evaluate } = require('depa-inference-cozo-support');
function createInferenceCapsule({ budget = {}, runtime = { evaluate, now: () => performance.now() } } = {}) {
  const config = Object.freeze({ ...budget });
  return Object.freeze({ infer: input => infer(runtime, input, config) });
}
module.exports = { createInferenceCapsule, factId, explain };
