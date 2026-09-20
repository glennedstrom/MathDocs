export type Verdict = "equivalent" | "not-equivalent" | "unknown";

export type CheckMethod =
  | "reference"
  | "canonical"
  | "symbolic"
  | "equation-normalization"
  | "calculus"
  | "numeric-counterexample"
  | "parse-error"
  | "unsupported"
  | "timeout";

export interface CheckContext {
  assumptions?: string[];
  timeoutMs?: number;
}

export interface CheckResult {
  verdict: Verdict;
  method: CheckMethod;
  message: string;
  counterexample?: Record<string, number>;
  parseSource?: "reference" | "candidate";
}

export interface CheckRequest {
  id: number;
  referenceLatex: string;
  candidateLatex: string;
  context: CheckContext;
}

export interface CheckResponse {
  id: number;
  result: CheckResult;
}
