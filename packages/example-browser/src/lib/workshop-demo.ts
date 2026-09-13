/** Shared demo selection for Ontology Workshop pages */

import { ref, watch } from "vue";
import { fetchDemos, type Demo } from "./api";

const STORAGE_KEY = "workshop.demoId";

export const workshopDemos = ref<Demo[]>([]);
export const workshopDemoId = ref<string>(localStorage.getItem(STORAGE_KEY) || "crm");
export const workshopDemosLoading = ref(false);
export const workshopDemosError = ref<string | null>(null);

let loadPromise: Promise<void> | null = null;

export async function ensureWorkshopDemos(): Promise<Demo[]> {
  if (workshopDemos.value.length) return workshopDemos.value;
  if (loadPromise) {
    await loadPromise;
    return workshopDemos.value;
  }
  workshopDemosLoading.value = true;
  workshopDemosError.value = null;
  loadPromise = (async () => {
    try {
      const demos = await fetchDemos();
      workshopDemos.value = demos;
      if (!demos.some((d) => d.id === workshopDemoId.value) && demos[0]) {
        workshopDemoId.value = demos[0].id;
      }
    } catch (err: any) {
      workshopDemosError.value = err?.message || String(err);
    } finally {
      workshopDemosLoading.value = false;
    }
  })();
  await loadPromise;
  return workshopDemos.value;
}

watch(workshopDemoId, (id) => {
  if (id) localStorage.setItem(STORAGE_KEY, id);
});

export function setWorkshopDemoId(id: string) {
  workshopDemoId.value = id;
}
