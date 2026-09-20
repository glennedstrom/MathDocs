/// <reference lib="webworker" />

import { checkEquivalence, validateAssumption } from "./checker";
import type { WorkerRequest, WorkerResponse } from "./types";

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const response: WorkerResponse = request.kind === "validate-assumption"
    ? {
        kind: "validate-assumption",
        id: request.id,
        result: validateAssumption(request.latex),
      }
    : {
        kind: "check",
        id: request.id,
        result: checkEquivalence(request.referenceLatex, request.candidateLatex, request.context),
      };
  self.postMessage(response);
});
