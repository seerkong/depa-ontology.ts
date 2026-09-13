<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  fetchDemoProjection,
  fetchObjectsByType,
  type OntologyProjection,
  type OntologyProjectionType,
  type WorkshopEntitySummary,
} from "../../lib/api";
import { ensureWorkshopDemos, workshopDemoId } from "../../lib/workshop-demo";

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const error = ref<string | null>(null);
const projection = ref<OntologyProjection | null>(null);
const entities = ref<WorkshopEntitySummary[]>([]);

const typeName = computed(() => {
  const raw = route.params.typeName;
  return typeof raw === "string" && raw.length ? raw : null;
});

const types = computed(() => projection.value?.types || []);
const selectedType = computed<OntologyProjectionType | null>(() => {
  if (!typeName.value || !projection.value) return null;
  return projection.value.types.find((t) => t.name === typeName.value) || null;
});

const attrCols = computed(() => {
  const t = selectedType.value;
  if (!t) return [] as string[];
  return t.attributes.slice(0, 6).map((a) => a.name);
});

async function loadProjection() {
  projection.value = await fetchDemoProjection(workshopDemoId.value);
  const names = projection.value.types.map((t) => t.name);
  if (!typeName.value && names[0]) {
    await router.replace(`/workshop/objects/${encodeURIComponent(names[0])}`);
    return;
  }
  // Demo switch: current type may not exist in the new ontology.
  if (typeName.value && names.length && !names.includes(typeName.value)) {
    await router.replace(`/workshop/objects/${encodeURIComponent(names[0])}`);
  }
}

async function loadEntities() {
  if (!typeName.value) {
    entities.value = [];
    return;
  }
  if (projection.value && !selectedType.value) {
    entities.value = [];
    return;
  }
  entities.value = await fetchObjectsByType(workshopDemoId.value, typeName.value);
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await ensureWorkshopDemos();
    await loadProjection();
    await loadEntities();
  } catch (err: any) {
    error.value = err?.message || String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(workshopDemoId, load);
watch(typeName, async () => {
  loading.value = true;
  error.value = null;
  try {
    await loadEntities();
  } catch (err: any) {
    error.value = err?.message || String(err);
  } finally {
    loading.value = false;
  }
});

function formatVal(v: unknown) {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
</script>

<template>
  <div class="ws-page" data-testid="workshop-objects">
    <header class="ws-header">
      <div>
        <h1>Objects</h1>
        <p class="ws-muted">Browse entity types from the ontology projection</p>
      </div>
      <button
        v-if="!loading"
        type="button"
        class="ws-btn"
        data-testid="ws-objects-refresh"
        @click="load"
      >
        Refresh
      </button>
    </header>

    <div v-if="loading && !projection" class="ws-state" data-testid="ws-objects-loading">
      <div class="ws-spinner" aria-hidden="true" />
      <p>Loading types…</p>
    </div>
    <div v-else-if="error && !projection" class="ws-state ws-state-error" data-testid="ws-objects-error">
      <p class="ws-error">{{ error }}</p>
      <button type="button" class="ws-btn" @click="load">Retry</button>
    </div>

    <div v-else class="ws-layout">
      <aside class="ws-types">
        <div class="ws-panel-title">Types</div>
        <p v-if="!types.length" class="ws-muted ws-pad">No types in this demo.</p>
        <RouterLink
          v-for="t in types"
          :key="t.name"
          class="ws-type-item"
          :class="{ active: t.name === typeName }"
          :to="`/workshop/objects/${encodeURIComponent(t.name)}`"
          :data-testid="`ws-type-${t.name}`"
        >
          <span>{{ t.name }}</span>
          <span class="ws-type-meta">{{ t.attributes.length }} attrs</span>
        </RouterLink>
      </aside>

      <section class="ws-panel">
        <div class="ws-panel-title">
          <span>{{ typeName || "Select a type" }}</span>
          <span v-if="!loading" class="ws-count">{{ entities.length }} entities</span>
        </div>

        <div v-if="loading" class="ws-inline-state" data-testid="ws-objects-loading-inline">
          <div class="ws-spinner sm" aria-hidden="true" />
          <span>Loading entities…</span>
        </div>
        <div v-else-if="error" class="ws-inline-state error" data-testid="ws-objects-error-inline">
          <span class="ws-error">{{ error }}</span>
          <button type="button" class="ws-btn" @click="load">Retry</button>
        </div>
        <p v-else-if="!typeName" class="ws-muted ws-pad">Pick a type from the left.</p>
        <div v-else-if="!selectedType" class="ws-inline-state">
          <p class="ws-muted">
            Type <code>{{ typeName }}</code> is not in this demo.
            Switch Demo or pick another type.
          </p>
        </div>
        <div v-else class="ws-table-wrap">
          <table class="ws-table" data-testid="ws-entity-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Label</th>
                <th v-for="col in attrCols" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in entities" :key="e.id">
                <td>
                  <RouterLink
                    class="ws-link"
                    :to="`/workshop/objects/${encodeURIComponent(typeName!)}/${encodeURIComponent(e.id)}`"
                  >
                    {{ e.id }}
                  </RouterLink>
                </td>
                <td>{{ e.label }}</td>
                <td v-for="col in attrCols" :key="col">{{ formatVal(e.properties?.[col]) }}</td>
              </tr>
              <tr v-if="!entities.length">
                <td :colspan="2 + attrCols.length" class="ws-empty-cell">
                  No entities for this type yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
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
.ws-muted { color: #6b7280; font-size: 13px; }
.ws-error { color: #b91c1c; }
.ws-btn {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.ws-btn:hover { background: #f9fafb; }
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
.ws-inline-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 10px;
  color: #6b7280;
  font-size: 13px;
}
.ws-inline-state.error { color: #b91c1c; }
.ws-spinner {
  width: 22px;
  height: 22px;
  margin: 0 auto 10px;
  border: 2px solid #e5e7eb;
  border-top-color: #047857;
  border-radius: 50%;
  animation: ws-spin 0.7s linear infinite;
}
.ws-spinner.sm { width: 16px; height: 16px; margin: 0; }
@keyframes ws-spin { to { transform: rotate(360deg); } }
.ws-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 14px;
  margin-top: 16px;
  min-height: 420px;
}
.ws-types, .ws-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
}
.ws-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b7280;
  padding: 4px 6px 10px;
}
.ws-count { font-weight: 500; text-transform: none; letter-spacing: 0; }
.ws-pad { padding: 8px 10px; margin: 0; }
.ws-type-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: #111827;
  font-size: 13px;
}
.ws-type-item:hover { background: #f3f4f6; }
.ws-type-item.active { background: #ecfdf5; color: #047857; font-weight: 600; }
.ws-type-meta { color: #9ca3af; font-size: 11px; }
.ws-table-wrap { overflow: auto; }
.ws-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ws-table th, .ws-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: top;
}
.ws-table th {
  color: #6b7280;
  font-weight: 600;
  font-size: 12px;
}
.ws-empty-cell {
  color: #9ca3af;
  text-align: center !important;
  padding: 24px 10px !important;
}
.ws-link { color: #047857; text-decoration: none; font-weight: 600; }
.ws-link:hover { text-decoration: underline; }
code { font-size: 12px; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
@media (max-width: 860px) {
  .ws-layout { grid-template-columns: 1fr; }
}
</style>
