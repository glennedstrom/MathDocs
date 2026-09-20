import { MathfieldElement } from "mathlive";
import "mathlive/fonts.css";
import html2canvas from "html2canvas";
import { registerSW } from "virtual:pwa-register";
import { checkInWorker } from "./checker/client";
import type { CheckResult } from "./checker/types";
import { parseEquationCsv, serializeEquationCsv } from "./csv";
import {
  createEmptyDocument,
  createId,
  loadDocument,
  saveDocument,
  type MathDocument,
} from "./storage";
import "./styles.css";

type RowState = CheckResult | { verdict: "checking"; message: string };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root is missing.");

let documentState: MathDocument = createEmptyDocument();
const rowStates = new Map<string, RowState>();
const rowGenerations = new Map<string, number>();
let referenceGeneration = 0;
let saveTimer: number | undefined;
let checkTimer: number | undefined;

app.innerHTML = `
  <header class="app-header">
    <a class="brand" href="/" aria-label="MathDocs home">
      <img src="/favicon.png" alt="" width="38" height="38" />
      <span>MathDocs</span>
    </a>
    <div class="header-actions">
      <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Switch to light theme">
        <span class="theme-icon" aria-hidden="true">☀</span>
        <span class="theme-label">Light</span>
      </button>
      <span class="offline-pill" id="network-status">Offline ready</span>
    </div>
  </header>

  <main>
    <section class="page-heading">
      <div>
        <p class="breadcrumb">Home&nbsp;&nbsp;/&nbsp;&nbsp;Workset</p>
        <h1>Workset</h1>
        <p>Each row is checked against the original expression.</p>
      </div>
      <div class="legend" aria-label="Result legend">
        <span><i class="dot equivalent"></i> Equivalent</span>
        <span><i class="dot not-equivalent"></i> Different</span>
        <span><i class="dot unknown"></i> Uncertain</span>
      </div>
    </section>

    <section class="toolbar" aria-label="Document controls">
      <label class="title-field">
        <span>Document</span>
        <input id="document-title" autocomplete="off" />
      </label>
      <label class="assumption-field">
        <span>Assumptions <small>(comma separated)</small></span>
        <input id="assumptions" placeholder="x>0, a\\ne0" autocomplete="off" />
      </label>
      <div class="toolbar-actions">
        <button type="button" class="button subtle" id="import-button">Import CSV</button>
        <button type="button" class="button subtle" id="export-csv-button">Export CSV</button>
        <button type="button" class="button subtle" id="export-image-button">Save image</button>
        <button type="button" class="button danger" id="clear-button">Clear</button>
      </div>
      <span id="save-status" class="save-status" aria-live="polite">Saved locally</span>
      <input type="file" id="file-input" accept=".csv,text/csv,text/plain" hidden />
    </section>

    <section class="sheet" id="capture-area" aria-label="Math work">
      <div class="sheet-heading">
        <strong id="capture-title"></strong>
        <span id="capture-assumptions" class="capture-assumptions" hidden></span>
      </div>
      <div id="equation-list" class="equation-list"></div>
    </section>
    <button type="button" class="add-row" id="add-row-button">+ Add another step</button>

    <details class="help">
      <summary>How checking works</summary>
      <div class="help-grid">
        <p><strong>Exact first.</strong> Algebraic simplification, equation normalization, derivatives, and antiderivative checks run before approximation.</p>
        <p><strong>Numbers disprove.</strong> A stable counterexample can show two expressions differ. Matching samples never pretend to be a proof.</p>
        <p><strong>Domains matter.</strong> Denominators and assumptions are retained, so cancellation cannot silently erase excluded values.</p>
        <p><strong>Offline by design.</strong> Work stays in this browser. The app and checker are cached after the first visit.</p>
      </div>
    </details>
  </main>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required application control is missing: ${selector}`);
  return element;
}

const equationList = requiredElement<HTMLDivElement>("#equation-list");
const titleInput = requiredElement<HTMLInputElement>("#document-title");
const assumptionsInput = requiredElement<HTMLInputElement>("#assumptions");
const captureTitle = requiredElement<HTMLElement>("#capture-title");
const captureAssumptions = requiredElement<HTMLElement>("#capture-assumptions");
const saveStatus = requiredElement<HTMLElement>("#save-status");
const fileInput = requiredElement<HTMLInputElement>("#file-input");

titleInput.value = documentState.title;
assumptionsInput.value = documentState.assumptions;
captureTitle.textContent = documentState.title;

function updateCaptureAssumptions(): void {
  const value = documentState.assumptions.trim();
  captureAssumptions.hidden = !value;
  captureAssumptions.textContent = value ? `Assumptions: ${value}` : "";
}

updateCaptureAssumptions();

function assumptions(): string[] {
  return documentState.assumptions
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function scheduleSave(): void {
  saveStatus.textContent = "Saving…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await saveDocument(documentState);
      saveStatus.textContent = "Saved locally";
    } catch (error) {
      console.error(error);
      saveStatus.textContent = "Could not save";
    }
  }, 180);
}

function rowStatusMarkup(index: number, state?: RowState): string {
  if (index === 0) {
    if (state && state.verdict !== "checking" && state.method === "parse-error") {
      return '<span class="status unknown">Invalid original</span>';
    }
    return '<span class="status reference">Original</span>';
  }
  if (!state) return '<span class="status idle">Not checked</span>';
  if (state.verdict === "checking") return '<span class="status checking">Checking…</span>';
  const label = {
    equivalent: "Equivalent",
    "not-equivalent": "Different",
    unknown: "Uncertain",
  }[state.verdict];
  return `<span class="status ${state.verdict}">${label}</span>`;
}

function updateRowResult(rowId: string): void {
  const index = documentState.rows.findIndex((row) => row.id === rowId);
  const rowElement = equationList.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`);
  if (index < 0 || !rowElement) return;
  const state = rowStates.get(rowId);
  const resultElement = rowElement.querySelector<HTMLElement>(".result");
  if (!resultElement) return;
  resultElement.className = `result ${state?.verdict ?? "idle"}`;
  const message = index === 0
    ? state?.message ?? "Every later row is compared with this one."
    : state?.message ?? "Pause typing or press Enter to check.";
  resultElement.innerHTML = `${rowStatusMarkup(index, state)}<p>${message}</p>`;
  if (state && state.verdict !== "checking" && state.method === "parse-error") {
    const details = document.createElement("details");
    details.className = "parse-details";
    const summary = document.createElement("summary");
    summary.textContent = "Parser details";
    const source = document.createElement("code");
    source.textContent = documentState.rows[index]?.latex ?? "";
    details.append(summary, source);
    resultElement.append(details);
  }
}

async function checkRow(rowId: string): Promise<void> {
  const index = documentState.rows.findIndex((row) => row.id === rowId);
  if (index <= 0) return;
  const reference = documentState.rows[0]?.latex ?? "";
  const candidate = documentState.rows[index]?.latex ?? "";
  const checkedReferenceGeneration = referenceGeneration;
  const generation = (rowGenerations.get(rowId) ?? 0) + 1;
  rowGenerations.set(rowId, generation);
  if (candidate.trim()) {
    rowStates.set(rowId, { verdict: "checking", message: "Checking this step…" });
    updateRowResult(rowId);
  }

  const checkResult = await checkInWorker(reference, candidate, {
    assumptions: assumptions(),
    timeoutMs: 1_200,
  });
  if (
    rowGenerations.get(rowId) !== generation ||
    checkedReferenceGeneration !== referenceGeneration ||
    documentState.rows.findIndex((row) => row.id === rowId) <= 0
  ) return;
  const referenceId = documentState.rows[0]?.id;
  if (checkResult.parseSource === "reference" && referenceId) {
    rowStates.set(referenceId, checkResult);
    rowStates.delete(rowId);
    updateRowResult(referenceId);
    updateRowResult(rowId);
    return;
  }
  if (referenceId) {
    const referenceState = rowStates.get(referenceId);
    if (referenceState && referenceState.verdict !== "checking" && referenceState.parseSource === "reference") {
      rowStates.delete(referenceId);
      updateRowResult(referenceId);
    }
  }
  if (checkResult.parseSource === "candidate" && !candidate.trim()) {
    rowStates.delete(rowId);
    updateRowResult(rowId);
    return;
  }
  rowStates.set(rowId, checkResult);
  updateRowResult(rowId);
}

function checkAllRows(): void {
  for (const row of documentState.rows.slice(1)) void checkRow(row.id);
}

function scheduleChecks(rowId: string, originalChanged: boolean): void {
  window.clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    if (originalChanged) checkAllRows();
    else void checkRow(rowId);
  }, 350);
}

function focusRow(rowId: string): void {
  window.requestAnimationFrame(() => {
    equationList
      .querySelector<MathfieldElement>(`[data-row-id="${CSS.escape(rowId)}"] math-field`)
      ?.focus();
  });
}

function insertRow(afterIndex: number, latex = ""): void {
  const row = { id: createId(), latex };
  documentState.rows.splice(afterIndex + 1, 0, row);
  renderRows();
  scheduleSave();
  focusRow(row.id);
  void checkRow(row.id);
}

function removeRow(index: number): void {
  if (documentState.rows.length === 1) return;
  const [removed] = documentState.rows.splice(index, 1);
  if (removed) {
    rowStates.delete(removed.id);
    rowGenerations.delete(removed.id);
  }
  if (index === 0) referenceGeneration += 1;
  const focusTarget = documentState.rows[Math.max(0, index - 1)]?.id;
  renderRows();
  scheduleSave();
  if (index === 0) checkAllRows();
  if (focusTarget) focusRow(focusTarget);
}

function renderRows(): void {
  equationList.replaceChildren();
  documentState.rows.forEach((row, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = "equation-row";
    wrapper.dataset.rowId = row.id;

    const sequence = document.createElement("span");
    sequence.className = "sequence";
    sequence.textContent = String(index + 1).padStart(2, "0");

    const field = new MathfieldElement();
    field.value = row.latex;
    let emptyBackspaceReady = !field.value;
    field.className = "math-input";
    field.setAttribute("aria-label", index === 0 ? "Original expression" : `Math step ${index + 1}`);
    field.smartMode = true;
    field.mathVirtualKeyboardPolicy = "auto";
    const syncFieldValue = (): void => {
      if (row.latex === field.value) return;
      row.latex = field.value;
      rowGenerations.set(row.id, (rowGenerations.get(row.id) ?? 0) + 1);
      if (index === 0) referenceGeneration += 1;
      if (field.value) emptyBackspaceReady = false;
      rowStates.delete(row.id);
      updateRowResult(row.id);
      scheduleSave();
      scheduleChecks(row.id, index === 0);
    };
    field.addEventListener("input", syncFieldValue);
    field.addEventListener("change", syncFieldValue);
    field.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        syncFieldValue();
        if (index > 0) void checkRow(row.id);
        insertRow(index, field.value);
      } else if (
        event.key === "Backspace" &&
        !field.value &&
        emptyBackspaceReady &&
        documentState.rows.length > 1
      ) {
        event.preventDefault();
        removeRow(index);
      } else if (event.key === "Backspace") {
        emptyBackspaceReady = false;
      } else if (event.key === "ArrowUp" && index > 0) {
        event.preventDefault();
        focusRow(documentState.rows[index - 1].id);
      } else if (event.key === "ArrowDown" && index < documentState.rows.length - 1) {
        event.preventDefault();
        focusRow(documentState.rows[index + 1].id);
      }
    });
    field.addEventListener("keyup", () => {
      emptyBackspaceReady = !field.value;
    });
    field.addEventListener("blur", () => {
      emptyBackspaceReady = !field.value;
    });

    const resultElement = document.createElement("div");
    resultElement.className = "result";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-row";
    removeButton.textContent = "×";
    removeButton.title = "Delete this row";
    removeButton.setAttribute("aria-label", `Delete row ${index + 1}`);
    removeButton.addEventListener("click", () => removeRow(index));

    wrapper.append(sequence, field, resultElement, removeButton);
    equationList.append(wrapper);
    updateRowResult(row.id);
  });
}

function download(contents: Blob, filename: string): void {
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(contents);
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(extension: string): string {
  const base = documentState.title.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "mathdocs";
  return `${base.toLowerCase()}.${extension}`;
}

titleInput.addEventListener("input", () => {
  documentState.title = titleInput.value || "Untitled work";
  captureTitle.textContent = documentState.title;
  scheduleSave();
});

assumptionsInput.addEventListener("input", () => {
  documentState.assumptions = assumptionsInput.value;
  updateCaptureAssumptions();
  scheduleSave();
  scheduleChecks(documentState.rows[0]?.id ?? "", true);
});

document.querySelector("#add-row-button")?.addEventListener("click", () => {
  insertRow(documentState.rows.length - 1);
});

document.querySelector("#import-button")?.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const equations = parseEquationCsv(await file.text());
  if (equations.length > 0) {
    referenceGeneration += 1;
    documentState.rows = equations.map((latex) => ({ id: createId(), latex }));
    rowStates.clear();
    rowGenerations.clear();
    renderRows();
    checkAllRows();
    scheduleSave();
  }
  fileInput.value = "";
});

document.querySelector("#export-csv-button")?.addEventListener("click", () => {
  download(
    new Blob([serializeEquationCsv(documentState.rows.map((row) => row.latex))], { type: "text/csv" }),
    safeFilename("csv"),
  );
});

document.querySelector("#export-image-button")?.addEventListener("click", async () => {
  const captureArea = document.querySelector<HTMLElement>("#capture-area");
  if (!captureArea) return;
  const fields = [...captureArea.querySelectorAll<MathfieldElement>("math-field")];
  fields.forEach((field) => { field.readOnly = true; });
  captureArea.classList.add("exporting");
  try {
    const canvas = await html2canvas(captureArea, {
      backgroundColor: getComputedStyle(captureArea).backgroundColor,
      scale: 2,
    });
    canvas.toBlob((blob) => {
      if (blob) download(blob, safeFilename("png"));
    }, "image/png");
  } finally {
    captureArea.classList.remove("exporting");
    fields.forEach((field) => { field.readOnly = false; });
  }
});

document.querySelector("#clear-button")?.addEventListener("click", () => {
  if (!window.confirm("Clear this document and start over?")) return;
  documentState = createEmptyDocument();
  referenceGeneration += 1;
  rowStates.clear();
  rowGenerations.clear();
  titleInput.value = documentState.title;
  assumptionsInput.value = "";
  captureTitle.textContent = documentState.title;
  updateCaptureAssumptions();
  renderRows();
  scheduleSave();
  focusRow(documentState.rows[0].id);
});

type Theme = "dark" | "light";

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  const icon = toggle?.querySelector<HTMLElement>(".theme-icon");
  const label = toggle?.querySelector<HTMLElement>(".theme-label");
  const nextTheme = theme === "dark" ? "light" : "dark";
  if (toggle) toggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
  if (icon) icon.textContent = theme === "dark" ? "☀" : "☾";
  if (label) label.textContent = theme === "dark" ? "Light" : "Dark";
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#18232c" : "#253746",
  );
}

const storedTheme: Theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
applyTheme(storedTheme);
document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const nextTheme: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem("mathdocs-theme", nextTheme);
  } catch {
    // The theme still works for this session if private storage is unavailable.
  }
});

function updateNetworkStatus(): void {
  const status = document.querySelector<HTMLElement>("#network-status");
  if (status) status.textContent = navigator.onLine ? "Offline ready" : "Working offline";
}

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
if (import.meta.env.DEV) {
  void navigator.serviceWorker?.getRegistrations().then(async (registrations) => {
    const wasControlled = Boolean(navigator.serviceWorker.controller);
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const reloadKey = "mathdocs-dev-service-worker-cleared";
    if (wasControlled && sessionStorage.getItem(reloadKey) !== "true") {
      sessionStorage.setItem(reloadKey, "true");
      window.location.reload();
    } else if (!wasControlled) {
      sessionStorage.removeItem(reloadKey);
    }
  });
} else {
  registerSW({ immediate: true });
}
updateNetworkStatus();
renderRows();

async function restoreDocument(): Promise<void> {
  const restored = await loadDocument();
  referenceGeneration += 1;
  documentState = restored;
  rowStates.clear();
  rowGenerations.clear();
  titleInput.value = restored.title;
  assumptionsInput.value = restored.assumptions;
  captureTitle.textContent = restored.title;
  updateCaptureAssumptions();
  renderRows();
  checkAllRows();
}

void restoreDocument().catch((error) => {
  console.error("The saved document could not be restored.", error);
  saveStatus.textContent = "Could not load saved work";
});
