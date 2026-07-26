# Depa Ontology for Bun

本 npm workspace 包含两个公共库和两个私有示例应用：

| 包 | 可发布 | 职责 |
| --- | --- | --- |
| `depa-datalog` | 是 | 可移植的 CozoScript/Datalog 查询构造，无原生依赖 |
| `depa-ontology` | 是 | 对象模型与本体运行时，聚合 `depa-datalog` 与 `depa-cozo@0.1.0` |
| `depa-example-server` | 否 | Bun/Elysia 示例 API，通过 `depa-ontology` 展示 ontology、permission、governance 和 schema 能力 |
| `depa-example-browser` | 否 | Vue/Vite 示例界面，并拥有 Playwright 配置、依赖和全部 e2e specs |

先发布 `depa-datalog`，再发布 `depa-ontology`。`npm run pack:dry-run` 只检查这两个公共包；两个 example 包保持 `private: true`。本仓库不包含 native artifact，数据库加载由已发布的 `depa-cozo` 负责。

## 安装与验证

在 workspace 根目录安装依赖，根 `package-lock.json` 是四个 workspace 包的唯一 npm lockfile：

```bash
npm install
npm test
```

默认 `npm test` 依次运行 `depa-datalog`、`depa-ontology` 和 `depa-example-server` 的 Bun tests，不自动运行耗时较长的 Playwright e2e。

| 命令 | 用途 |
| --- | --- |
| `npm run test:datalog` | 运行 Datalog 单元测试 |
| `npm run test:ontology` | 运行 ontology 单元测试 |
| `npm run test:server` | 运行 example-server 测试 |
| `npm run build:browser` | 执行 example-browser production build |
| `npm run install:browsers` | 安装 Playwright Chromium |
| `npm run test:e2e` | 由 example-browser 运行完整 Playwright e2e |
| `npm run test:e2e:ui` | 以 Playwright UI 模式运行 e2e |
| `npm run pack:dry-run` | dry-run 检查两个公共 npm 包 |

e2e 的配置、三个 specs、Playwright 依赖和测试脚本都归 `packages/example-browser` 所有；测试会启动 browser、server，并验证 browser → server → ontology → native binding 的完整链路。

## 本地开发

分别在两个终端启动后端和前端：

```bash
npm run dev:server
npm run dev:browser
```

- example-browser 默认监听 `http://127.0.0.1:4174`。
- example-server 默认监听 `http://127.0.0.1:4175`。
- browser 默认请求 `http://127.0.0.1:4175`；可以在启动或构建时用 `VITE_API_BASE` 覆盖，例如 `VITE_API_BASE=http://127.0.0.1:4175 npm run dev:browser`。
- `npm run start:server` 以非 watch 模式启动 server；`npm run preview:browser` 预览 production build。

`depa-cozo@0.1.0` 的当前 native package 仅支持 macOS arm64。因此，真实加载 CozoDB 的 ontology/server 测试和完整 e2e 需要在 macOS arm64 上运行；不触发 native 加载的 `depa-datalog` 测试与 browser 静态构建不受此约束。
