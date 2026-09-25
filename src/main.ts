import { MathfieldElement } from "mathlive";
import "mathlive/fonts.css";
import html2canvas from "html2canvas";
import { registerSW } from "virtual:pwa-register";
import {
  checkAssumptionsInWorker,
  checkInWorker,
  validateAssumptionInWorker,
} from "./checker/client";
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

MathfieldElement.soundsDirectory = null;

type RowState = CheckResult | { verdict: "checking"; message: string };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root is missing.");

let documentState: MathDocument = createEmptyDocument();
const rowStates = new Map<string, RowState>();
const rowGenerations = new Map<string, number>();
let referenceGeneration = 0;
let saveTimer: number | undefined;
let checkTimer: number | undefined;
let assumptionCheckTimer: number | undefined;
let assumptionCheckGeneration = 0;
let savedConflictingAssumptions = new Set<number>();
let savedAssumptionConflictMessage = "";
let candidateConflictingAssumptions = new Set<number>();
let candidateAssumptionConflicts = false;

app.innerHTML = `
  <header class="app-header">
    <a class="brand" href="/" aria-label="MathDocs home">
      <img src="/favicon.png" alt="" width="38" height="38" />
      <span>MathDocs</span>
    </a>
    <div class="header-actions">
      <a class="settings-link" href="#settings" id="settings-link">Settings</a>
      <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Switch to light theme">
        <span class="theme-icon" aria-hidden="true">☀</span>
        <span class="theme-label">Light</span>
      </button>
      <span class="offline-pill" id="network-status">Offline ready</span>
    </div>
  </header>

  <main id="workset-page">
    <section class="page-heading">
      <div>
        <p class="breadcrumb">Home&nbsp;&nbsp;/&nbsp;&nbsp;Workset</p>
        <h1>Workset</h1>
        <p>Each row is checked against the original expression.</p>
      </div>
      <div class="legend" aria-label="Result legend">
        <span><i class="dot equivalent"></i> Equivalent</span>
        <span><i class="dot equivalent-domain-change"></i> Equivalent, domain changed</span>
        <span><i class="dot not-equivalent"></i> Different</span>
        <span><i class="dot unknown"></i> Uncertain</span>
      </div>
    </section>

    <section class="toolbar" aria-label="Document controls">
      <label class="title-field">
        <span>Document</span>
        <input id="document-title" autocomplete="off" />
      </label>
      <div class="assumption-field">
        <span class="field-label">Assumptions</span>
        <div id="assumption-list" class="assumption-list" aria-label="Saved assumptions"></div>
        <div id="assumption-editor-host"></div>
        <p id="assumption-error" class="assumption-error" role="alert" hidden></p>
      </div>
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
        <div id="capture-assumptions" class="capture-assumptions" hidden></div>
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

  <main class="settings-page" id="settings-page" hidden>
    <section class="settings-heading">
      <p class="breadcrumb">Home&nbsp;&nbsp;/&nbsp;&nbsp;Settings</p>
      <div class="settings-title-row">
        <div>
          <h1>Settings</h1>
          <p>Customize how the math editor behaves on this device.</p>
        </div>
        <a class="button settings-back" href="#">Back to workset</a>
      </div>
    </section>

    <section class="settings-card" aria-labelledby="editor-settings-title">
      <h2 id="editor-settings-title">Math editor</h2>
      <label class="setting-row" for="automatic-shortcuts">
        <span>
          <strong>Automatic symbol shortcuts</strong>
          <small>Convert plain typed abbreviations such as <code>in</code> to <code>∈</code>. Explicit commands such as <code>\\in</code> and their suggestions still work.</small>
        </span>
        <span class="switch">
          <input type="checkbox" id="automatic-shortcuts" />
          <span class="switch-track" aria-hidden="true"></span>
        </span>
      </label>
      <p class="settings-note" id="settings-save-status" aria-live="polite"></p>
    </section>
  </main>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required application control is missing: ${selector}`);
  return element;
}

const equationList = requiredElement<HTMLDivElement>("#equation-list");
const titleInput = requiredElement<HTMLInputElement>("#document-title");
const assumptionList = requiredElement<HTMLElement>("#assumption-list");
const assumptionEditorHost = requiredElement<HTMLElement>("#assumption-editor-host");
const assumptionError = requiredElement<HTMLElement>("#assumption-error");
const captureTitle = requiredElement<HTMLElement>("#capture-title");
const captureAssumptions = requiredElement<HTMLElement>("#capture-assumptions");
const saveStatus = requiredElement<HTMLElement>("#save-status");
const fileInput = requiredElement<HTMLInputElement>("#file-input");
const worksetPage = requiredElement<HTMLElement>("#workset-page");
const settingsPage = requiredElement<HTMLElement>("#settings-page");
const settingsLink = requiredElement<HTMLAnchorElement>("#settings-link");
const automaticShortcutsToggle = requiredElement<HTMLInputElement>("#automatic-shortcuts");
const settingsSaveStatus = requiredElement<HTMLElement>("#settings-save-status");

const AUTOMATIC_SHORTCUTS_KEY = "mathdocs-automatic-shortcuts";

function loadAutomaticShortcutsPreference(): boolean {
  try {
    return localStorage.getItem(AUTOMATIC_SHORTCUTS_KEY) !== "false";
  } catch {
    return true;
  }
}

let automaticShortcutsEnabled = loadAutomaticShortcutsPreference();
const defaultInlineShortcuts = new WeakMap<
  MathfieldElement,
  MathfieldElement["inlineShortcuts"]
>();

function configureInlineShortcuts(field: MathfieldElement): void {
  let shortcuts = defaultInlineShortcuts.get(field);
  if (!shortcuts) {
    shortcuts = { ...field.inlineShortcuts };
    defaultInlineShortcuts.set(field, shortcuts);
  }
  field.inlineShortcuts = automaticShortcutsEnabled ? { ...shortcuts } : {};
}

function configureInlineShortcutsWhenMounted(field: MathfieldElement): void {
  field.addEventListener("mount", () => configureInlineShortcuts(field), { once: true });
}

titleInput.value = documentState.title;
captureTitle.textContent = documentState.title;

const assumptionEditor = new MathfieldElement();
assumptionEditor.className = "assumption-editor";
assumptionEditor.setAttribute("aria-label", "New assumption");
assumptionEditor.setAttribute("placeholder", "\\text{Type an assumption, then press Enter}");
assumptionEditor.smartMode = true;
assumptionEditor.popoverPolicy = "auto";
assumptionEditor.mathVirtualKeyboardPolicy = "auto";
configureInlineShortcutsWhenMounted(assumptionEditor);
assumptionEditorHost.append(assumptionEditor);

function updateCaptureAssumptions(): void {
  const values = assumptions();
  captureAssumptions.hidden = values.length === 0;
  captureAssumptions.replaceChildren();
  if (values.length === 0) return;
  const label = document.createElement("span");
  label.textContent = "Assumptions:";
  captureAssumptions.append(label);
  for (const latex of values) {
    const field = new MathfieldElement();
    field.value = latex;
    field.readOnly = true;
    field.className = "capture-assumption";
    captureAssumptions.append(field);
  }
}

updateCaptureAssumptions();

function assumptions(): string[] {
  return documentState.assumptions
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function showSavedAssumptionConflict(): void {
  if (savedConflictingAssumptions.size === 0) {
    assumptionError.hidden = true;
    assumptionError.textContent = "";
    return;
  }
  assumptionError.hidden = false;
  assumptionError.className = "assumption-error invalid conflict";
  assumptionError.textContent = `${savedAssumptionConflictMessage} Remove or correct at least one highlighted assumption.`;
}

async function refreshSavedAssumptionConsistency(): Promise<void> {
  const generation = ++assumptionCheckGeneration;
  const values = assumptions();
  const checked = await checkAssumptionsInWorker(
    values,
    documentState.rows[0]?.latex ?? "",
  );
  if (generation !== assumptionCheckGeneration) return;
  savedConflictingAssumptions = checked.contradiction
    ? new Set(checked.conflictingIndices)
    : new Set<number>();
  savedAssumptionConflictMessage = checked.contradiction ? checked.message : "";
  renderAssumptionList();
  if (!candidateAssumptionConflicts) showSavedAssumptionConflict();
}

function scheduleAssumptionConsistency(): void {
  window.clearTimeout(assumptionCheckTimer);
  assumptionCheckTimer = window.setTimeout(() => {
    void refreshSavedAssumptionConsistency();
  }, 300);
}

function setAssumptions(values: string[]): void {
  assumptionCheckGeneration += 1;
  savedConflictingAssumptions = new Set<number>();
  savedAssumptionConflictMessage = "";
  candidateConflictingAssumptions = new Set<number>();
  candidateAssumptionConflicts = false;
  assumptionEditor.classList.remove("invalid");
  assumptionEditor.removeAttribute("aria-invalid");
  showSavedAssumptionConflict();
  documentState.assumptions = values.join("\n");
  renderAssumptionList();
  updateCaptureAssumptions();
  scheduleSave();
  scheduleChecks(documentState.rows[0]?.id ?? "", true);
  void refreshSavedAssumptionConsistency();
}

function renderAssumptionList(): void {
  assumptionList.replaceChildren();
  assumptions().forEach((latex, index) => {
    const item = document.createElement("div");
    item.className = "assumption-item";
    if (
      savedConflictingAssumptions.has(index) ||
      candidateConflictingAssumptions.has(index)
    ) {
      item.classList.add("conflicting");
    }
    const field = new MathfieldElement();
    field.value = latex;
    field.readOnly = true;
    field.className = "saved-assumption";
    field.setAttribute("aria-label", `Assumption ${index + 1}`);
    if (item.classList.contains("conflicting")) field.setAttribute("aria-invalid", "true");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-assumption";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove assumption ${index + 1}`);
    remove.addEventListener("click", () => {
      const values = assumptions();
      values.splice(index, 1);
      setAssumptions(values);
    });
    item.append(field, remove);
    assumptionList.append(item);
  });
}

renderAssumptionList();
void refreshSavedAssumptionConsistency();

function acceptLatexSuggestion(field: MathfieldElement, event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || field.mode !== "latex") return false;
  const suggestion = document.querySelector<HTMLElement>(
    "#mathlive-suggestion-popover.is-visible .ML__popover__current[data-command]",
  )?.dataset.command;
  if (!suggestion) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  field.executeCommand(["complete", "reject"]);
  const template = suggestion === "\\sqrt" ? "\\sqrt{#?}" : suggestion;
  field.insert(template, {
    format: "latex",
    mode: "math",
    selectionMode: "placeholder",
  });
  return true;
}

function handlePhysicalMathShortcut(field: MathfieldElement, event: KeyboardEvent): boolean {
  // On Windows, AltGr is commonly exposed as Ctrl+Alt. Treat it as a text
  // modifier so custom keyboard layouts can still produce `\\` and `/`.
  const usesAltGraph =
    event.getModifierState("AltGraph") || (event.ctrlKey && event.altKey);
  const usesCommandModifier =
    event.metaKey || ((event.ctrlKey || event.altKey) && !usesAltGraph);
  if (event.isComposing || usesCommandModifier) return false;

  if (event.key === "\\" && field.mode === "math") {
    event.preventDefault();
    event.stopImmediatePropagation();
    field.executeCommand(["switchMode", "latex", "", "\\"]);
    return true;
  }

  if (event.key === "/" && field.mode === "math") {
    event.preventDefault();
    event.stopImmediatePropagation();
    field.insert("\\frac{#@}{#?}", {
      format: "latex",
      mode: "math",
      selectionMode: "placeholder",
    });
    return true;
  }

  return false;
}

assumptionEditor.addEventListener("input", () => {
  const hadCandidateConflict =
    candidateAssumptionConflicts || candidateConflictingAssumptions.size > 0;
  candidateAssumptionConflicts = false;
  candidateConflictingAssumptions = new Set<number>();
  assumptionEditor.classList.remove("invalid");
  assumptionEditor.removeAttribute("aria-invalid");
  if (hadCandidateConflict) renderAssumptionList();
  showSavedAssumptionConflict();
});

assumptionEditor.addEventListener("keydown", (event: KeyboardEvent) => {
  if (handlePhysicalMathShortcut(assumptionEditor, event)) return;
  acceptLatexSuggestion(assumptionEditor, event);
}, { capture: true });

assumptionEditor.addEventListener("keydown", async (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const submitted = assumptionEditor.value.trim();
  if (!submitted) return;
  assumptionError.hidden = false;
  assumptionError.className = "assumption-error validating";
  assumptionError.textContent = "Checking assumption…";
  const validation = await validateAssumptionInWorker(submitted);
  if (assumptionEditor.value.trim() !== submitted) return;
  if (!validation.valid) {
    assumptionError.className = "assumption-error invalid";
    assumptionError.textContent = validation.message;
    assumptionEditor.classList.add("invalid");
    assumptionEditor.setAttribute("aria-invalid", "true");
    assumptionEditor.focus();
    return;
  }
  const values = assumptions();
  if (values.includes(validation.latex)) {
    assumptionError.className = "assumption-error invalid";
    assumptionError.textContent = "That assumption is already in the list.";
    assumptionEditor.classList.add("invalid");
    assumptionEditor.setAttribute("aria-invalid", "true");
    assumptionEditor.focus();
    return;
  }
  assumptionError.className = "assumption-error validating";
  assumptionError.textContent = "Checking all assumptions together…";
  const consistency = await checkAssumptionsInWorker(
    [...values, validation.latex],
    documentState.rows[0]?.latex ?? "",
  );
  if (assumptionEditor.value.trim() !== submitted) return;
  if (consistency.contradiction) {
    const candidateIndex = values.length;
    candidateConflictingAssumptions = new Set(
      consistency.conflictingIndices.filter((index) => index !== candidateIndex),
    );
    candidateAssumptionConflicts = consistency.conflictingIndices.includes(candidateIndex);
    renderAssumptionList();
    assumptionEditor.classList.toggle("invalid", candidateAssumptionConflicts);
    if (candidateAssumptionConflicts) assumptionEditor.setAttribute("aria-invalid", "true");
    assumptionError.className = "assumption-error invalid conflict";
    assumptionError.textContent = `${consistency.message} Correct the highlighted new assumption or change an existing one.`;
    assumptionEditor.focus();
    return;
  }
  values.push(validation.latex);
  setAssumptions(values);
  if (assumptionEditor.value.trim() === submitted) assumptionEditor.value = "";
  assumptionEditor.classList.remove("invalid");
  assumptionEditor.removeAttribute("aria-invalid");
  assumptionError.hidden = true;
  assumptionError.textContent = "";
  assumptionEditor.focus();
});

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
    "equivalent-domain-change": "Equivalent · domain changed",
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
  if (index === 0) {
    referenceGeneration += 1;
    scheduleAssumptionConsistency();
  }
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
    field.popoverPolicy = "auto";
    field.mathVirtualKeyboardPolicy = "auto";
    configureInlineShortcutsWhenMounted(field);
    const syncFieldValue = (): void => {
      if (row.latex === field.value) return;
      row.latex = field.value;
      rowGenerations.set(row.id, (rowGenerations.get(row.id) ?? 0) + 1);
      if (index === 0) {
        referenceGeneration += 1;
        scheduleAssumptionConsistency();
      }
      if (field.value) emptyBackspaceReady = false;
      rowStates.delete(row.id);
      updateRowResult(row.id);
      scheduleSave();
      scheduleChecks(row.id, index === 0);
    };
    field.addEventListener("input", syncFieldValue);
    field.addEventListener("change", syncFieldValue);
    field.addEventListener("keydown", (event: KeyboardEvent) => {
      if (handlePhysicalMathShortcut(field, event)) {
        syncFieldValue();
        return;
      }
      if (acceptLatexSuggestion(field, event)) syncFieldValue();
    }, { capture: true });
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

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The image could not be encoded as a PNG."));
    }, "image/png");
  });
}

async function copyPngToClipboard(blob: Blob): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (error) {
    console.warn("The PNG could not be copied to the clipboard.", error);
    return false;
  }
}

interface ImageSaveHandle {
  createWritable(): Promise<{
    write(contents: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

async function savePng(blob: Blob, filename: string): Promise<"saved" | "cancelled"> {
  const showSaveFilePicker = (window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<ImageSaveHandle>;
  }).showSaveFilePicker;

  if (!showSaveFilePicker) {
    download(blob, filename);
    return "saved";
  }

  try {
    const handle = await showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    console.warn("The native save picker was unavailable; using a browser download.", error);
    download(blob, filename);
    return "saved";
  }
}

titleInput.addEventListener("input", () => {
  documentState.title = titleInput.value || "Untitled work";
  captureTitle.textContent = documentState.title;
  scheduleSave();
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
    scheduleAssumptionConsistency();
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

document.querySelector("#export-image-button")?.addEventListener("click", async (event) => {
  const captureArea = document.querySelector<HTMLElement>("#capture-area");
  if (!captureArea) return;
  const button = event.currentTarget as HTMLButtonElement;
  const originalLabel = button.textContent;
  const fields = [...captureArea.querySelectorAll<MathfieldElement>("math-field")];
  const readOnlyStates = fields.map((field) => field.readOnly);
  button.disabled = true;
  button.textContent = "Preparing image…";
  fields.forEach((field) => { field.readOnly = true; });
  captureArea.classList.add("exporting");
  try {
    const canvas = await html2canvas(captureArea, {
      backgroundColor: getComputedStyle(captureArea).backgroundColor,
      scale: 2,
    });
    const blob = await canvasToPng(canvas);
    const copied = await copyPngToClipboard(blob);
    button.textContent = copied ? "Copied — choose location…" : "Choose save location…";
    const saveResult = await savePng(blob, safeFilename("png"));
    if (saveResult === "saved") {
      saveStatus.textContent = copied
        ? "Image copied to clipboard and saved"
        : "Image saved; clipboard access was unavailable";
    } else {
      saveStatus.textContent = copied ? "Image copied to clipboard" : "Image save cancelled";
    }
  } catch (error) {
    console.error(error);
    saveStatus.textContent = "Could not create image";
  } finally {
    captureArea.classList.remove("exporting");
    fields.forEach((field, index) => { field.readOnly = readOnlyStates[index]; });
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

document.querySelector("#clear-button")?.addEventListener("click", () => {
  if (!window.confirm("Clear this document and start over?")) return;
  documentState = createEmptyDocument();
  referenceGeneration += 1;
  assumptionCheckGeneration += 1;
  savedConflictingAssumptions = new Set<number>();
  savedAssumptionConflictMessage = "";
  candidateConflictingAssumptions = new Set<number>();
  candidateAssumptionConflicts = false;
  rowStates.clear();
  rowGenerations.clear();
  titleInput.value = documentState.title;
  assumptionEditor.value = "";
  assumptionEditor.classList.remove("invalid");
  assumptionEditor.removeAttribute("aria-invalid");
  assumptionError.hidden = true;
  captureTitle.textContent = documentState.title;
  renderAssumptionList();
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

function updatePageFromHash(): void {
  const showSettings = window.location.hash === "#settings";
  worksetPage.hidden = showSettings;
  settingsPage.hidden = !showSettings;
  if (showSettings) settingsLink.setAttribute("aria-current", "page");
  else settingsLink.removeAttribute("aria-current");
}

automaticShortcutsToggle.checked = automaticShortcutsEnabled;
automaticShortcutsToggle.addEventListener("change", () => {
  automaticShortcutsEnabled = automaticShortcutsToggle.checked;
  configureInlineShortcuts(assumptionEditor);
  equationList
    .querySelectorAll<MathfieldElement>("math-field.math-input")
    .forEach(configureInlineShortcuts);
  try {
    localStorage.setItem(AUTOMATIC_SHORTCUTS_KEY, String(automaticShortcutsEnabled));
    settingsSaveStatus.textContent = "Saved on this device.";
  } catch {
    settingsSaveStatus.textContent = "Applied for this session; local storage is unavailable.";
  }
});

window.addEventListener("hashchange", updatePageFromHash);
updatePageFromHash();

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
  assumptionCheckGeneration += 1;
  savedConflictingAssumptions = new Set<number>();
  savedAssumptionConflictMessage = "";
  candidateConflictingAssumptions = new Set<number>();
  candidateAssumptionConflicts = false;
  documentState = restored;
  rowStates.clear();
  rowGenerations.clear();
  titleInput.value = restored.title;
  captureTitle.textContent = restored.title;
  renderAssumptionList();
  updateCaptureAssumptions();
  void refreshSavedAssumptionConsistency();
  renderRows();
  checkAllRows();
  const firstRowId = documentState.rows[0]?.id;
  if (firstRowId) focusRow(firstRowId);
}

void restoreDocument().catch((error) => {
  console.error("The saved document could not be restored.", error);
  saveStatus.textContent = "Could not load saved work";
  const firstRowId = documentState.rows[0]?.id;
  if (firstRowId) focusRow(firstRowId);
});
