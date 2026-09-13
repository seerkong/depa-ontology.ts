process.env.WORKSHOP_PERSIST = process.env.WORKSHOP_PERSIST || '0';
const { test, expect } = require("bun:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("./index");

async function requestJson(app, method, pathName, body) {
  const init = {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await app.handle(new Request("http://localhost" + pathName, init));
  const data = await res.json();
  return { res, data };
}

test("operations API: expanded CRM fqns include CreateOpportunity SetLeadStatus CreateAccount", async () => {
  const { app, close } = createApp({ workshop: { persist: false } });
  try {
    const list = await requestJson(app, "GET", "/api/demos/crm/operations");
    expect(list.data.status).toBe("ok");
    const fqns = list.data.operations.map((o) => o.fqn);
    expect(fqns).toContain("ontology.crm.op.CreateOpportunity");
    expect(fqns).toContain("ontology.crm.op.SetLeadStatus");
    expect(fqns).toContain("ontology.crm.op.CreateAccount");
  } finally {
    close();
  }
});

test("operations API: invoke CreateOpportunity / SetLeadStatus / CreateAccount", async () => {
  const { app, close } = createApp({ workshop: { persist: false } });
  try {
    const opp = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.CreateOpportunity",
      input: { label: "Persist Deal", amount: 12000, stage: "qualify" },
    });
    expect(opp.data.ok).toBe(true);
    expect(opp.data.result.typeName).toBe("Opportunity");

    const acct = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.CreateAccount",
      input: { label: "NewCo", industry: "logistics", tier: "A" },
    });
    expect(acct.data.ok).toBe(true);
    expect(acct.data.result.typeName).toBe("Account");

    const status = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.SetLeadStatus",
      selector: { kind: "one", objectType: "Lead", id: "lead:web-ship" },
      invocation: { type: "Lead.setStatus", kind: "action", payload: { status: "qualified" } },
    });
    expect(status.data.ok).toBe(true);

    const detail = await requestJson(
      app,
      "GET",
      "/api/demos/crm/objects/Lead/" + encodeURIComponent("lead:web-ship"),
    );
    expect(detail.data.entity.properties.status).toBe("qualified");
  } finally {
    close();
  }
});

test("operations API: HR CreateEmployee and Procurement CreatePurchaseOrder", async () => {
  const { app, close } = createApp({ workshop: { persist: false } });
  try {
    const emp = await requestJson(app, "POST", "/api/demos/hr/invoke", {
      fqn: "ontology.hr.op.CreateEmployee",
      input: { label: "测试员工", email: "test@example.com", salary: 99000 },
    });
    expect(emp.data.ok).toBe(true);
    expect(emp.data.result.typeName).toBe("Employee");

    const po = await requestJson(app, "POST", "/api/demos/procurement/invoke", {
      fqn: "ontology.procurement.op.CreatePurchaseOrder",
      input: { label: "PO Test", total_amount: 3333, status: "draft" },
    });
    expect(po.data.ok).toBe(true);
    expect(po.data.result.typeName).toBe("PurchaseOrder");
  } finally {
    close();
  }
});

test("operations API: DispatchEngine routes unknown fqn to UNKNOWN_OPERATION", async () => {
  const { app, close } = createApp({ workshop: { persist: false } });
  try {
    const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
      fqn: "ontology.crm.op.DoesNotExist",
      input: {},
    });
    expect(invoke.data.ok).toBe(false);
    expect(invoke.data.rejected.code).toBe("UNKNOWN_OPERATION");
  } finally {
    close();
  }
});

test("workshop persistence: CreateLead survives close + reopen same dataDir", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-persist-"));
  const label = "Persisted Lead " + Date.now();
  let newId;

  {
    const { app, close } = createApp({
      workshop: { persist: true, dataDir, engine: "sqlite" },
    });
    try {
      const invoke = await requestJson(app, "POST", "/api/demos/crm/invoke", {
        fqn: "ontology.crm.op.CreateLead",
        input: { label, source: "website", status: "new" },
      });
      expect(invoke.data.ok).toBe(true);
      newId = invoke.data.result.id;
    } finally {
      close();
    }
  }

  {
    const { app, close } = createApp({
      workshop: { persist: true, dataDir, engine: "sqlite" },
    });
    try {
      const list = await requestJson(app, "GET", "/api/demos/crm/objects/Lead");
      expect(list.data.status).toBe("ok");
      const ids = list.data.entities.map((e) => e.id);
      expect(ids).toContain(newId);
      const created = list.data.entities.find((e) => e.id === newId);
      expect(created.label).toBe(label);
      expect(fs.existsSync(path.join(dataDir, "crm.db"))).toBe(true);
    } finally {
      close();
    }
  }
});
