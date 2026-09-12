# depa-inference-capsule

A public finite Datalog inference runtime for macOS arm64 Node.js and Bun. The capsule assembles native-free contract/logic packages with the Cozo support adapter. It never owns or modifies application facts.

```js
const { createInferenceCapsule, factId, explain } = require('depa-inference-capsule');
const result = await createInferenceCapsule().infer({
  epoch: 'preview-1',
  program: {
    id: 'dependency-rules', version: '1',
    relations: [{ name: 'depends', arity: 2 }, { name: 'invalid', arity: 1 }],
    rules: [{
      id: 'propagate',
      head: { relation: 'invalid', terms: [{ var: 'child' }] },
      body: [
        { relation: 'depends', terms: [{ var: 'child' }, { var: 'parent' }] },
        { relation: 'invalid', terms: [{ var: 'parent' }] }
      ]
    }]
  },
  facts: [
    { relation: 'invalid', values: ['parent'], source: 'input:diagnostic-1' },
    { relation: 'depends', values: ['child', 'parent'], source: 'input:dependency-1' }
  ]
});
if (result.status !== 'complete') throw new Error(JSON.stringify(result.diagnostics));
const proof = explain(result, factId('invalid', ['child']));
```

Each support identifies one rule instance, its conclusion and the complete AND group of direct premises. Different supports are alternative proofs. Explanations return a finite graph, retaining cycle edges without recursively expanding paths. Both results and explanations carry epoch, program fingerprint (including rule version), and input fingerprint (including sources). These bind absent-input evidence to a specific closed input set.

V1 accepts scalar constants and variables bound by positive body atoms. Values are finite numbers, strings, booleans or null; negative zero is rejected. Tuple IDs hash canonical structured tuples, preserving scalar types and avoiding delimiter collisions. Unknown fields, wrong arity, unsafe variable binding, negative recursion and negation of any derived relation are rejected. Negation is limited to frozen input-only relations. Functions, aggregate value generation, arbitrary rule callbacks and domain writes are excluded from this rule protocol.

Every call snapshots its input and uses an isolated native worker process with a disposable mem database. It waits for process exit before returning, including on timeout. No query survives a timeout result. This adds process startup overhead and provides a termination boundary around native cooperative cancellation. Native dependencies remain confined to the support/capsule packages.

Defaults: 10,000 input facts, 256 rules, 20,000 output facts, 50,000 supports, 5,000ms epoch budget. Pass `budget` to `createInferenceCapsule` to change them. `invalid` means input/program validation failed before effects. `incomplete` means timeout, output limits or backend failure; partial facts/supports cannot justify a successful application operation. Runtime memory is measured but no hard native memory quota is claimed.

Tests measure 100/1,000/10,000 input facts. High fanout at 10,000 and chains through 1,000 must complete within 5 seconds. A 10,000-node chain intentionally has a 1-second termination budget and must return incomplete/TIMEOUT within 5 seconds. This is a bounded failure acceptance, not a claim of complete large-chain inference.

Run `npm run test:inference` and `npm run test:inference:package` at the workspace root. Package validation installs tarballs into an isolated consumer and checks declarations plus Node.js/Bun execution; it does not publish packages.

## Candidate dependency closure

The 0.1.0 inference packages depend on depa-datalog 0.1.1 and depa-cozo 0.1.1 through their declared semver dependencies. Install all six candidate tarballs into an isolated private consumer until those versions are published. A locally generated candidate lock records real tarball URLs and integrity; it is not evidence of registry publication. Public package manifests retain semver dependencies.
