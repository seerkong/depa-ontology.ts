# 变更：提取 Bun 对象建模包

## 背景和动机 (Context And Why)

将原 `cozo-lib-bun` 中不属于原生薄封装的 DSL 和对象建模能力迁至独立仓库，使 `depa-cozo` 保持原生 ABI 边界。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- 发布 `depa-datalog` 与 `depa-ontology` 两个 Bun 包。
- `depa-ontology` 依赖已发布的 `depa-cozo@0.1.0`。
- 保留对象模型测试并验证实际 npm 依赖。

**非目标:**

- 不在本 track 发布 npm 包。
- 不在本仓库复制原生二进制或 N-API 实现。

## 变更内容（What Changes）

- 拆出可移植 DSL 和对象模型包。
- 删除误迁入的旧底层 wrapper 测试。

## 测试迁移记录

- DSL builder 契约归属 `depa-datalog`，迁移后 52 项测试通过。
- OM 回归归属 `depa-ontology`，265 项测试通过。
- 历史 `cozodb-wrapper` 是 native wrapper API 契约，归属薄 `depa-cozo`，不进入 ontology 包；在该包的 Bun 测试中与 native-path 测试合计 16 项通过。

## 影响范围（Impact）

- 受影响的能力（behaviors）：depa-ontology
- 受影响的代码：packages/depa-datalog、packages/depa-ontology
