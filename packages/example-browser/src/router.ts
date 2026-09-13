import { createRouter, createWebHistory } from "vue-router";
import OntologyDemo from "./pages/OntologyDemo.vue";
import PermissionDemo from "./pages/PermissionDemo.vue";
import GovernanceDemo from "./pages/GovernanceDemo.vue";
import SchemaVersioningDemo from "./pages/SchemaVersioningDemo.vue";
import WorkshopShell from "./layouts/WorkshopShell.vue";
import WorkshopHome from "./pages/workshop/WorkshopHome.vue";
import WorkshopObjects from "./pages/workshop/WorkshopObjects.vue";
import WorkshopObjectDetail from "./pages/workshop/WorkshopObjectDetail.vue";
import WorkshopPipeline from "./pages/workshop/WorkshopPipeline.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/workshop" },
    {
      path: "/workshop",
      component: WorkshopShell,
      children: [
        { path: "", name: "workshop-home", component: WorkshopHome },
        {
          path: "objects/:typeName/:entityId",
          name: "workshop-object-detail",
          component: WorkshopObjectDetail,
        },
        { path: "objects/:typeName?", name: "workshop-objects", component: WorkshopObjects },
        { path: "pipeline", name: "workshop-pipeline", component: WorkshopPipeline },
      ],
    },
    { path: "/ontology", name: "ontology", component: OntologyDemo },
    { path: "/permission", name: "permission", component: PermissionDemo },
    { path: "/governance", name: "governance", component: GovernanceDemo },
    { path: "/schema", name: "schema", component: SchemaVersioningDemo },
  ],
});

export default router;
