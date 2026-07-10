// Simple frontend JavaScript to interact with the Revenue Ops API
const baseUrl = window.location.origin;

function logOutput(id, data) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = JSON.stringify(data, null, 2);
}

async function checkHealth() {
  try {
    const r = await fetch("/health");
    const d = await r.json();
    logOutput("health-output", d);
  } catch (e) {
    logOutput("health-output", { error: e.message });
  }
}

async function sendEvent() {
  try {
    const bodyText = document.getElementById("event-body").value;
    const body = JSON.parse(bodyText);
    const r = await fetch("/events", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)});
    const d = await r.json();
    logOutput("event-output", d);
  } catch (e) {
    logOutput("event-output", { error: e.message });
  }
}

async function runRetention() {
  try {
    const id = document.getElementById("retention-id").value.trim();
    if (!id) throw new Error("Account ID required");
    const r = await fetch(`/run/retention/${encodeURIComponent(id)}`, { method: "POST" });
    const d = await r.json();
    logOutput("retention-output", d);
  } catch (e) {
    logOutput("retention-output", { error: e.message });
  }
}

async function runCollections() {
  try {
    const id = document.getElementById("collection-id").value.trim();
    if (!id) throw new Error("Debtor ID required");
    const r = await fetch(`/run/collections/${encodeURIComponent(id)}`, { method: "POST" });
    const d = await r.json();
    logOutput("collections-output", d);
  } catch (e) {
    logOutput("collections-output", { error: e.message });
  }
}

async function getCase() {
  try {
    const id = document.getElementById("case-id").value.trim();
    if (!id) throw new Error("Case ID required");
    const r = await fetch(`/cases/${encodeURIComponent(id)}`);
    const d = await r.json();
    logOutput("case-output", d);
  } catch (e) {
    logOutput("case-output", { error: e.message });
  }
}

async function fetchKpis() {
  try {
    const r = await fetch("/kpis");
    const d = await r.json();
    logOutput("kpis-output", d);
  } catch (e) {
    logOutput("kpis-output", { error: e.message });
  }
}

// Expose functions to global scope for inline onclick handlers
window.checkHealth = checkHealth;
window.sendEvent = sendEvent;
window.runRetention = runRetention;
window.runCollections = runCollections;
window.getCase = getCase;
window.fetchKpis = fetchKpis;
