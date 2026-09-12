# depa-inference-contract

Native-free public data protocol for `depa.inference/v1`: scalar/term/atom/rule programs, epoch input, budget, runtime effect interface, derived facts, AND-group supports, results and explanations. Input facts may carry opaque source references. Applications own the referenced facts; this protocol expresses only frozen input and derived evidence.

Complete results are eligible for an application-specific validation decision. Incomplete or invalid results must not be treated as an empty successful conflict set. Application commands, mutations and replay policies remain outside the generic engine.
