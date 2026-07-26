# 设计

`depa-datalog` 没有原生依赖，可独立发布。`depa-ontology` 通过公开入口重导出 `om`、`dsl` 和来自 `depa-cozo` 的 `CozoDb`/`CozoTx`，但本身不实现数据库加载。这样消费者可按需只安装 DSL，也可安装完整对象模型。

旧 `cozodb-wrapper` 测试验证的是实际 native wrapper API（数据库、事务、备份、命名规则），因此迁至薄 `depa-cozo`；它不属于 `depa-ontology` 的对象建模契约。DSL 测试则归 `depa-datalog`，避免将无 native 依赖的语言层错误绑定至 ontology 包。
