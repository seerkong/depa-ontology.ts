<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchDemoProjection,
  fetchObjectsByType,
  type OntologyProjection,
  type WorkshopEntitySummary,
} from "../../lib/api";
import { ensureWorkshopDemos, workshopDemoId } from "../../lib/workshop-demo";

type BoardSpec = {
  typeName: string;
  attrName: string;
  columns: string[];
};

const loading = ref(false);
const error = ref<string | null>(null);
const projection = ref<OntologyProjection | null>(null);
const boards = ref<Array<{ spec: BoardSpec; columns: Record<string, WorkshopEntitySummary[]> }>>([]);
const selectedKey = ref<string>("");

const boardOptions = computed(() => {
  const p = projection.value;
  if (!p) return [] as BoardSpec[];
  const out: BoardSpec[] = [];
  for (const t of p.types) {
    for (const a of t.attributes) {
      if (!a.statusLike) continue;
      const columns = a.enumHints?.length ? [...a.enumHints] : ["(unset)"];
      out.push({ typeName: t.name, attrName: a.name, columns });
    }
  }
  return out;
});

const selectedBoard = computed(() => boards.value.find((b) => `${b.spec.typeName}.${b.spec.attrName}` === selectedKey.value) || null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await ensureWorkshopDemos();
    projection.value = await fetchDemoProjection(workshopDemoId.value);
    const options = boardOptions.value;
    if (!options.length) {
      boards.value = [];
      selectedKey.value = "";
      return;
    }
    if (!options.some((o) => `${o.typeName}.${o.attrName}` === selectedKey.value)) {
      selectedKey.value = `${options[0].typeName}.${options[0].attrName}`;
    }
    const built = [];
    for (const spec of options) {
      const entities = await fetchObjectsByType(workshopDemoId.value, spec.typeName);
      const columns: Record<string, WorkshopEntitySummary[]> = {};
      for (const c of spec.columns) columns[c] = [];
      const otherKey = "(other)";
      columns[otherKey] = [];
      for (const e of entities) {
        const raw = e.properties?.[spec.attrName];
        const val = raw == null || raw === "" ? null : String(raw);
        if (val == null) {
          if (columns["(unset)"]) columns["(unset)"].push(e);
          else columns[otherKey].push(e);
        } else if (columns[val]) {
          columns[val].push(e);
        } else {
          columns[otherKey].push(e);
        }
      }
      if (!columns[otherKey].length) delete columns[otherKey];
      built.push({ spec, columns });
    }
    boards.value = built;
  } catch (err: any) {
    error.value = err?.message || String(err);
    boards.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(workshopDemoId, () => {
  selectedKey.value = "";
  void load();
});

const visibleColumns = computed(() => {
  const b = selectedBoard.value;
  if (!b) return [] as Array<{ key: string; entities: WorkshopEntitySummary[] }>;
  return Object.keys(b.columns).map((key) => ({ key, entities: b.columns[key] }));
});

const totalCards = computed(() =>
  visibleColumns.value.reduce((n, c) => n + c.entities.length, 0),
);
</script>

<template>
  <div class="ws-page" data-testid="workshop-pipeline">
    <header class="ws-header">
      <div>
        <h1>Pipeline</h1>
        <p class="ws-muted">Kanban from statusLike attributes + enumHints</p>
      </div>
      <div class="ws-header-actions">
        <select
          v-if="boardOptions.length"
          class="ws-select"
          data-testid="ws-pipeline-board"
          v-model="selectedKey"
        >
          <option v-for="o in boardOptions" :key="`${o.typeName}.${o.attrName}`" :value="`${o.typeName}.${o.attrName}`">
            {{ o.typeName }}.{{ o.attrName }}
          </option>
        </select>
        <button
          v-if="!loading"
          type="button"
          class="ws-btn"
          data-testid="ws-pipeline-refresh"
          @click="load"
        >
          Refresh
        </button>
      </div>
    </header>

    <div v-if="loading" class="ws-state" data-testid="ws-pipeline-loading">
      <div class="ws-spinner" aria-hidden="true" />
      <p>Loading pipeline…</p>
    </div>
    <div v-else-if="error" class="ws-state ws-state-error" data-testid="ws-pipeline-error">
      <p class="ws-error">{{ error }}</p>
      <button type="button" class="ws-btn" @click="load">Retry</button>
    </div>
    <div v-else-if="!boardOptions.length" class="ws-state" data-testid="ws-pipeline-empty">
      <p class="ws-muted">
        No statusLike attributes in this demo’s projection.
      </p>
      <p class="ws-hint">
        Try <strong>CRM</strong> (Lead.status / Opportunity.stage),
        <strong>HR</strong> (ReviewCycle.status), or
        <strong>Procurement</strong> (PurchaseOrder.status) from the Demo selector.
      </p>
    </div>

    <template v-else>
      <p class="ws-board-meta">
        {{ selectedKey }} · {{ totalCards }} cards · {{ visibleColumns.length }} columns
      </p>
      <div class="ws-board" data-testid="ws-kanban">
        <div v-for="col in visibleColumns" :key="col.key" class="ws-column">
          <div class="ws-column-title">
            <span>{{ col.key }}</span>
            <span class="ws-badge">{{ col.entities.length }}</span>
          </div>
          <div
            v-for="e in col.entities"
            :key="e.id"
            class="ws-card-item"
          >
            <RouterLink
              class="ws-link"
              :to="`/workshop/objects/${encodeURIComponent(selectedBoard!.spec.typeName)}/${encodeURIComponent(e.id)}`"
            >
              {{ e.label || e.id }}
            </RouterLink>
            <div class="ws-card-id">{{ e.id }}</div>
          </div>
          <p v-if="!col.entities.length" class="ws-empty">Empty</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ws-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.ws-header h1 { margin: 0 0 4px; font-size: 22px; }
.ws-header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ws-muted { color: #6b7280; font-size: 13px; }
.ws-error { color: #b91c1c; margin: 0 0 8px; }
.ws-hint { color: #6b7280; font-size: 13px; margin: 8px 0 0; line-height: 1.5; }
.ws-btn {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.ws-btn:hover { background: #f9fafb; }
.ws-select {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
}
.ws-state {
  margin-top: 24px;
  padding: 28px 20px;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  background: #fff;
  text-align: center;
  color: #6b7280;
  font-size: 13px;
}
.ws-state-error { border-color: #fecaca; background: #fef2f2; }
.ws-spinner {
  width: 22px;
  height: 22px;
  margin: 0 auto 10px;
  border: 2px solid #e5e7eb;
  border-top-color: #047857;
  border-radius: 50%;
  animation: ws-spin 0.7s linear infinite;
}
@keyframes ws-spin { to { transform: rotate(360deg); } }
.ws-board-meta {
  margin: 12px 0 0;
  font-size: 12px;
  color: #6b7280;
}
.ws-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  margin-top: 12px;
  padding-bottom: 8px;
}
.ws-column {
  min-width: 220px;
  max-width: 260px;
  background: #eef2f7;
  border-radius: 10px;
  padding: 10px;
  box-sizing: border-box;
}
.ws-column-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #4b5563;
  margin-bottom: 8px;
}
.ws-badge {
  background: #fff;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  color: #6b7280;
}
.ws-card-item {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}
.ws-card-id { font-size: 11px; color: #9ca3af; margin-top: 4px; }
.ws-link { color: #047857; text-decoration: none; font-weight: 600; font-size: 13px; }
.ws-link:hover { text-decoration: underline; }
.ws-empty { color: #9ca3af; font-size: 12px; margin: 8px 0; }
</style>
