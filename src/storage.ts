export interface EquationRow {
  id: string;
  latex: string;
}

export interface MathDocument {
  version: 1;
  title: string;
  assumptions: string;
  rows: EquationRow[];
  updatedAt: number;
}

const DATABASE_NAME = "mathdocs";
const STORE_NAME = "documents";
const CURRENT_DOCUMENT_KEY = "current";

export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyDocument(): MathDocument {
  return {
    version: 1,
    title: "Untitled work",
    assumptions: "",
    rows: [{ id: createId(), latex: "" }],
    updatedAt: Date.now(),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function readCurrentDocument(): Promise<MathDocument | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(CURRENT_DOCUMENT_KEY);
    request.addEventListener("success", () => resolve(request.result as MathDocument | undefined));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => database.close());
  });
}

function migrateLegacyDocument(): MathDocument | undefined {
  const legacy = localStorage.getItem("equations");
  if (!legacy) return undefined;

  const rows = legacy
    .split(",")
    .map((encoded) => new URLSearchParams(encoded).get("latex") ?? "")
    .filter((latex, index, values) => latex.trim() || index === 0 || values.length === 1)
    .map((latex) => ({ id: createId(), latex }));
  if (rows.length === 0) return undefined;

  localStorage.setItem("mathdocs-legacy-migrated", new Date().toISOString());
  return {
    version: 1,
    title: "Imported MathDocs work",
    assumptions: "",
    rows,
    updatedAt: Date.now(),
  };
}

export async function loadDocument(): Promise<MathDocument> {
  try {
    const stored = await readCurrentDocument();
    if (stored?.version === 1 && stored.rows.length > 0) return stored;
  } catch (error) {
    console.warn("IndexedDB is unavailable; starting with local data.", error);
  }
  const migrated = migrateLegacyDocument();
  if (migrated) {
    try {
      await saveDocument(migrated);
    } catch (error) {
      console.warn("Legacy work was loaded but could not be persisted to IndexedDB.", error);
    }
    return migrated;
  }
  return createEmptyDocument();
}

export async function saveDocument(document: MathDocument): Promise<void> {
  document.updatedAt = Date.now();
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(document, CURRENT_DOCUMENT_KEY);
    transaction.addEventListener("complete", () => {
      database.close();
      resolve();
    });
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}
