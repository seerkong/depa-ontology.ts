# DEPA Ontology Example Browser

Private Vue 3 + Vite browser for the `depa-ontology` examples. It consumes the
adjacent `packages/example-server` package over HTTP and provides the ontology,
permission, governance, and schema example pages.

## Setup

Install workspace dependencies from the repository root:

```bash
npm install
```

## Development

Start the adjacent API server in one terminal:

```bash
npm run dev --workspace=depa-example-server
```

Start this browser in another terminal:

```bash
npm run dev --workspace=depa-example-browser
```

The browser opens at http://localhost:4174 and uses
http://127.0.0.1:4175 as its default API base. Override the backend URL with
`VITE_API_BASE` when needed:

```bash
VITE_API_BASE=http://localhost:9000 npm run dev --workspace=depa-example-browser
```

## Build

```bash
npm run build --workspace=depa-example-browser
npm run preview --workspace=depa-example-browser
```

## Architecture

```
src/
  lib/api.ts              — API types + fetch helpers
  pages/OntologyDemo.vue  — Main page (toolbar, spreadsheet, results)
  components/
    UniverWorkbook.vue     — UniverJS spreadsheet (6 sheets: 类型定义/属性定义/关系定义/实体数据/属性数据/边数据)
    QueryInspector.vue     — Collapsible query meaning + DSL panel
    ResultTable.vue        — @tanstack/vue-table result grid
    TreeView.vue           — Tree visualization
    GraphView.vue          — vis-network graph visualization
    SchemaGraphView.vue    — Object-relation schema graph
    ResultTabs.vue         — Tab switcher (对象关系 / 列表 / 树 / 图)
```

## API Contract

The browser uses the adjacent Elysia example server. Its primary ontology
endpoints are:

- `GET /api/demos` → `{ demos: Demo[] }` — list of demos with tables and queries
- `POST /api/run` → `RunResponse` — execute a query against edited spreadsheet data

Each demo has separate workbook data (Procurement/HR/CRM are distinct demos). Switching demo swaps the entire workbook content.
