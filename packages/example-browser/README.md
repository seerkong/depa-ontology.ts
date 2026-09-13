# DEPA Ontology Example Browser

Private Vue 3 + Vite browser for the `depa-ontology` examples. It consumes the
adjacent `packages/example-server` package over HTTP.

## Product: Ontology Workshop

The default app experience is **Ontology Workshop** — an Object Explorer /
pipeline shell driven by `om.exportOntologyProjection` and workshop entity APIs.

| Route | Purpose |
|-------|---------|
| `/workshop` | Overview — types, relations, statusLike pipeline signals |
| `/workshop/objects/:typeName?` | Object list for a type |
| `/workshop/objects/:typeName/:entityId` | Object detail + incoming/outgoing links |
| `/workshop/pipeline` | Kanban from `statusLike` attributes + `enumHints` |

Sidebar **Demo** selector switches CRM / HR / Procurement (and other demos).
Pipeline boards work for:

- CRM — `Lead.status`, `Opportunity.stage`
- HR — `ReviewCycle.status`
- Procurement — `PurchaseOrder.status`

Legacy spreadsheet tooling remains under **Tools → Ontology Demo** (`/ontology`),
plus Permission / Governance / Schema pages.

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

Open http://localhost:4174/workshop (default `/` redirects there). The browser
uses http://127.0.0.1:4175 as its default API base. Override with `VITE_API_BASE`:

```bash
VITE_API_BASE=http://localhost:9000 npm run dev --workspace=depa-example-browser
```

## Build

```bash
npm run build --workspace=depa-example-browser
npm run preview --workspace=depa-example-browser
```

## Workshop API smoke

With example-server running on `:4175`:

```bash
npm run smoke:workshop --workspace=depa-example-browser
# or: API_BASE=http://127.0.0.1:4175 bash packages/example-browser/scripts/smoke-workshop-apis.sh
```

Curls four endpoints (demos list, CRM projection, Opportunity list, Opportunity detail)
and exits non-zero on failure. A copy also lives under
`Picasso/overnight/smoke-workshop-apis.sh`.

Server unit tests (bun):

```bash
npm test --workspace=depa-example-server
# includes src/workshop-api.test.js
```

## Architecture

```
src/
  layouts/WorkshopShell.vue   — Workshop sidebar + demo selector
  pages/workshop/*.vue        — Overview / Objects / Detail / Pipeline
  lib/api.ts                  — API types + fetch helpers (incl. workshop)
  lib/workshop-demo.ts        — shared demo selection state
  pages/OntologyDemo.vue      — Legacy spreadsheet demo (toolbar + Univer)
  components/
    UniverWorkbook.vue         — UniverJS spreadsheet (6 sheets)
    QueryInspector.vue         — Collapsible query meaning + DSL panel
    ResultTable.vue            — @tanstack/vue-table result grid
    TreeView.vue               — Tree visualization
    GraphView.vue              — vis-network graph visualization
    SchemaGraphView.vue        — Object-relation schema graph
    ResultTabs.vue             — Tab switcher (对象关系 / 列表 / 树 / 图)
```

## API Contract

### Workshop (Object Explorer)

- `GET /api/demos` → `{ demos: Demo[] }`
- `GET /api/demos/:id/projection` → `{ status, projection }` — OntologyProjection
- `GET /api/demos/:id/objects/:typeName` → `{ status, typeName, entities }`
- `GET /api/demos/:id/objects/:typeName/:entityId` → `{ status, entity }`

### Legacy ontology spreadsheet

- `GET /api/demos` → `{ demos: Demo[] }` — list of demos with tables and queries
- `POST /api/run` → `RunResponse` — execute a query against edited spreadsheet data

Each demo has separate workbook data (Procurement/HR/CRM are distinct demos).
Switching demo in Workshop or Ontology Demo swaps the active ontology slice.
