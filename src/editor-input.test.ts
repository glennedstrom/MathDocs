import { describe, expect, it, vi } from "vitest";
import {
  handleMathfieldBeforeInput,
  handleMathfieldKeydown,
} from "./editor-input";

function field(mode: "math" | "latex" | "text" = "math") {
  return {
    mode,
    executeCommand: vi.fn(() => true),
    insert: vi.fn(() => true),
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    key: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    isTrusted: true,
    inputType: "insertText",
    data: null,
    getModifierState: vi.fn(() => false),
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
}

describe("custom keyboard layout input", () => {
  it("starts generic LaTeX command entry from an AltGr backslash", () => {
    const mathfield = field();
    const keyboardEvent = event({ key: "\\", ctrlKey: true, altKey: true });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(true);
    expect(mathfield.executeCommand).toHaveBeenCalledWith([
      "switchMode",
      "latex",
      "",
      "\\",
    ]);
    expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it("uses beforeinput when a custom layout reports an unidentified key", () => {
    const mathfield = field();
    const inputEvent = event({ data: "\\" });

    expect(handleMathfieldBeforeInput(mathfield, inputEvent)).toBe(true);
    expect(mathfield.executeCommand).toHaveBeenCalledWith([
      "switchMode",
      "latex",
      "",
      "\\",
    ]);
  });

  it("accepts any LaTeX command through MathLive's completion command", () => {
    const mathfield = field("latex");
    const keyboardEvent = event({ key: "Enter" });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(true);
    expect(mathfield.executeCommand).toHaveBeenCalledWith([
      "complete",
      "accept-all",
    ]);
  });

  it("does not hijack real command shortcuts", () => {
    const mathfield = field();
    const keyboardEvent = event({ key: "\\", ctrlKey: true });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(false);
    expect(mathfield.executeCommand).not.toHaveBeenCalled();
  });
});
