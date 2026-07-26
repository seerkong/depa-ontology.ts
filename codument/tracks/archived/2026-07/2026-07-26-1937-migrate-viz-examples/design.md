## 上下文

迁移输入是 `cozo-lib-bun-viz` 的 server、frontend、Playwright 配置和 e2e specs。当前 workspace 已具备目标公开 API：`depa-ontology` 同时导出 `CozoDb`、`om` 和 `dsl`，因此 server 不再需要旧 `cozo-lib-bun` 或跨仓库 `file:` 依赖。

本 track 是“复制并适配”迁移。源目录保持不变，目标 workspace 成为后续维护者。

## 方案概览

1. 建立 `packages/example-server`
   - 复制 `server/src/**`、server README 与测试。
   - 包名改为 `depa-example-server`，保持 `private: true`。
   - scripts 包含 `dev`、`start`、`test`。
   - 依赖使用 `depa-ontology: "0.1.0"`、`elysia` 和 `@elysiajs/cors`。
   - 将源码和测试中的 `require("cozo-lib-bun")` 全部改为 `require("depa-ontology")`。
2. 建立 `packages/example-browser`
   - 复制 frontend 的 HTML、Vue/TypeScript 源码、Vite 配置与 README。
   - 包名改为 `depa-example-browser`，保持 `private: true`。
   - 保留四个路由和全部组件；API base 仍默认为 `http://127.0.0.1:4175`。
3. 把 e2e 归入 browser 包
   - 复制三个 `*.pw.ts` 到 `packages/example-browser/e2e`。
   - 把 Playwright 配置放到 browser 包根，`testDir` 指向 `./e2e`。
   - backend 的 cwd 通过 config 文件目录解析到 `../example-server`，frontend cwd 为 browser 包本身，避免依赖调用者当前目录。
   - browser package 提供 `test:e2e`、`test:e2e:ui`、`test:e2e:debug` 和 `install:browsers`。
4. 统一 workspace 生命周期
   - 根 `npm install` 维护唯一 `package-lock.json`，不保留目标子包 lockfile。
   - 根 scripts 暴露 server test、browser build 和 e2e；默认 `npm test` 至少覆盖 ontology 与 example-server。
   - 根 README 说明两个示例包、启动方式、端口与验证命令。
   - `.gitignore` 排除 `dist/`、`test-results/`、`playwright-report/` 和 Playwright 本地产物。
5. 验证
   - 先运行 server Bun tests，确保依赖迁移没有 API 漂移。
   - 运行 browser production build，确保 Vue/TypeScript 依赖完整。
   - 运行 Playwright Chromium 全量 e2e，验证 browser-server-ontology-native 完整链路。
   - 复跑根级 ontology tests，确认 workspace 依赖和脚本调整没有回归。

## 影响范围与修改点（Impact）

- 根 workspace：`package.json`、`package-lock.json`、`README.md`、`.gitignore`
- server：`packages/example-server/package.json`、`README.md`、`src/**`
- browser：`packages/example-browser/package.json`、`README.md`、Vite/TS 配置、`src/**`、`playwright.config.ts`、`e2e/**`

## 决策摘要

- 详见 `decisions.xnl`。
- 新示例包均为 private，不进入 npm 发布序列。
- 源目录保留不动，迁移后的 workspace 版本成为维护真源。
- server 只从 `depa-ontology` 公共入口消费数据库、本体和 Datalog API。
- Playwright 的配置、依赖、脚本与 specs 全部归 browser 包。

## 风险 / 权衡

- `depa-ontology` 与旧 `cozo-lib-bun` 的实现已有演进差异 → 以 server tests 和完整 e2e 暴露兼容缺口，只修复新包边界下的真实不兼容。
- 原 browser 依赖较多且存在独立 Bun lock → 统一改用根 npm lock 后必须通过 production build 和 Playwright 验证。
- Playwright webServer 的 cwd 容易受启动位置影响 → 从配置文件自身目录解析 server/browser 绝对 cwd。
- 原 e2e 使用固定端口 → 继续使用 4174/4175 和 strictPort，失败时明确暴露端口冲突。
- repo 当前没有首个 Git commit → modeling base 记为 `UNBORN`，首次归档时按初始 registry 合并处理。

## 兼容性设计

- API 路径、请求/响应形状、browser routes 和默认端口不变。
- 源 `cozo-lib-bun-viz` 不做删除或重定向，因此旧仓库使用者不受本次写入影响。
- private example 包不改变已发布 `depa-datalog` 的公共契约。

## 迁移计划

1. 建立目标目录并复制受管源码/测试/文档。
2. 更新包名、依赖、imports、脚本和相对路径。
3. 更新根 workspace 配置并重新生成 npm lockfile。
4. 执行 server test、browser build、ontology test。
5. 执行 Playwright Chromium e2e，修复迁移产生的兼容 gap。
6. 校验 track，完成后进入独立 verify 与归档流程。

## 回滚

迁移只新增目标包并更新当前 workspace 配置。回滚时可移除两个新增 package，并恢复根级配置；外部源目录始终保持完整。

## 待解决问题

- 提交模式与最终校验模式等待用户在批准提案时选择。
