# depa-inference-cozo-support

The `evaluate({script, params, timeoutMs})` effect runs one immutable Cozo query in a child process with a fresh mem database. It waits for result and process exit. Timeout kills and reaps the child before rejecting. `worker.js` is included in the package. Node.js/Bun macOS arm64 use the `depa-cozo` native dependency; other platforms are outside this release acceptance.

The adapter owns only disposable runtime state. It contains no domain rules, object model, organizational authority, or mutation commit logic. The logic package compiles the safe rule subset and supplies its remaining epoch deadline. Native CozoScript is evaluated with immutable=true, so the inference path cannot mutate stored relations.

The 0.1.0 support package requires depa-cozo 0.1.1. Its package verification must use that exact installed candidate or a supplied native tarball; an older installed artifact is not accepted as proof.
