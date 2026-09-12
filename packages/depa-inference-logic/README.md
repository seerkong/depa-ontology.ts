# depa-inference-logic

`infer(runtime, input, budget)` validates and snapshots a finite rule program, compiles with depa-datalog, invokes the supplied evaluate effect and returns typed complete/incomplete/invalid results. `runtime.now` supplies the clock. Facts and derivations are deterministic values; the package neither imports a native driver nor owns application facts.

`factId` hashes a canonical typed relation tuple. `explain` collects the finite reachable support graph, including alternative and cyclic supports, and returns epoch/program/input provenance. All premises within one support are AND; distinct support records are OR. Negative premises are only allowed on frozen input-only relations and are retained as grounded absence witnesses.

Input-only relations compile directly as inline data; adding a Horn alias before recursive consumption causes major avoidable native query overhead. Derived relations retain separate seeds to allow recursive Horn definitions. Rule conditions permit no generative function or host callback.
