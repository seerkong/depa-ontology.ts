<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { fetchObjectDetail, type WorkshopEntityDetail } from "../../lib/api";
import { ensureWorkshopDemos, workshopDemoId } from "../../lib/workshop-demo";

const route = useRoute();
const loading = ref(false);
const error = ref<string | null>(null);
const entity = ref<WorkshopEntityDetail | null>(null);

const typeName = computed(() => String(route.params.typeName || ""));
const entityId = computed(() => String(route.params.entityId || ""));

const propertyEntries = computed(() => {
  const props = entity.value?.properties || {};
  return Object.keys(props)
    .sort()
    .map((k) => ({ key: k, value: props[k] }));
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await ensureWorkshopDemos();
    entity.value = await fetchObjectDetail(workshopDemoId.value, typeName.value, entityId.value);
  } catch (err: any) {
    error.value = err?.message || String(err);
    entity.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch([workshopDemoId, typeName, entityId], load);

function formatVal(v: unknown) {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}
</script>

<template>
  <div class="ws-page" data-testid="workshop-object-detail">
    <div class="ws-crumb">
      <RouterLink to="/workshop/objects">Objects</RouterLink>
      <span>/</span>
      <RouterLink :to="`/workshop/objects/${encodeURIComponent(typeName)}`">{{ typeName }}</RouterLink>
      <span>/</span>
      <span>{{ entityId }}</span>
    </div>

    <div v-if="loading" class="ws-state" data-testid="ws-detail-loading">
      <div class="ws-spinner" aria-hidden="true" />
      <p>Loading entity…</p>
    </div>
    <div v-else-if="error" class="ws-state ws-state-error" data-testid="ws-detail-error">
      <p class="ws-error">{{ error }}</p>
      <button type="button" class="ws-btn" @click="load">Retry</button>
      <p class="ws-hint">
        If you switched Demo, this id may belong to another ontology —
        go back to
        <RouterLink :to="`/workshop/objects/${encodeURIComponent(typeName)}`">{{ typeName || "Objects" }}</RouterLink>.
      </p>
    </div>
    <div v-else-if="!entity" class="ws-state" data-testid="ws-detail-empty">
      <p class="ws-muted">Entity not found.</p>
    </div>

    <template v-else>
      <header class="ws-header">
        <div>
          <h1>{{ entity.label || entity.id }}</h1>
          <p class="ws-muted">{{ entity.typeName }} · {{ entity.id }}</p>
        </div>
        <button type="button" class="ws-btn" data-testid="ws-detail-refresh" @click="load">
          Refresh
        </button>
      </header>

      <div class="ws-grid">
        <section class="ws-card">
          <h2>Attributes</h2>
          <dl v-if="propertyEntries.length" class="ws-dl">
            <template v-for="p in propertyEntries" :key="p.key">
              <dt>{{ p.key }}</dt>
              <dd><pre>{{ formatVal(p.value) }}</pre></dd>
            </template>
          </dl>
          <p v-else class="ws-muted">No properties on this entity.</p>
        </section>

        <section class="ws-card">
          <h2>Outgoing links</h2>
          <ul v-if="entity.outgoing?.length" class="ws-list">
            <li v-for="(l, i) in entity.outgoing" :key="'o' + i">
              <code>{{ l.relName }}</code>
              →
              <RouterLink
                class="ws-link"
                :to="`/workshop/objects/${encodeURIComponent(l.toType)}/${encodeURIComponent(l.toId)}`"
              >
                {{ l.toLabel || l.toId }}
              </RouterLink>
              <span class="ws-muted"> ({{ l.toType }})</span>
            </li>
          </ul>
          <p v-else class="ws-muted">No outgoing links.</p>
        </section>

        <section class="ws-card">
          <h2>Incoming links</h2>
          <ul v-if="entity.incoming?.length" class="ws-list">
            <li v-for="(l, i) in entity.incoming" :key="'i' + i">
              <RouterLink
                class="ws-link"
                :to="`/workshop/objects/${encodeURIComponent(l.fromType)}/${encodeURIComponent(l.fromId)}`"
              >
                {{ l.fromLabel || l.fromId }}
              </RouterLink>
              <span class="ws-muted"> ({{ l.fromType }})</span>
              →
              <code>{{ l.relName }}</code>
            </li>
          </ul>
          <p v-else class="ws-muted">No incoming links.</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ws-crumb {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 12px;
}
.ws-crumb a { color: #047857; text-decoration: none; }
.ws-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.ws-header h1 { margin: 0 0 4px; font-size: 22px; }
.ws-muted { color: #6b7280; font-size: 13px; }
.ws-error { color: #b91c1c; margin: 0 0 8px; }
.ws-hint { color: #6b7280; font-size: 12px; margin: 12px 0 0; }
.ws-hint a { color: #047857; }
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
  margin-top: 16px;
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
.ws-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
  margin-top: 16px;
}
.ws-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px 16px;
}
.ws-card h2 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ws-dl {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 13px;
}
.ws-dl dt { color: #6b7280; font-weight: 600; }
.ws-dl dd { margin: 0; }
.ws-dl pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.ws-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
}
.ws-link { color: #047857; text-decoration: none; font-weight: 600; }
.ws-link:hover { text-decoration: underline; }
code { font-size: 12px; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
</style>
