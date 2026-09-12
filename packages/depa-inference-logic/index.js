'use strict';
const { createHash } = require('node:crypto');
const d = require('depa-datalog');
const { INFERENCE_API_VERSION } = require('depa-inference-contract');

const defaults = { maxInputFacts: 10000, maxRules: 256, maxFacts: 20000, maxSupports: 50000, timeoutMs: 5000 };
const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const factId = (relation, values) => {
  d.assertIdentifier(relation, 'relation');
  if (!Array.isArray(values) || !values.length || !values.every(scalar)) fail('Fact identity requires canonical scalar values');
  return digest([relation, values]);
};
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => { throw new Error(message); };
const scalar = value => value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 1000000 || typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
function text(value, name) { if (typeof value !== 'string' || !value.length || value.length > 10000) fail(`Invalid ${name}`); return value; }
function shape(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) fail(`Invalid ${name} shape`);
}
function normalize(input, budget) {
  shape(input, ['epoch', 'program', 'facts'], 'input');
  text(input.epoch, 'epoch');
  const p = input.program;
  shape(p, ['id', 'version', 'relations', 'rules'], 'program');
  text(p.id, 'program id'); text(p.version, 'program version');
  if (!Array.isArray(p.relations) || !p.relations.length || p.relations.length > 256 || !Array.isArray(p.rules) || p.rules.length > budget.maxRules) fail('Invalid relation/rule count');
  const relations = p.relations.map(r => {
    shape(r, ['name', 'arity'], 'relation');
    d.assertIdentifier(r.name, 'relation');
    if (!Number.isInteger(r.arity) || r.arity < 1 || r.arity > 32) fail('Relation arity must be 1..32');
    return { name: r.name, arity: r.arity };
  }).sort((a, b) => compare(a.name, b.name));
  const relationMap = new Map(relations.map(r => [r.name, r.arity]));
  if (relationMap.size !== relations.length) fail('Duplicate relation name');
  function atom(a, body) {
    shape(a, body ? ['relation', 'terms', 'not'] : ['relation', 'terms'], 'atom');
    if (!relationMap.has(a.relation) || !Array.isArray(a.terms) || a.terms.length !== relationMap.get(a.relation)) fail('Unknown relation or wrong arity');
    if (a.not !== undefined && typeof a.not !== 'boolean') fail('Invalid not flag');
    const terms = a.terms.map(term => {
      shape(term, ['var', 'value'], 'term');
      if (Object.keys(term).length !== 1) fail('Terms require exactly one var or value');
      if ('var' in term) return { var: d.assertIdentifier(term.var, 'variable') };
      if (!scalar(term.value)) fail('Constants must be finite scalars; -0 is not canonical');
      return { value: term.value };
    });
    return { relation: a.relation, terms, ...(body ? { not: a.not === true } : {}) };
  }
  const rules = p.rules.map(r => {
    shape(r, ['id', 'head', 'body'], 'rule'); text(r.id, 'rule id');
    if (!Array.isArray(r.body) || !r.body.length || r.body.length > 32) fail('Rules require 1..32 body atoms');
    return { id: r.id, head: atom(r.head, false), body: r.body.map(a => atom(a, true)) };
  }).sort((a, b) => compare(a.id, b.id));
  if (new Set(rules.map(r => r.id)).size !== rules.length) fail('Duplicate rule id');
  const derived = new Set(rules.map(r => r.head.relation));
  for (const rule of rules) {
    const bound = new Set(rule.body.filter(a => !a.not).flatMap(a => a.terms.filter(t => 'var' in t).map(t => t.var)));
    if (!bound.size && rule.body.every(a => a.not)) fail('Rule requires a positive body atom');
    for (const a of [rule.head, ...rule.body]) {
      if (a.terms.some(t => 'var' in t && !bound.has(t.var))) fail('Rule variables must be bound by positive body atoms');
      if (a.not && derived.has(a.relation)) fail('Negation requires a frozen input-only relation');
    }
  }
  if (!Array.isArray(input.facts) || input.facts.length > budget.maxInputFacts) fail('Input fact budget exceeded');
  const facts = new Map();
  for (const f of input.facts) {
    shape(f, ['relation', 'values', 'source'], 'fact');
    if (!relationMap.has(f.relation) || !Array.isArray(f.values) || f.values.length !== relationMap.get(f.relation) || !f.values.every(scalar)) fail('Invalid fact relation, arity or scalar');
    if (f.source !== undefined) text(f.source, 'fact source');
    const id = factId(f.relation, f.values);
    const found = facts.get(id) || { id, relation: f.relation, values: [...f.values], sources: [] };
    if (f.source !== undefined && !found.sources.includes(f.source)) found.sources.push(f.source);
    facts.set(id, found);
  }
  return { epoch: input.epoch, program: { id: p.id, version: p.version, relations, rules }, facts: [...facts.values()].sort((a, b) => a.id.localeCompare(b.id)).map(f => ({ ...f, sources: f.sources.sort() })) };
}

/** Compile safe finite rules and each direct support in the same native fixed point. */
function compile(input, budget) {
  const script = [], params = {}, names = new Map(input.program.relations.map((r, i) => [r.name, `r${i}`]));
  function append(builder) {
    const built = builder.build(), prefix = `q${script.length}`;
    script.push(built.script.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => `$${prefix}${name}`));
    for (const [key, value] of Object.entries(built.params)) params[`${prefix}${key}`] = value;
  }
  const outputColumns = ['kind', 'rule_id', 'relation', 'tuple', 'premises', 'absences'];
  const derived = new Set(input.program.rules.map(r => r.head.relation));
  for (const r of input.program.relations) {
    const cols = Array.from({ length: r.arity }, (_, i) => `c${i}`), rel = names.get(r.name), seed = `s${rel}`;
    append(d.query().rows(derived.has(r.name) ? seed : rel, cols, input.facts.filter(f => f.relation === r.name).map(f => f.values.map(v => JSON.stringify(v)))));
    if (derived.has(r.name)) append(d.query().rule(rel).select(cols).fromRule(seed, cols.map(d.variable)));
    append(d.query().select(outputColumns).fromRule(rel, cols.map(d.variable))
      .bind('kind', 'fact').bind('rule_id', '').bind('relation', r.name)
      .bind('tuple', d.raw(`[${cols.join(',')}]`)).bind('premises', d.raw('[]')).bind('absences', d.raw('[]')));
  }
  for (const rule of input.program.rules) {
    const vars = new Map([...new Set(rule.body.flatMap(a => a.terms.filter(t => 'var' in t).map(t => t.var)))].map((name, i) => [name, `v${i}`]));
    const term = t => 'var' in t ? d.variable(vars.get(t.var)) : d.val(JSON.stringify(t.value));
    const positiveFirst = [...rule.body.filter(a => !a.not), ...rule.body.filter(a => a.not)];
    const body = q => { for (const a of positiveFirst) q.fromRule(names.get(a.relation), a.terms.map(term), { negated: a.not }); return q; };
    const heads = rule.head.terms.map((_, i) => `h${i}`);
    const q = body(d.query().rule(names.get(rule.head.relation)).select(heads));
    rule.head.terms.forEach((t, i) => q.bind(heads[i], term(t)));
    append(q);
    const proof = body(d.query().select(outputColumns));
    // Only generated variable identifiers enter these raw list expressions.
    let constants = 0;
    const expr = t => {
      if ('var' in t) return vars.get(t.var);
      const name = `k${constants++}`; proof.bind(name, JSON.stringify(t.value)); return name;
    };
    const tuple = terms => `[${terms.map(expr).join(',')}]`;
    const witnesses = negated => `[${rule.body.filter(a => a.not === negated).map(a => {
      const name = `k${constants++}`; proof.bind(name, a.relation); return `[${name},${tuple(a.terms)}]`;
    }).join(',')}]`;
    const conclusion = tuple(rule.head.terms), premises = witnesses(false), absences = witnesses(true);
    proof.bind('kind', 'support').bind('rule_id', rule.id).bind('relation', rule.head.relation)
      .bind('tuple', d.raw(conclusion)).bind('premises', d.raw(premises)).bind('absences', d.raw(absences));
    append(proof);
  }
  script.push(`:timeout ${budget.timeoutMs / 1000}`, `:limit ${budget.maxFacts + budget.maxSupports + 1}`);
  return { script: script.join('\n'), params };
}

async function infer(runtime, input, config = {}) {
  const start = runtime.now();
  const result = { apiVersion: INFERENCE_API_VERSION, epoch: typeof input?.epoch === 'string' ? input.epoch : '', status: 'invalid', programFingerprint: '', inputFingerprint: '', facts: [], supports: [], diagnostics: [], stats: { elapsedMs: 0, inputFacts: 0, outputFacts: 0, outputSupports: 0 } };
  const finish = () => { result.stats.elapsedMs = Math.max(0, runtime.now() - start); result.stats.outputFacts = result.facts.length; result.stats.outputSupports = result.supports.length; return result; };
  let normalized, budget;
  try {
    shape(config, Object.keys(defaults), 'budget'); budget = { ...defaults, ...config };
    for (const value of Object.values(budget)) if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) fail('Budgets must be positive bounded integers');
    normalized = normalize(input, budget);
    result.programFingerprint = digest(normalized.program);
    result.inputFingerprint = digest({ epoch: normalized.epoch, facts: normalized.facts });
    result.stats.inputFacts = normalized.facts.length;
  } catch (error) { result.diagnostics.push({ code: 'INVALID_INPUT', message: error.message }); return finish(); }
  try {
    const query = compile(normalized, budget);
    const remainingMs = budget.timeoutMs - (runtime.now() - start);
    if (remainingMs <= 0) fail('Inference timeout before native evaluation');
    query.script = query.script.replace(/:timeout [\d.]+\n/, `:timeout ${remainingMs / 1000}\n`);
    query.timeoutMs = remainingMs;
    const rows = (await runtime.evaluate(query)).rows;
    if (!Array.isArray(rows)) fail('Backend returned invalid rows');
    const facts = new Map(), supports = new Map(), inputs = new Map(normalized.facts.map(f => [f.id, f]));
    const relations = new Map(normalized.program.relations.map(r => [r.name, r.arity]));
    const rules = new Map(normalized.program.rules.map(r => [r.id, r]));
    const decoded = (relation, tuple) => {
      if (!relations.has(relation) || !Array.isArray(tuple) || tuple.length !== relations.get(relation)) fail('Invalid fact row');
      const values = tuple.map(value => {
        if (typeof value !== 'string') fail('Invalid encoded scalar');
        const parsed = JSON.parse(value);
        if (!scalar(parsed) || JSON.stringify(parsed) !== value) fail('Invalid canonical scalar');
        return parsed;
      });
      const id = factId(relation, values);
      return inputs.get(id) || { id, relation, values, sources: [] };
    };
    let limited = rows.length > budget.maxFacts + budget.maxSupports;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 6) fail('Invalid backend row arity');
      const [kind, ruleId, relation, tuple, premiseRows, absentRows] = row;
      if (!Array.isArray(premiseRows) || !Array.isArray(absentRows)) fail('Invalid support group');
      const conclusion = decoded(relation, tuple);
      if (kind === 'fact') {
        if (ruleId !== '' || premiseRows.length || absentRows.length) fail('Invalid fact witness');
        if (!facts.has(conclusion.id) && facts.size >= budget.maxFacts) { limited = true; continue; }
        facts.set(conclusion.id, conclusion);
      } else if (kind === 'support') {
        const rule = rules.get(ruleId);
        if (!rule || rule.head.relation !== relation || premiseRows.length !== rule.body.filter(a => !a.not).length || absentRows.length !== rule.body.filter(a => a.not).length) fail('Invalid rule witness');
        const premises = premiseRows.map(([rel, values]) => decoded(rel, values));
        const absences = absentRows.map(([rel, values]) => { const fact = decoded(rel, values); return { relation: rel, values: fact.values }; });
        const needed = new Map([conclusion, ...premises].map(f => [f.id, f]));
        if (supports.size >= budget.maxSupports || facts.size + [...needed.keys()].filter(id => !facts.has(id)).length > budget.maxFacts) { limited = true; continue; }
        for (const [id, fact] of needed) facts.set(id, fact);
        const support = { ruleId, conclusion: conclusion.id, premises: premises.map(f => f.id), absences };
        const id = digest(support); supports.set(id, { id, ...support });
      } else fail('Unknown backend row kind');
    }
    result.facts = [...facts.values()].sort((a, b) => a.id.localeCompare(b.id));
    result.supports = [...supports.values()].sort((a, b) => a.id.localeCompare(b.id));
    result.status = limited ? 'incomplete' : 'complete';
    if (limited) result.diagnostics.push({ code: 'OUTPUT_BUDGET', message: 'Fact or support budget exhausted; results are partial.' });
    if (runtime.now() - start > budget.timeoutMs) {
      result.status = 'incomplete';
      result.diagnostics.push({ code: 'TIMEOUT', message: 'Inference processing exceeded its epoch time budget.' });
    }
  } catch (error) {
    result.status = 'incomplete';
    result.diagnostics.push({ code: /timeout|timed out|killed/i.test(error.message || error.display || '') ? 'TIMEOUT' : 'BACKEND_ERROR', message: error.message || error.display || String(error) });
  }
  return finish();
}

function explain(result, id) {
  const facts = new Map(result.facts.map(f => [f.id, f])), byConclusion = new Map();
  for (const support of result.supports) {
    const list = byConclusion.get(support.conclusion) || []; list.push(support); byConclusion.set(support.conclusion, list);
  }
  const visited = new Set(), supports = new Map(), pending = [id];
  while (pending.length) {
    const current = pending.pop(); if (visited.has(current) || !facts.has(current)) continue;
    visited.add(current);
    for (const support of byConclusion.get(current) || []) { supports.set(support.id, support); pending.push(...support.premises); }
  }
  return { factId: id, epoch: result.epoch, programFingerprint: result.programFingerprint, inputFingerprint: result.inputFingerprint, facts: [...visited].sort().map(key => facts.get(key)), supports: [...supports.values()].sort((a, b) => a.id.localeCompare(b.id)), complete: result.status === 'complete' && visited.has(id) };
}
module.exports = { infer, factId, explain };
