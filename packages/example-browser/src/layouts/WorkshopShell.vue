<script setup lang="ts">
import { onMounted, computed } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import {
  ensureWorkshopDemos,
  workshopDemoId,
  workshopDemos,
  workshopDemosError,
  workshopDemosLoading,
  setWorkshopDemoId,
} from "../lib/workshop-demo";

const route = useRoute();

onMounted(() => {
  void ensureWorkshopDemos();
});

const navItems = computed(() => [
  { to: "/workshop", label: "Overview", exact: true, testid: "ws-nav-home" },
  { to: "/workshop/objects", label: "Objects", exact: false, testid: "ws-nav-objects" },
  { to: "/workshop/pipeline", label: "Pipeline", exact: false, testid: "ws-nav-pipeline" },
]);

const toolLinks = [
  { to: "/ontology", label: "Ontology Demo" },
  { to: "/permission", label: "Permission" },
  { to: "/governance", label: "Governance" },
  { to: "/schema", label: "Schema" },
];

function isActive(to: string, exact: boolean) {
  if (exact) return route.path === to;
  return route.path === to || route.path.startsWith(to + "/");
}
</script>

<template>
  <div class="ws-shell" data-testid="workshop-shell">
    <aside class="ws-sidebar">
      <div class="ws-brand">
        <div class="ws-brand-title">Ontology Workshop</div>
        <div class="ws-brand-sub">Object Explorer</div>
      </div>

      <label class="ws-demo-label">
        Demo
        <select
          class="ws-demo-select"
          data-testid="ws-demo-select"
          :value="workshopDemoId"
          :disabled="workshopDemosLoading"
          @change="setWorkshopDemoId(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="d in workshopDemos" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
      </label>
      <p v-if="workshopDemosError" class="ws-error">{{ workshopDemosError }}</p>

      <nav class="ws-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="ws-nav-item"
          :class="{ active: isActive(item.to, item.exact) }"
          :data-testid="item.testid"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="ws-section-label">Tools</div>
      <nav class="ws-nav">
        <RouterLink
          v-for="link in toolLinks"
          :key="link.to"
          :to="link.to"
          class="ws-nav-item muted"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </aside>

    <main class="ws-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.ws-shell {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #f5f6f8;
  color: #111827;
}

.ws-sidebar {
  width: 232px;
  flex-shrink: 0;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}

.ws-brand-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.ws-brand-sub {
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
}

.ws-demo-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ws-demo-select {
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #111827;
}

.ws-section-label {
  margin-top: 8px;
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 8px;
}

.ws-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ws-nav-item {
  padding: 8px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: #374151;
  font-size: 13px;
  font-weight: 500;
}

.ws-nav-item:hover {
  background: #f3f4f6;
}

.ws-nav-item.active {
  background: #ecfdf5;
  color: #047857;
}

.ws-nav-item.muted {
  color: #6b7280;
  font-weight: 400;
}

.ws-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 20px 24px;
  box-sizing: border-box;
}

.ws-error {
  color: #b91c1c;
  font-size: 12px;
  margin: 0;
}
</style>
