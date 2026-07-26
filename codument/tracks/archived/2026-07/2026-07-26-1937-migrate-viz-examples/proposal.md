# 变更：迁移可视化示例应用

## 背景和动机 (Context And Why)

`cozo-lib-bun` 已拆分为底层 `depa-cozo`、可移植 `depa-datalog` 和当前 workspace 的 `depa-ontology`。原 `cozo-lib-bun-viz` 仍依赖旧的一体化包和源仓库相对路径，无法作为新包边界的可运行示例与端到端验收。需要把它迁入当前 npm workspace，并让后端只依赖 `depa-ontology` 的公开入口。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- 将完整 server、server tests 和 demo 数据迁移到 `packages/example-server`。
- 将完整 Vue/Vite 前端迁移到 `packages/example-browser`。
- 将 Playwright 配置与 e2e specs 迁移到 `packages/example-browser`。
- 用 `depa-ontology@0.1.0` 替换全部 `cozo-lib-bun` 引用。
- 由根 npm workspace 统一安装、构建和执行 server/browser/e2e 验证。
- 保持原 API、四个浏览器页面和 14 个 e2e 场景的行为。

**非目标:**

- 不删除或修改 `/Users/kongweixian/infra-dev/cozodb/cozo/cozo-lib-bun-viz`。
- 不迁移 `node_modules`、build output、Playwright test-results 或源目录独立 lockfile。
- 不重新设计页面视觉、API 协议、demo 内容或 ontology 行为。
- 不发布 `example-server` 或 `example-browser` 到 npm；两者保持 `private: true`。
- 不在本 track 发布 `depa-ontology`。

## 变更内容（What Changes）

- 新增 `packages/example-server`，复制 server 源码、README 与 Bun tests。
- 新增 `packages/example-browser`，复制 frontend 源码、配置和 README。
- 将顶层 Playwright 配置和 `e2e/*.pw.ts` 收入 `packages/example-browser`。
- 更新包名、scripts、Playwright 相对路径和文档中的旧目录名。
- server 依赖改为 `depa-ontology: "0.1.0"`，源码和测试改从 `depa-ontology` 导入。
- 更新根级 scripts、`package-lock.json`、README 与 `.gitignore`，支持统一验证且排除 browser 构建和 Playwright 产物。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`example-viz`
- 受影响的代码：根 `package.json`、`package-lock.json`、`README.md`、`.gitignore`、`packages/example-server/**`、`packages/example-browser/**`
- 新增运行时依赖：Elysia、CORS、Vue/Vite 可视化依赖
- 新增开发依赖：Playwright Chromium 测试工具链
- 平台约束：真实 server/e2e 验证继承 `depa-cozo@0.1.0` 的 macOS arm64 限制
