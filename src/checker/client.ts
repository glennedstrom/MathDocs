import type {
  AssumptionValidationRequest,
  AssumptionValidationResult,
  CheckContext,
  CheckRequest,
  CheckResult,
  WorkerResponse,
} from "./types";

interface PendingCheck {
  resolve: (result: CheckResult) => void;
  timer: number;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, PendingCheck>();
const pendingAssumptions = new Map<
  number,
  { resolve: (result: AssumptionValidationResult) => void; timer: number }
>();

function createWorker(): Worker {
  const instance = new Worker(new URL("./checker.worker.ts", import.meta.url), { type: "module" });
  instance.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    if (event.data.kind === "validate-assumption") {
      const item = pendingAssumptions.get(event.data.id);
      if (!item) return;
      window.clearTimeout(item.timer);
      pendingAssumptions.delete(event.data.id);
      item.resolve(event.data.result);
    } else {
      const item = pending.get(event.data.id);
      if (!item) return;
      window.clearTimeout(item.timer);
      pending.delete(event.data.id);
      item.resolve(event.data.result);
    }
  });
  return instance;
}

function restartWorker(): void {
  worker?.terminate();
  worker = createWorker();
}

export function checkInWorker(
  referenceLatex: string,
  candidateLatex: string,
  context: CheckContext = {},
): Promise<CheckResult> {
  worker ??= createWorker();
  const id = nextId++;
  const timeoutMs = context.timeoutMs ?? 1_200;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      resolve({
        verdict: "unknown",
        method: "timeout",
        message: "This check exceeded the time limit.",
      });
      restartWorker();
    }, timeoutMs + 250);

    pending.set(id, { resolve, timer });
    const request: CheckRequest = {
      kind: "check",
      id,
      referenceLatex,
      candidateLatex,
      context: { ...context, timeoutMs },
    };
    worker?.postMessage(request);
  });
}

export function validateAssumptionInWorker(latex: string): Promise<AssumptionValidationResult> {
  worker ??= createWorker();
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pendingAssumptions.delete(id);
      resolve({ valid: false, message: "Assumption validation timed out.", latex });
      restartWorker();
    }, 1_500);
    pendingAssumptions.set(id, { resolve, timer });
    const request: AssumptionValidationRequest = { kind: "validate-assumption", id, latex };
    worker?.postMessage(request);
  });
}
