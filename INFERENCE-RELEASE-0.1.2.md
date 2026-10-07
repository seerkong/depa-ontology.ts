# Inference public dependency closure 0.1.2

Nonbreaking release under the existing Codument quick workflow. The source already depends on depa-cozo 0.1.3; previously published inference support 0.1.1 still pointed to 0.1.2 (Darwin-only native payload). Publish support 0.1.2 with exact depa-cozo 0.1.3 and capsule 0.1.2 with exact support 0.1.2. Runtime JavaScript/declarations match previous public implementations after line ending normalization. Ontology models/example-server remain unchanged.

Actual source and separately installed exact tarballs pass all 15 inference/scale tests under Node and Bun, preserving recursion, multiple proof paths, frozen negation, hostile constants, invalid input, worker timeout, concurrency, fail-closed output and 100/1000/10000 scale assertions. Report E:/workbench/hr-ontology-workbench/.verification/inference-release-c624c667-7c1f-4bf8-9c09-613e4b9a7133/report.json.

Both exact tarballs were published via https://registry.npmjs.com and registry downloads byte-verified. Receipt E:/workbench/hr-ontology-workbench/.verification/dependency-publication-b8b20e92-0236-46aa-a152-0d9d61a41e6f/receipt.json. Package-lock workspace version/dependency metadata updated with the manifests. No domain/runtime algorithm changes.
