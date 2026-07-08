/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */
const files = new Map();   // key -> File
const urls  = new Set();   // string URLs

/* ------------------------------------------------------------------ */
/* DOM refs                                                             */
/* ------------------------------------------------------------------ */
const form           = document.getElementById("analyze-form");
const dropZone       = document.getElementById("drop-zone");
const fileInput      = document.getElementById("file-input");
const fileChips      = document.getElementById("file-chips");
const urlInput       = document.getElementById("url-input");
const addUrlBtn      = document.getElementById("add-url-btn");
const urlChips       = document.getElementById("url-chips");
const textInput      = document.getElementById("text-input");
const instructInput  = document.getElementById("instructions-input");
const formError      = document.getElementById("form-error");
const submitBtn      = document.getElementById("submit-btn");
const submitLabel    = document.getElementById("submit-label");
const submitSpinner  = document.getElementById("submit-spinner");
const statusText     = document.getElementById("status-text");
const inputPanel     = document.getElementById("input-panel");
const resultsPanel   = document.getElementById("results-panel");
const newAnalysisBtn = document.getElementById("new-analysis-btn");
const summaryText    = document.getElementById("summary-text");
const categoriesList = document.getElementById("categories-list");
const clarificationsCard = document.getElementById("clarifications-card");
const clarificationsList = document.getElementById("clarifications-list");
const itemsCard      = document.getElementById("items-card");
const itemsList      = document.getElementById("items-list");
const rawText        = document.getElementById("raw-text");

/* ------------------------------------------------------------------ */
/* Health check                                                         */
/* ------------------------------------------------------------------ */
async function loadHealth() {
  try {
    const r = await fetch("/health");
    const d = await r.json();
    statusText.textContent = d.ok
      ? `Provider: ${d.provider} · Model: ${d.model}`
      : "Server unavailable";
  } catch {
    statusText.textContent = "Server unavailable";
  }
}

/* ------------------------------------------------------------------ */
/* File handling                                                        */
/* ------------------------------------------------------------------ */
function addFiles(fileList) {
  for (const f of fileList) {
    files.set(`${f.name}__${f.lastModified}`, f);
  }
  renderFileChips();
}

function renderFileChips() {
  fileChips.innerHTML = "";
  for (const [key, f] of files) {
    fileChips.appendChild(makeChip(truncate(f.name, 28), () => {
      files.delete(key);
      renderFileChips();
    }));
  }
}

/* ------------------------------------------------------------------ */
/* URL handling                                                         */
/* ------------------------------------------------------------------ */
function addUrl(raw) {
  const val = raw.trim();
  if (!val) return;
  try { new URL(val); } catch { showFormError("Invalid URL: " + val); return; }
  urls.add(val);
  urlInput.value = "";
  renderUrlChips();
}

function renderUrlChips() {
  urlChips.innerHTML = "";
  for (const u of urls) {
    urlChips.appendChild(makeChip(truncate(u, 42), () => {
      urls.delete(u);
      renderUrlChips();
    }));
  }
}

/* ------------------------------------------------------------------ */
/* Chip factory                                                         */
/* ------------------------------------------------------------------ */
function makeChip(label, onRemove) {
  const chip = document.createElement("span");
  chip.className = "chip";

  const lbl = document.createElement("span");
  lbl.className = "chip__label";
  lbl.title = label;
  lbl.textContent = label;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip__remove";
  btn.textContent = "×";
  btn.setAttribute("aria-label", "Remove");
  btn.addEventListener("click", onRemove);

  chip.appendChild(lbl);
  chip.appendChild(btn);
  return chip;
}

/* ------------------------------------------------------------------ */
/* Drop zone events                                                     */
/* ------------------------------------------------------------------ */
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

fileInput.addEventListener("change", () => { if (fileInput.files.length) addFiles(fileInput.files); });

/* ------------------------------------------------------------------ */
/* URL add button / enter key                                           */
/* ------------------------------------------------------------------ */
addUrlBtn.addEventListener("click", () => addUrl(urlInput.value));
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addUrl(urlInput.value); } });

/* ------------------------------------------------------------------ */
/* Form submission                                                      */
/* ------------------------------------------------------------------ */
form.addEventListener("submit", async e => {
  e.preventDefault();
  hideFormError();

  if (files.size === 0 && urls.size === 0 && !textInput.value.trim()) {
    showFormError("Add at least one file, URL, or context text.");
    return;
  }

  setLoading(true);
  try {
    const body = buildFormData();
    const res = await fetch("/analyze", { method: "POST", body });
    const data = await res.json();

    if (!res.ok) {
      showFormError(data.error || `Server error ${res.status}`);
      return;
    }
    renderResults(data);
    resultsPanel.removeAttribute("hidden");
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showFormError(err.message || "Network error");
  } finally {
    setLoading(false);
  }
});

function buildFormData() {
  const fd = new FormData();
  for (const [, f] of files) fd.append("file", f, f.name);
  for (const u of urls) fd.append("url", u);
  const text = textInput.value.trim();
  if (text) fd.append("text", text);
  const instr = instructInput.value.trim();
  if (instr) fd.append("instructions", instr);
  return fd;
}

/* ------------------------------------------------------------------ */
/* Results rendering                                                    */
/* ------------------------------------------------------------------ */
function renderResults(data) {
  summaryText.textContent = data.summary || "(no summary)";

  categoriesList.innerHTML = "";
  const cats = data.categories ?? [];
  if (cats.length === 0) {
    categoriesList.textContent = "None identified.";
  } else {
    for (const cat of cats) {
      categoriesList.appendChild(makeTag(cat));
    }
  }

  const clarifications = data.clarifications ?? [];
  if (clarifications.length) {
    clarificationsList.innerHTML = "";
    for (const c of clarifications) {
      clarificationsList.appendChild(makeClarificationCard(c));
    }
    clarificationsCard.removeAttribute("hidden");
  } else {
    clarificationsCard.setAttribute("hidden", "");
  }

  const items = data.items ?? [];
  if (items.length) {
    itemsList.innerHTML = "";
    for (const item of items) {
      itemsList.appendChild(makeItemCard(item));
    }
    itemsCard.removeAttribute("hidden");
  } else {
    itemsCard.setAttribute("hidden", "");
  }

  rawText.textContent = data.rawAssistantMessage || "(none)";
}

function makeTag(cat) {
  const conf = (cat.confidence ?? "").toLowerCase();
  const cls  = ["high", "medium", "low"].includes(conf) ? conf : "default";
  const tag  = document.createElement("span");
  tag.className = `tag tag--${cls}`;
  tag.textContent = cat.name ?? cat;
  if (conf) {
    const badge = document.createElement("span");
    badge.className = "tag__badge";
    badge.textContent = conf;
    tag.appendChild(badge);
  }
  return tag;
}

function makeClarificationCard(c) {
  const details = document.createElement("details");
  details.className = "clarification";

  const summary = document.createElement("summary");
  summary.className = "clarification__header";
  summary.textContent = c.issue ?? "Clarification";
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "clarification__body";

  if (c.bestEffortInterpretation) {
    body.appendChild(makeField("Best-effort interpretation", c.bestEffortInterpretation));
  }
  if (c.whatWouldHelp) {
    body.appendChild(makeField("What would help", c.whatWouldHelp));
  }

  details.appendChild(body);
  return details;
}

function makeField(label, value) {
  const div = document.createElement("div");
  div.className = "clarification__field";
  div.innerHTML = `<strong>${escHtml(label)}</strong>${escHtml(value)}`;
  return div;
}

function makeItemCard(item) {
  const card = document.createElement("div");
  card.className = "item-card";

  const header = document.createElement("div");
  header.className = "item-card__header";

  const src = document.createElement("span");
  src.className = "item-card__source";
  src.textContent = item.source ?? "unknown";

  const mime = document.createElement("span");
  mime.className = "item-card__mime";
  mime.textContent = item.mimeType ?? "";

  header.appendChild(src);
  if (item.mimeType) header.appendChild(mime);
  card.appendChild(header);

  if (item.summary) {
    const s = document.createElement("p");
    s.className = "item-card__summary";
    s.textContent = item.summary;
    card.appendChild(s);
  }

  if (item.categories?.length) {
    const tags = document.createElement("div");
    tags.className = "tag-list";
    for (const c of item.categories) {
      const t = document.createElement("span");
      t.className = "tag tag--default";
      t.textContent = c;
      tags.appendChild(t);
    }
    card.appendChild(tags);
  }

  return card;
}

/* ------------------------------------------------------------------ */
/* New analysis                                                         */
/* ------------------------------------------------------------------ */
newAnalysisBtn.addEventListener("click", () => {
  resultsPanel.setAttribute("hidden", "");
  inputPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ------------------------------------------------------------------ */
/* Utilities                                                            */
/* ------------------------------------------------------------------ */
function setLoading(on) {
  submitBtn.disabled = on;
  submitLabel.textContent = on ? "Analyzing…" : "Analyze";
  submitSpinner.hidden = !on;
}

function showFormError(msg) {
  formError.textContent = msg;
  formError.removeAttribute("hidden");
}

function hideFormError() {
  formError.setAttribute("hidden", "");
  formError.textContent = "";
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, n) {
  return str.length <= n ? str : str.slice(0, n - 1) + "…";
}

/* ------------------------------------------------------------------ */
/* Init                                                                 */
/* ------------------------------------------------------------------ */
loadHealth();
