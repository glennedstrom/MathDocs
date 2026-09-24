import { describe, expect, it } from "vitest";
import { checkEquivalence, validateAssumption } from "./checker";

describe("validateAssumption", () => {
  it("accepts a rendered relation", () => {
    expect(validateAssumption("x>0").valid).toBe(true);
    expect(validateAssumption("a\\ne0").valid).toBe(true);
  });

  it("rejects malformed notation and standalone expressions", () => {
    expect(validateAssumption("x>").valid).toBe(false);
    expect(validateAssumption("x+1").valid).toBe(false);
  });
});

describe("checkEquivalence", () => {
  it("proves expanded polynomial identities", () => {
    expect(checkEquivalence("(x+1)^2", "x^2+2x+1").verdict).toBe("equivalent");
  });

  it("proves trigonometric identities", () => {
    expect(checkEquivalence("\\sin^2 x+\\cos^2 x", "1").verdict).toBe("equivalent");
  });

  it("finds a counterexample for a false square-root identity", () => {
    expect(checkEquivalence("\\sqrt{x^2}", "x").verdict).toBe("not-equivalent");
  });

  it("normalizes equations up to a nonzero constant", () => {
    expect(checkEquivalence("2x=2", "x=1").verdict).toBe("equivalent");
  });

  it("normalizes a multivariable equation from the historical corpus", () => {
    expect(checkEquivalence("y=b+mx", "-b+y=mx").verdict).toBe("equivalent");
  });

  it("rejects a transformation that drops the x factor", () => {
    const checked = checkEquivalence("y=mx+b", "y-b=m", { assumptions: ["x!=0"] });
    expect(checked.verdict, JSON.stringify(checked)).toBe("not-equivalent");
    expect(checked.counterexample).toBeDefined();
  });

  it("accepts division by a value explicitly assumed nonzero", () => {
    const checked = checkEquivalence("y=mx+b", "\\frac{y-b}{x}=m", {
      assumptions: ["x!=0"],
    });
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("distinguishes an equivalent identity that narrows the domain", () => {
    const checked = checkEquivalence(
      "\\tan x=\\frac{\\sin x}{\\cos x}",
      "\\frac{\\tan x}{\\sin x}=\\frac{1}{\\cos x}",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent-domain-change");
  });

  it("rejects a false identity even when its domain also changes", () => {
    const checked = checkEquivalence(
      "\\tan x=\\frac{\\sin x}{\\cos x}",
      "\\frac{\\tan x}{\\sin x}=\\frac{x}{\\cos x}",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("not-equivalent");
    expect(checked.counterexample).toBeDefined();
  });

  it("rejects equations that lose a root", () => {
    expect(checkEquivalence("x^2=1", "x=1").verdict).toBe("not-equivalent");
  });

  it("evaluates derivative notation", () => {
    expect(checkEquivalence("\\frac{d}{dx}x^3", "3x^2").verdict).toBe("equivalent");
  });

  it("normalizes MathLive's grouped derivative fraction", () => {
    const checked = checkEquivalence("{\\frac{\\mathrm{d}}{\\mathrm{d}x}}x^5", "5x^4");
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("accepts mixed roman derivative notation", () => {
    const checked = checkEquivalence("\\frac{d}{\\mathrm{d}x}x^5", "5x^4");
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("rejects an incorrect ordinary derivative", () => {
    const checked = checkEquivalence("\\frac{d}{\\mathrm{d}x}x^5", "4x^3");
    expect(checked.verdict, JSON.stringify(checked)).toBe("not-equivalent");
    expect(checked.counterexample).toBeDefined();
  });

  it("parses a MathLive-grouped derivative operator inside a product", () => {
    const checked = checkEquivalence(
      "\\frac{d}{dx}\\left(x^5\\cos x\\right)",
      "5x^4\\cdot{\\frac{d}{\\mathrm{d}x}}\\cos x",
    );
    expect(checked.method, JSON.stringify(checked)).not.toBe("parse-error");
    expect(checked.verdict, JSON.stringify(checked)).toBe("not-equivalent");
  });

  it("accepts a product-rule step containing a derivative in the middle", () => {
    const checked = checkEquivalence(
      "\\frac{d}{dx}\\left(x^5\\cos x\\right)",
      "5x^4\\cos x+x^5{\\frac{d}{\\mathrm{d}x}}\\cos x",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("evaluates a parenthesized polynomial derivative entered through MathLive", () => {
    const checked = checkEquivalence(
      "{\\frac{d}{\\mathrm{d}x}}\\left(4x^3+6x^2+3x+9\\right)",
      "12x^2+12x+3",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("ignores derivative typography commands and invisible paste characters", () => {
    const checked = checkEquivalence(
      "\u200B{\\frac{\\operatorname{d}}{\\mathrm{d}x}}\\left(4x^3+6x^2+3x+9\\right)\u2060",
      "12x^2+12x+3",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("translates MathLive's differentialD macro", () => {
    const checked = checkEquivalence("\\frac{d}{\\differentialD x}x^5", "5x^4");
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("applies repeated Leibniz operators to their individual sum terms", () => {
    const checked = checkEquivalence(
      "\\frac{d}{\\differentialD x}\\left(4x^3+6x^2+3x+9\\right)",
      "\\frac{d}{\\differentialD x}4x^3+\\frac{d}{\\differentialD x}6x^2+" +
        "\\frac{d}{\\differentialD x}3x+\\frac{d}{\\differentialD x}9",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("keeps a trailing sum term outside a derivative with a Greek variable", () => {
    const checked = checkEquivalence(
      "\\frac{\\differentialD}{\\differentialD\\theta}\\sin\\left(\\frac{\\pi}{2}-\\theta\\right)\\cdot\\theta^2",
      "\\frac{\\differentialD}{\\differentialD\\theta}\\theta^2\\sin\\left(\\frac{\\pi}{2}-\\theta\\right)+4",
    );
    expect(checked.verdict, JSON.stringify(checked)).toBe("not-equivalent");
  });

  it("reports unsupported commands specifically", () => {
    const checked = checkEquivalence("\\notARealMathCommand x", "x");
    expect(checked.method).toBe("parse-error");
    expect(checked.message).toContain("not supported");
  });

  it("checks indefinite integrals by differentiation", () => {
    expect(checkEquivalence("\\int x^2\\,dx", "x^3/3+C").verdict).toBe("equivalent");
  });

  it("checks common trigonometric antiderivatives", () => {
    const checked = checkEquivalence("\\int \\tan x\\,dx", "\\ln(\\left|\\sec x\\right|)");
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("evaluates definite integrals exactly", () => {
    const checked = checkEquivalence("\\int_0^2 x^2\\,dx", "8/3");
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("uses explicit real-variable assumptions", () => {
    const checked = checkEquivalence("\\sqrt{x^2}", "x", { assumptions: ["x>0"] });
    expect(checked.verdict, JSON.stringify(checked)).toBe("equivalent");
  });

  it("retains removable denominator restrictions", () => {
    expect(checkEquivalence("\\frac{x^2-1}{x-1}", "x+1").verdict).toBe("equivalent-domain-change");
  });

  it("does not erase the domain of x divided by itself", () => {
    expect(checkEquivalence("x/x", "1").verdict).toBe("equivalent-domain-change");
  });

  it("reports invalid notation without throwing", () => {
    const checked = checkEquivalence("x+1", "\\frac{");
    expect(checked.verdict).toBe("unknown");
    expect(checked.method).toBe("parse-error");
    expect(checked.parseSource).toBe("candidate");
  });

  it("identifies parse errors in the original expression", () => {
    const checked = checkEquivalence("\\frac{", "5x^4");
    expect(checked.verdict).toBe("unknown");
    expect(checked.parseSource).toBe("reference");
  });

  it("validates an invalid original before an empty new step", () => {
    const checked = checkEquivalence("\\frac{", "");
    expect(checked.verdict).toBe("unknown");
    expect(checked.parseSource).toBe("reference");
  });
});
