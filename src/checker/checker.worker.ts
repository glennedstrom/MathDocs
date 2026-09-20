/// <reference lib="webworker" />

import { checkEquivalence } from "./checker";
import type { CheckRequest, CheckResponse } from "./types";

self.addEventListener("message", (event: MessageEvent<CheckRequest>) => {
  const request = event.data;
  const response: CheckResponse = {
    id: request.id,
    result: checkEquivalence(request.referenceLatex, request.candidateLatex, request.context),
  };
  self.postMessage(response);
});
