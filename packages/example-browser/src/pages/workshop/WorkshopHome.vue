<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { fetchDemoProjection, type OntologyProjection } from "../../lib/api";
import { ensureWorkshopDemos, workshopDemoId, workshopDemos } from "../../lib/workshop-demo";

const loading = ref(false);
const error = ref<string | null>(null);
const projection = ref<OntologyProjection | null>(null);

const demoLabel = computed(
  () => workshopDemos.value.find((d) => d.id === workshopDemoId.value)?.label || workshopDemoId.value,
);

const statusLikeAttrs = computed(() => {
  const p = projection.value;
  if (!p) return [];
  const out: string[] = [];
  for (const t of p.types) {
    for (const a of t.attributes) {
      if (a.statusLike) out.push(`${t.name}.${a.name}`);
    }
  }
  return out;
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await ensureWorkshopDemos();
    projection.value = await fetchDemoProjection(workshopDemoId.value);
  } catch (err: any) {
    error.value = err?.message || String(err);
    projection.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(workshopDemoId, load);
</script>

<template>
  <div class="ws-page" data-testid="workshop-home">
    <header class="ws-header">
      <div>
        <h1>Workshop</h1>
        <p class="ws-muted">Ontology-driven Object Explorer · {{ demoLabel }}</p>
      </div>
      <button
        v-if="!loading"
        type="button"
        class="ws-btn"
        data-testid="ws-home-refresh"
        @click="load"
      >
        Refresh
      </button>
    </header>

    <div v-if="loading" class="ws-state" data-testid="ws-home-loading">
      <div class="ws-spinner" aria-hidden="true" />
      <p>Loading projection…</p>
    </div>
    <div v-else-if="error" class="ws-state ws-state-error" data-testid="ws-home-error">
      <p class="ws-error">{{ error }}</p>
      <button type="button" class="ws-btn" @click="load">Retry</button>
    </div>
    <div v-else-if="!projection || !projection.types.length" class="ws-state" data-testid="ws-home-empty">
      <p class="ws-muted">No types in this demo’s projection. Pick another Demo in the sidebar.</p>
    </div>

    <div v-else class="ws-grid">
      <section class="ws-card">
        <h2>Types</h2>
        <p class="ws-stat">{{ projection.types.length }}</p>
        <ul class="ws-list">
          <li v-for="t in projection.types" :key="t.name">
            <RouterLink :to="`/workshop/objects/${encodeURIComponent(t.name)}`">{{ t.name }}</RouterLink>
            <span v-if="t.description" class="ws-muted"> — {{ t.description }}</span>
          </li>
        </ul>
      </section>

      <section class="ws-card">
        <h2>Relations</h2>
        <p class="ws-stat">{{ projection.relations.length }}</p>
        <ul v-if="projection.relations.length" class="ws-list compact">
          <li v-for="r in projection.relations" :key="r.name">
            <code>{{ r.name }}</code>
            <span class="ws-muted"> {{ r.fromType }} → {{ r.toType }}</span>
          </li>
        </ul>
        <p v-else class="ws-muted">No relations defined.</p>
      </section>

      <section class="ws-card">
        <h2>Pipeline signals</h2>
        <p v-if="!statusLikeAttrs.length" class="ws-muted">
          No statusLike attributes. Try CRM, HR, or Procurement demos.
        </p>
        <ul v-else class="ws-list">
          <li v-for="a in statusLikeAttrs" :key="a">
            <RouterLink to="/workshop/pipeline">{{ a }}</RouterLink>
          </li>
        </ul>
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
.ws-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
}
.ws-muted { color: #6b7280; font-size: 13px; }
.ws-error { color: #b91c1c; margin: 0 0 8px; }
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
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
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
  margin: 0;
  font-size: 13px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ws-stat {
  font-size: 28px;
  font-weight: 700;
  margin: 8px 0 12px;
}
.ws-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
}
.ws-list.compact { font-size: 12px; }
.ws-list a { color: #047857; text-decoration: none; font-weight: 600; }
.ws-list a:hover { text-decoration: underline; }
code { font-size: 12px; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
</style>
