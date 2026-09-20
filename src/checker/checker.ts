import {
  ComputeEngine,
  isFunction,
  type Expression,
  type ExpressionInput,
} from "@cortex-js/compute-engine";
import type { CheckContext, CheckResult } from "./types";

type MathJson = string | number | readonly MathJson[] | Record<string, unknown>;

const SAMPLE_VALUES = [-3.25, -2, -0.5, 0.5, 1.25, 2, 4.5, 7.25];
const NUMERIC_TOLERANCE = 1e-9;

function unwrapGroupedDerivativeOperators(latex: string): string {
  let output = "";
  let index = 0;
  while (index < latex.length) {
    if (latex[index] !== "{") {
      output += latex[index];
      index += 1;
      continue;
    }

    let depth = 0;
    let closingIndex = -1;
    for (let cursor = index; cursor < latex.length; cursor += 1) {
      if (latex[cursor] === "{") depth += 1;
      if (latex[cursor] === "}") depth -= 1;
      if (depth === 0) {
        closingIndex = cursor;
        break;
      }
    }
    if (closingIndex < 0) {
      output += latex.slice(index);
      break;
    }

    const group = latex.slice(index + 1, closingIndex);
    const isDerivativeOperator =
      group.trimStart().startsWith("\\frac") &&
      /(?:\\mathrm\{d\}|\\operatorname\{d\}|\bd\b)/.test(group);
    output += isDerivativeOperator ? group : `{${group}}`;
    index = closingIndex + 1;
  }
  return output;
}

function groupLeibnizDerivativeOperands(latex: string): string {
  const derivative = /\\(?:dfrac|frac)\s*\{\s*d\s*\}\s*\{\s*d\s*[A-Za-z][A-Za-z0-9]*\s*\}/g;
  let output = latex;
  let searchFrom = 0;

  while (searchFrom < output.length) {
    derivative.lastIndex = searchFrom;
    const match = derivative.exec(output);
    if (!match) break;

    const operandStart = derivative.lastIndex;
    let braceDepth = 0;
    let parenthesisDepth = 0;
    let operandEnd = output.length;
    let sawContent = false;
    for (let cursor = operandStart; cursor < output.length; cursor += 1) {
      const character = output[cursor];
      const hadContent = sawContent;
      if (character === "{") braceDepth += 1;
      else if (character === "}") braceDepth -= 1;
      else if (character === "(" || character === "[") parenthesisDepth += 1;
      else if (character === ")" || character === "]") parenthesisDepth -= 1;
      else if (!/\s/.test(character)) sawContent = true;

      if (
        hadContent &&
        braceDepth === 0 &&
        parenthesisDepth === 0 &&
        (character === "+" || character === "-")
      ) {
        operandEnd = cursor;
        break;
      }
    }

    const operand = output.slice(operandStart, operandEnd).trim();
    if (!operand) {
      searchFrom = derivative.lastIndex;
      continue;
    }
    const groupedDerivative = `\\left(${output.slice(match.index, operandEnd).trim()}\\right)`;
    output = `${output.slice(0, match.index)}${groupedDerivative}${output.slice(operandEnd)}`;
    searchFrom = match.index + groupedDerivative.length;
  }
  return output;
}

export function normalizeLatex(latex: string): string {
  const cleaned = latex
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replaceAll("−", "-")
    .replace(/\\(?:differentialD|odif)\b/g, "d")
    .replace(/\\(?:mathrm|operatorname|text)\s*\{\s*d\s*\}/g, "d")
    .trim();
  return groupLeibnizDerivativeOperands(unwrapGroupedDerivativeOperators(cleaned));
}

function invalidNotationMessage(expression: Expression, location: "original line" | "this line"): string {
  const errors = expression.errors;
  const incomplete = errors.some((error) => JSON.stringify(error.json).includes("'missing'"));
  if (incomplete) return `The mathematical notation on ${location} is incomplete.`;

  const unexpected = errors.find((error) => JSON.stringify(error.json).includes("'unexpected-command'"));
  if (unexpected) {
    const command = unexpected.latex.match(/\\error\{(\\[A-Za-z]+)\}/)?.[1];
    return command
      ? `The notation ${command} on ${location} is not supported by the checker.`
      : `The mathematical notation on ${location} contains an unsupported command.`;
  }
  return `The mathematical notation on ${location} could not be parsed.`;
}

function result(
  verdict: CheckResult["verdict"],
  method: CheckResult["method"],
  message: string,
  counterexample?: Record<string, number>,
  parseSource?: CheckResult["parseSource"],
): CheckResult {
  return {
    verdict,
    method,
    message,
    ...(counterexample ? { counterexample } : {}),
    ...(parseSource ? { parseSource } : {}),
  };
}

function isArrayExpression(value: MathJson): value is readonly MathJson[] {
  return Array.isArray(value);
}

function makeEngine(
  referenceLatex: string,
  candidateLatex: string,
  context: CheckContext,
): ComputeEngine {
  const discoveryEngine = new ComputeEngine();
  const symbols = new Set([
    ...discoveryEngine.parse(referenceLatex, { form: "raw" }).unknowns,
    ...discoveryEngine.parse(candidateLatex, { form: "raw" }).unknowns,
  ]);

  const engine = new ComputeEngine();
  for (const symbol of symbols) engine.declare(symbol, "real");
  for (const assumption of context.assumptions ?? []) {
    if (assumption.trim()) engine.assume(assumption.trim());
  }
  return engine;
}

function collectDenominators(json: MathJson, output: MathJson[] = []): MathJson[] {
  if (!isArrayExpression(json)) return output;
  const operator = json[0];
  if (operator === "Divide" && json[2] !== undefined) output.push(json[2]);
  if (operator === "Power" && isArrayExpression(json[2])) {
    const exponent = json[2];
    if (exponent[0] === "Negate" || (exponent[0] === "Rational" && Number(exponent[1]) < 0)) {
      if (json[1] !== undefined) output.push(json[1]);
    }
  }
  for (const operand of json.slice(1)) collectDenominators(operand, output);
  return output;
}

function domainsMatch(engine: ComputeEngine, left: Expression, right: Expression): boolean {
  const restrictions = (expression: Expression): Expression[] =>
    collectDenominators(expression.json as MathJson)
      .map((x) => engine.box(x as ExpressionInput).canonical)
      .filter(
        (denominator) =>
          engine.ask(engine.box(["NotEqual", denominator, 0])).length === 0 &&
          (denominator.unknowns.length > 0 ||
            !Number.isFinite(denominator.re) ||
            !Number.isFinite(denominator.im) ||
            Math.hypot(denominator.re, denominator.im) <= NUMERIC_TOLERANCE),
      );
  const leftDomains = restrictions(left);
  const rightDomains = restrictions(right);
  if (leftDomains.length !== rightDomains.length) return false;

  const remaining = [...rightDomains];
  for (const domain of leftDomains) {
    const index = remaining.findIndex((other) => expressionsProvenEqual(engine, domain, other));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function difference(engine: ComputeEngine, left: Expression, right: Expression): Expression {
  return engine.box(["Subtract", left, right]);
}

function isZero(expression: Expression): boolean {
  return expression.is(0) || expression.isSame(0) || (expression.isConstant && expression.re === 0 && expression.im === 0);
}

function expressionsProvenEqual(
  engine: ComputeEngine,
  left: Expression,
  right: Expression,
): boolean {
  if (left.isSame(right)) return true;
  const simplifiedLeft = left.simplify();
  const simplifiedRight = right.simplify();
  if (simplifiedLeft.isSame(simplifiedRight)) return true;
  if (isZero(difference(engine, simplifiedLeft, simplifiedRight).simplify())) return true;
  const delta = difference(engine, left, right);
  if (isZero(delta.simplify())) return true;
  if (isZero(engine.box(["Expand", delta]).evaluate().simplify())) return true;
  return left.isEqual(right) === true;
}

function exactExpressionCheck(
  engine: ComputeEngine,
  left: Expression,
  right: Expression,
  domainsAreEqual: boolean,
): CheckResult | undefined {
  if (domainsAreEqual && (left.isSame(right) || left.canonical.isSame(right.canonical))) {
    return result("equivalent", "canonical", "The expressions have the same canonical form.");
  }

  const evaluatedLeft = left.evaluate();
  const evaluatedRight = right.evaluate();
  if (
    domainsAreEqual &&
    (expressionsProvenEqual(engine, left, right) ||
      expressionsProvenEqual(engine, evaluatedLeft, evaluatedRight))
  ) {
    return result("equivalent", "symbolic", "Symbolic simplification proves equivalence.");
  }

  const simplifiedDelta = difference(engine, evaluatedLeft, evaluatedRight).simplify();
  if (simplifiedDelta.unknowns.length === 0) {
    const numeric = simplifiedDelta.N();
    if (Number.isFinite(numeric.re) && Number.isFinite(numeric.im)) {
      const magnitude = Math.hypot(numeric.re, numeric.im);
      if (magnitude > NUMERIC_TOLERANCE) {
        return result("not-equivalent", "symbolic", "The exact difference is nonzero.");
      }
    }
  }
  return undefined;
}

function equationResidual(engine: ComputeEngine, equation: Expression): Expression | undefined {
  if (!isFunction(equation) || equation.operator !== "Equal" || equation.ops.length !== 2) return undefined;
  return difference(engine, equation.ops[0], equation.ops[1]);
}

function equationCheck(
  engine: ComputeEngine,
  reference: Expression,
  candidate: Expression,
  domainsAreEqual: boolean,
): CheckResult | undefined {
  const left = equationResidual(engine, reference);
  const right = equationResidual(engine, candidate);
  if (!left || !right) return undefined;

  if (domainsAreEqual && expressionsProvenEqual(engine, left, right)) {
    return result(
      "equivalent",
      "equation-normalization",
      "Both equations reduce to the same zero residual.",
    );
  }

  if (domainsAreEqual) {
    const ratio = engine.box(["Divide", left, right]).simplify();
    const ratioIsNonzeroConstant =
      ratio.unknowns.length === 0 && Number.isFinite(ratio.re) && Math.abs(ratio.re) > NUMERIC_TOLERANCE;
    const ratioIsAssumedNonzero = engine.ask(engine.box(["NotEqual", ratio, 0])).length > 0;
    if (ratioIsNonzeroConstant || ratioIsAssumedNonzero) {
      return result(
        "equivalent",
        "equation-normalization",
        ratioIsNonzeroConstant
          ? "The equation residuals differ only by a nonzero constant factor."
          : "Under the stated assumptions, the equation residuals differ only by a nonzero factor.",
      );
    }

    const possibleFactors = [
      ...collectDenominators(left.json as MathJson),
      ...collectDenominators(right.json as MathJson),
    ].map((factor) => engine.box(factor as ExpressionInput).canonical);
    for (const factor of possibleFactors) {
      if (engine.ask(engine.box(["NotEqual", factor, 0])).length === 0) continue;
      if (
        expressionsProvenEqual(engine, left, engine.box(["Multiply", factor, right])) ||
        expressionsProvenEqual(engine, right, engine.box(["Multiply", factor, left]))
      ) {
        return result(
          "equivalent",
          "equation-normalization",
          "Under the stated assumptions, clearing the nonzero denominator produces the original equation.",
        );
      }
    }
  }

  return undefined;
}

function assumptionsHold(
  engine: ComputeEngine,
  assumptions: string[],
  scope: Record<string, number>,
): boolean {
  return assumptions.every((assumption) => engine.parse(assumption).subs(scope).evaluate().json === "True");
}

function equationCounterexample(
  engine: ComputeEngine,
  left: Expression,
  right: Expression,
  assumptions: string[],
): CheckResult | undefined {
  const variables = [...new Set([...left.unknowns, ...right.unknowns])].sort();

  const witness = (source: Expression, target: Expression): Record<string, number> | undefined => {
    for (const solvedVariable of variables) {
      for (let sampleIndex = 0; sampleIndex < SAMPLE_VALUES.length; sampleIndex += 1) {
        const scope: Record<string, number> = {};
        for (const [variableIndex, variable] of variables.entries()) {
          if (variable !== solvedVariable) {
            scope[variable] = SAMPLE_VALUES[(sampleIndex + variableIndex * 3) % SAMPLE_VALUES.length];
          }
        }

        const solutions = source.subs(scope).solve(solvedVariable);
        if (!Array.isArray(solutions)) continue;
        for (const solution of solutions) {
          if (!("N" in solution) || typeof solution.N !== "function") continue;
          const numeric = (solution as unknown as Expression).N();
          if (!Number.isFinite(numeric.re) || !Number.isFinite(numeric.im) || Math.abs(numeric.im) > NUMERIC_TOLERANCE) {
            continue;
          }
          const fullScope = { ...scope, [solvedVariable]: numeric.re };
          if (!assumptionsHold(engine, assumptions, fullScope)) continue;
          const sourceValue = source.subs(fullScope).N();
          const targetValue = target.subs(fullScope).N();
          if (![sourceValue.re, sourceValue.im, targetValue.re, targetValue.im].every(Number.isFinite)) continue;
          const sourceMagnitude = Math.hypot(sourceValue.re, sourceValue.im);
          const targetMagnitude = Math.hypot(targetValue.re, targetValue.im);
          if (sourceMagnitude <= NUMERIC_TOLERANCE && targetMagnitude > NUMERIC_TOLERANCE) return fullScope;
        }
      }
    }
    return undefined;
  };

  const scope = witness(left, right) ?? witness(right, left);
  if (!scope) return undefined;
  return result(
    "not-equivalent",
    "numeric-counterexample",
    "A valid set of values satisfies one equation but not the other.",
    scope,
  );
}

function indefiniteIntegralParts(json: MathJson): { integrand: MathJson; variable: string } | undefined {
  if (!isArrayExpression(json) || json[0] !== "Integrate") return undefined;
  const fn = json[1];
  const limits = json[2];
  if (!isArrayExpression(fn) || fn[0] !== "Function") return undefined;
  if (!isArrayExpression(limits) || limits[0] !== "Limits") return undefined;
  if (limits[2] !== "Nothing" || limits[3] !== "Nothing") return undefined;
  const variable = typeof limits[1] === "string" ? limits[1] : undefined;
  const block = fn[1];
  if (!variable || !isArrayExpression(block) || block[0] !== "Block" || block[1] === undefined) {
    return undefined;
  }
  return { integrand: block[1], variable };
}

function calculusCheck(
  engine: ComputeEngine,
  reference: Expression,
  candidate: Expression,
  assumptions: string[],
): CheckResult | undefined {
  const integral = indefiniteIntegralParts(reference.json as MathJson);
  if (integral && candidate.operator !== "Integrate") {
    const integrand = engine.box(integral.integrand as ExpressionInput);
    const derivative = engine.box(["D", candidate, integral.variable]).evaluate();
    if (expressionsProvenEqual(engine, derivative, integrand)) {
      return result(
        "equivalent",
        "calculus",
        "Differentiating this antiderivative reproduces the integrand.",
      );
    }
    return numericCounterexample(engine, derivative, integrand, assumptions, true);
  }

  if (reference.operator === "D" || candidate.operator === "D") {
    const evaluatedReference = reference.evaluate();
    const evaluatedCandidate = candidate.evaluate();
    const exact = exactExpressionCheck(engine, evaluatedReference, evaluatedCandidate, true);
    if (exact) return { ...exact, method: "calculus" };
    const counterexample = numericCounterexample(
      engine,
      evaluatedReference,
      evaluatedCandidate,
      assumptions,
    );
    if (counterexample) {
      return {
        ...counterexample,
        message: "The evaluated derivative and this line disagree at a valid test point.",
      };
    }
  }
  return undefined;
}

function numericCounterexample(
  engine: ComputeEngine,
  left: Expression,
  right: Expression,
  assumptions: string[],
  calculus = false,
): CheckResult | undefined {
  const variables = [...new Set([...left.unknowns, ...right.unknowns])].sort();
  if (variables.length === 0) return undefined;

  for (let sampleIndex = 0; sampleIndex < SAMPLE_VALUES.length; sampleIndex += 1) {
    const scope: Record<string, number> = {};
    variables.forEach((variable, variableIndex) => {
      scope[variable] = SAMPLE_VALUES[(sampleIndex + variableIndex * 3) % SAMPLE_VALUES.length];
    });
    const satisfiesAssumptions = assumptionsHold(engine, assumptions, scope);
    if (!satisfiesAssumptions) continue;
    const leftValue = left.subs(scope).N();
    const rightValue = right.subs(scope).N();
    if (![leftValue.re, leftValue.im, rightValue.re, rightValue.im].every(Number.isFinite)) continue;
    const delta = Math.hypot(leftValue.re - rightValue.re, leftValue.im - rightValue.im);
    const scale = Math.max(1, Math.hypot(leftValue.re, leftValue.im), Math.hypot(rightValue.re, rightValue.im));
    if (delta > NUMERIC_TOLERANCE * scale) {
      return result(
        "not-equivalent",
        "numeric-counterexample",
        calculus
          ? "The derivative disagrees with the integrand at a valid test point."
          : "The expressions disagree at a valid test point.",
        scope,
      );
    }
  }
  return undefined;
}

export function checkEquivalence(
  referenceLatex: string,
  candidateLatex: string,
  context: CheckContext = {},
): CheckResult {
  referenceLatex = normalizeLatex(referenceLatex);
  candidateLatex = normalizeLatex(candidateLatex);
  if (!referenceLatex.trim()) {
    return result("unknown", "parse-error", "Enter an original expression.", undefined, "reference");
  }

  try {
    const engine = makeEngine(referenceLatex, candidateLatex, context);
    const rawReference = engine.parse(referenceLatex, { form: "raw" });
    if (!rawReference.isValid) {
      return result(
        "unknown",
        "parse-error",
        invalidNotationMessage(rawReference, "original line"),
        undefined,
        "reference",
      );
    }
    if (!candidateLatex.trim()) {
      return result("unknown", "parse-error", "Enter an expression on this line.", undefined, "candidate");
    }
    const rawCandidate = engine.parse(candidateLatex, { form: "raw" });
    if (!rawCandidate.isValid) {
      return result(
        "unknown",
        "parse-error",
        invalidNotationMessage(rawCandidate, "this line"),
        undefined,
        "candidate",
      );
    }

    const reference = engine.parse(referenceLatex);
    const candidate = engine.parse(candidateLatex);
    const domainsAreEqual = domainsMatch(engine, rawReference, rawCandidate);

    const activeAssumptions = context.assumptions ?? [];
    const calculus = calculusCheck(engine, reference, candidate, activeAssumptions);
    if (calculus) return calculus;

    const referenceIsEquation = reference.operator === "Equal";
    const candidateIsEquation = candidate.operator === "Equal";
    if (referenceIsEquation || candidateIsEquation) {
      if (!(referenceIsEquation && candidateIsEquation)) {
        return result("not-equivalent", "equation-normalization", "An equation cannot equal a standalone expression.");
      }
      const equation = equationCheck(engine, reference, candidate, domainsAreEqual);
      if (equation) return equation;
      const leftResidual = equationResidual(engine, reference);
      const rightResidual = equationResidual(engine, candidate);
      if (leftResidual && rightResidual) {
        const counterexample = equationCounterexample(
          engine,
          leftResidual,
          rightResidual,
          activeAssumptions,
        );
        if (counterexample) return counterexample;
      }
      return result(
        "unknown",
        "unsupported",
        domainsAreEqual
          ? "The checker could not prove that these equations have the same solution set."
          : "The equations have different domain restrictions, so equivalence is uncertain.",
      );
    }

    const exact = exactExpressionCheck(engine, reference, candidate, domainsAreEqual);
    if (exact) return exact;

    const counterexample = numericCounterexample(engine, reference, candidate, activeAssumptions);
    if (counterexample) return counterexample;

    return result(
      "unknown",
      "unsupported",
      domainsAreEqual
        ? "No proof or counterexample was found."
        : "Simplification changes a denominator restriction, so equivalence is uncertain.",
    );
  } catch (error) {
    return result(
      "unknown",
      "unsupported",
      error instanceof Error ? `The checker stopped safely: ${error.message}` : "The checker stopped safely.",
    );
  }
}
