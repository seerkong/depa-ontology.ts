process.env.WORKSHOP_PERSIST = process.env.WORKSHOP_PERSIST || '0';
const { test, expect } = require("bun:test");

const { createApp } = require("./index");

async function requestJson(app, method, path, body) {
  const init = {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await app.handle(new Request("http://localhost" + path, init));
  const data = await res.json();
  return { res, data };
}

const CRM_FQNS = [
  "ontology.crm.op.CreateLead",
  "ontology.crm.op.AdvanceOpportunityStage",
  "ontology.crm.op.LinkLeadToOpportunity",
];

test("operations API: CRM list returns 3 ops with expected fqns and entry", async () => {
  const { app, close } = createApp();
  try {
    const list = await requestJson(app, "GET", "/api/demos/crm/operations");
    expect(list.res.status).toBe(200);
    expect(list.data.status).toBe("ok");
    expect(Array.isArray(list.data.operations)).toBe(true);
    const fqns = list.data.operations.map((o) => o.fqn);
    for (const fqn of CRM_FQNS) {
      expect(fqns).toContain(fqn);
    }
    expect(list.data.operations.length).toBeGreaterThanOrEqual(3);
    const create = list.data.operations.find((o) => o.fqn === "ontology.crm.op.CreateLead");
    expect(create.entry).toBe("effect");
    const advance = list.data.operations.find((o) => o.fqn === "ontology.crm.op.AdvanceOpportunityStage");
    expect(advance.entry).toBe("addressed");
  } finally {
    close();
  }
});

test("operations API: GET detail by FQN", async () => {
  const { app, close } = createApp();
  try {
    const fqn = "ontology.crm.op.CreateLead";
    const detail = await requestJson(
      app,
      "GET",
      "/api/demos/crm/operations/" + encodeURIComponent(fqn),
    );
    expect(detail.res.status).toBe(200);
    expect(detail.data.status).toBe("ok");
    expect(detail.data.operation.fqn).toBe(fqn);
    expect(detail.data.operation.entry).toBe("effect");
    expect(detail.data.operation.ownerType).toBe("Lead");
    expect(detail.data.operation.inputSchema && typeof detail.data.operation.inputSchema === "object").toBe(true);
  } finally {
    close();
  }
});

test("operations API: invoke CreateLead then Lead list includes entity", async () => {
  const { app, close } = createApp();
  try {
    const label = "Test Lead " + Date.now();
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.CreateLead",
      input: { label, source: "website", status: "new", score: 55 },
    });
    expect(invoke.res.status).toBe(200);
    expect(invoke.data.status).toBe("ok");
    expect(invoke.data.ok).toBe(true);
    expect(invoke.data.result && typeof invoke.data.result.id === "string").toBe(true);
    const newId = invoke.data.result.id;

    const list = await requestJson(app, "GET", "/api/demos/crm/objects/Lead");
    expect(list.data.status).toBe("ok");
    const ids = list.data.entities.map((e) => e.id);
    expect(ids).toContain(newId);
    const created = list.data.entities.find((e) => e.id === newId);
    expect(created.label).toBe(label);
    expect(created.properties.source).toBe("website");
  } finally {
    close();
  }
});

test("operations API: invoke AdvanceOpportunityStage updates stage via payload", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.AdvanceOpportunityStage",
      selector: { kind: "one", objectType: "Opportunity", id: "opp:acme-renew" },
      invocation: {
        type: "Opportunity.advanceStage",
        kind: "action",
        payload: { stage: "negotiation" },
      },
    });
    expect(invoke.res.status).toBe(200);
    expect(invoke.data.status).toBe("ok");
    expect(invoke.data.ok).toBe(true);

    const detail = await requestJson(
      app,
      "GET",
      "/api/demos/crm/objects/Opportunity/" + encodeURIComponent("opp:acme-renew"),
    );
    expect(detail.data.status).toBe("ok");
    expect(detail.data.entity.properties.stage).toBe("negotiation");
  } finally {
    close();
  }
});

test("operations API: invoke LinkLeadToOpportunity succeeds with payload", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.LinkLeadToOpportunity",
      selector: { kind: "one", objectType: "Lead", id: "lead:expo-mfg" },
      invocation: {
        type: "Lead.linkToOpportunity",
        kind: "action",
        payload: { opportunityId: "opp:globex-new" },
      },
    });
    expect(invoke.res.status).toBe(200);
    expect(invoke.data.status).toBe("ok");
    expect(invoke.data.ok).toBe(true);
    expect(Array.isArray(invoke.data.result.linked)).toBe(true);
    expect(invoke.data.result.linked[0].relName).toBe("converts_to");

    const detail = await requestJson(
      app,
      "GET",
      "/api/demos/crm/objects/Lead/" + encodeURIComponent("lead:expo-mfg"),
    );
    expect(detail.data.status).toBe("ok");
    const out = detail.data.entity.outgoing || [];
    const hit = out.find(
      (e) => e.relName === "converts_to" && (e.toId === "opp:globex-new" || e.entityId === "opp:globex-new"),
    );
    expect(!!hit).toBe(true);
  } finally {
    close();
  }
});

test("operations API: entry mismatch rejected", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.CreateLead",
      entry: "addressed",
      input: { label: "x", source: "y" },
    });
    expect(invoke.res.status).toBe(200);
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.status).toBe("rejected");
    expect(invoke.data.rejected.code).toBe("ENTRY_MISMATCH");
  } finally {
    close();
  }
});

test("operations API: effect rejects selector/invocation bag", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.CreateLead",
      input: { label: "x", source: "y" },
      selector: { kind: "one", objectType: "Lead", id: "lead:x" },
    });
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.rejected.code).toBe("ENTRY_MISMATCH");
  } finally {
    close();
  }
});

test("operations API: flat invocation rejected", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.AdvanceOpportunityStage",
      selector: { kind: "one", objectType: "Opportunity", id: "opp:acme-renew" },
      invocation: { stage: "negotiation" },
    });
    expect(invoke.res.status).toBe(200);
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.status).toBe("rejected");
    expect(["INVALID_INVOCATION", "VALIDATION"]).toContain(invoke.data.rejected.code);
  } finally {
    close();
  }
});

test("operations API: missing invocation.type rejected", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.AdvanceOpportunityStage",
      selector: { kind: "one", objectType: "Opportunity", id: "opp:acme-renew" },
      invocation: { payload: { stage: "negotiation" } },
    });
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.rejected.code).toBe("VALIDATION");
    expect(String(invoke.data.rejected.message)).toContain("type");
  } finally {
    close();
  }
});

test("operations API: wrong invocation.type rejected", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.AdvanceOpportunityStage",
      selector: { kind: "one", objectType: "Opportunity", id: "opp:acme-renew" },
      invocation: {
        type: "Opportunity.wrongType",
        payload: { stage: "negotiation" },
      },
    });
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.rejected.code).toBe("INVOCATION_TYPE_MISMATCH");
  } finally {
    close();
  }
});

test("operations API: unknown fqn rejected", async () => {
  const { app, close } = createApp();
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.DoesNotExist",
      input: {},
    });
    expect(invoke.res.status).toBe(200);
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.status).toBe("rejected");
    expect(invoke.data.rejected.code).toBe("UNKNOWN_OPERATION");
  } finally {
    close();
  }
});

test("operations API: HR SetReviewCycleStatus uses addressed envelope", async () => {
  const { app, close } = createApp();
  try {
    const list = await requestJson(app, "GET", "/api/demos/hr/operations");
    expect(list.data.status).toBe("ok");
    const op = list.data.operations.find((o) => o.fqn === "ontology.hr.op.SetReviewCycleStatus");
    expect(op).toBeTruthy();
    expect(op.entry).toBe("addressed");

    const detail = await requestJson(
      app,
      "GET",
      "/api/demos/hr/operations/" + encodeURIComponent("ontology.hr.op.SetReviewCycleStatus"),
    );
    expect(detail.data.operation.entry).toBe("addressed");
    expect(detail.data.operation.expectedInvocationType).toBe("ReviewCycle.setStatus");
  } finally {
    close();
  }
});

test("operations API: Procurement SetPurchaseOrderStatus uses addressed envelope", async () => {
  const { app, close } = createApp();
  try {
    const list = await requestJson(app, "GET", "/api/demos/procurement/operations");
    expect(list.data.status).toBe("ok");
    const op = list.data.operations.find((o) => o.fqn === "ontology.procurement.op.SetPurchaseOrderStatus");
    expect(op).toBeTruthy();
    expect(op.entry).toBe("addressed");

    const detail = await requestJson(
      app,
      "GET",
      "/api/demos/procurement/operations/" +
        encodeURIComponent("ontology.procurement.op.SetPurchaseOrderStatus"),
    );
    expect(detail.data.operation.entry).toBe("addressed");
    expect(detail.data.operation.expectedInvocationType).toBe("PurchaseOrder.setStatus");
  } finally {
    close();
  }
});
