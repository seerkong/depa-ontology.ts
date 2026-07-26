# depa-ontology

`depa-ontology` contains the Depa object-model and ontology runtime. It deliberately
does not contain native database loading: `depa-cozo@0.1.0` supplies `CozoDb` and
`CozoTx`, while the independently publishable `depa-datalog` package supplies the
portable CozoScript/Datalog query builder.

The exported `om` namespace holds object-model operations; the exported `dsl`
namespace is re-exported for application convenience. Applications that only need
query construction can depend on `depa-datalog` directly and do not need a native
database package.
