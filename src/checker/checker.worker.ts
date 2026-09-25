/// <reference lib="webworker" />

import { checkAssumptionConsistency, checkEquivalence, validateAssumption } from "./checker";
import type { WorkerRequest, WorkerResponse } from "./types";

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const response: WorkerResponse = request.kind === "validate-assumption"
    ? {
        kind: "validate-assumption",
        id: request.id,
        result: validateAssumption(request.latex),
      }
    : request.kind === "check-assumptions"
      ? {
          kind: "check-assumptions",
          id: request.id,
          result: checkAssumptionConsistency(request.assumptions, request.referenceLatex),
        }
    : {
        kind: "check",
        id: request.id,
        result: checkEquivalence(request.referenceLatex, request.candidateLatex, request.context),
      };
  self.postMessage(response);
});
