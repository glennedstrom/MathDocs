export type Verdict = "equivalent" | "equivalent-domain-change" | "not-equivalent" | "unknown";

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
  kind: "check";
  id: number;
  referenceLatex: string;
  candidateLatex: string;
  context: CheckContext;
}

export interface CheckResponse {
  kind: "check";
  id: number;
  result: CheckResult;
}

export interface AssumptionValidationResult {
  valid: boolean;
  message: string;
  latex: string;
}

export interface AssumptionConsistencyResult {
  contradiction: boolean;
  message: string;
  conflictingIndices: number[];
}

export interface AssumptionValidationRequest {
  kind: "validate-assumption";
  id: number;
  latex: string;
}

export interface AssumptionValidationResponse {
  kind: "validate-assumption";
  id: number;
  result: AssumptionValidationResult;
}

export interface AssumptionConsistencyRequest {
  kind: "check-assumptions";
  id: number;
  assumptions: string[];
  referenceLatex: string;
}

export interface AssumptionConsistencyResponse {
  kind: "check-assumptions";
  id: number;
  result: AssumptionConsistencyResult;
}

export type WorkerRequest = CheckRequest | AssumptionValidationRequest | AssumptionConsistencyRequest;
export type WorkerResponse = CheckResponse | AssumptionValidationResponse | AssumptionConsistencyResponse;
