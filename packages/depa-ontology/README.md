# depa-ontology

`depa-ontology` contains the Depa object-model and ontology runtime. It deliberately
does not contain native database loading: `depa-cozo@0.1.3` supplies `CozoDb` and
`CozoTx`, while the independently publishable `depa-datalog` package supplies the
portable CozoScript/Datalog query builder.

The exported `om` namespace holds object-model operations; the exported `dsl`
namespace is re-exported for application convenience. Applications that only need
query construction can depend on `depa-datalog` directly and do not need a native
database package.

## OntologyProjection export

Use `om.exportOntologyProjection(runner, options?)` to emit a deterministic
OntologyProjection IR (types, attributes with optional `statusLike` /
`enumHints`, relations, behaviors, gaps) suitable for workbench product-form
selection. Set `includeEnumHintsFromInstances: true` to sample distinct values
from status-like attributes on stored entities.
