import { describe, expect, it } from "vitest";
import { parseEquationCsv, serializeEquationCsv } from "./csv";

describe("equation CSV", () => {
  it("reads the first field and supports quoted commas", () => {
    expect(parseEquationCsv('"x, y",note\n"x^2+1"\n')).toEqual(["x, y", "x^2+1"]);
  });

  it("round-trips equations that contain commas and quotes", () => {
    const equations = ["x+1", "f(x, y)", '\\text{"quoted"}'];
    expect(parseEquationCsv(serializeEquationCsv(equations))).toEqual(equations);
  });
});
