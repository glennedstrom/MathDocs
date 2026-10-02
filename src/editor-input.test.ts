import { describe, expect, it, vi } from "vitest";
import {
  configureCommandTemplates,
  handleMathfieldBeforeInput,
  handleMathfieldKeydown,
} from "./editor-input";

function field(mode: "math" | "latex" | "text" = "math") {
  return {
    mode,
    selection: { ranges: [[0, 0]] as [number, number][] },
    getValue: vi.fn(() => ""),
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

  it.each(["\\sqrt", "\\sqrt{", "\\sqrt{}"])("fills the missing argument of %s with a placeholder", (command) => {
    const mathfield = field("latex");
    mathfield.getValue.mockReturnValue(command);
    configureCommandTemplates(mathfield, {
      sqrt: "\\sqrt{#?}",
      nthroot: "\\sqrt[#?]{#?}",
      frac: "\\frac{#?}{#?}",
    });

    handleMathfieldKeydown(mathfield, event({ key: "Tab" }));

    expect(mathfield.insert).toHaveBeenCalledWith("\\sqrt{#?}", {
      format: "latex",
      mode: "math",
      selectionMode: "placeholder",
    });
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

  it.each(["Tab", "Enter"])("renders a LaTeX command on %s and consumes the event", (key) => {
    const mathfield = field("latex");
    const keyboardEvent = event({ key });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(true);
    expect(mathfield.executeCommand).toHaveBeenCalledWith([
      "complete",
      "accept-all",
    ]);
    expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
    expect(keyboardEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("does not render a pending command on Escape", () => {
    const mathfield = field("latex");
    const keyboardEvent = event({ key: "Escape" });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(true);
    expect(mathfield.executeCommand).not.toHaveBeenCalled();
    expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves Enter available for creating a new row after completion", () => {
    const mathfield = field("math");
    const keyboardEvent = event({ key: "Enter" });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(false);
    expect(keyboardEvent.preventDefault).not.toHaveBeenCalled();
    expect(keyboardEvent.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it.each([" ", "}"])("keeps %j as raw LaTeX instead of triggering completion", (key) => {
    const mathfield = field("latex");
    const keyboardEvent = event({ key });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(true);
    expect(mathfield.insert).toHaveBeenCalledWith(key, {
      format: "latex",
      mode: "latex",
      selectionMode: "after",
    });
    expect(mathfield.executeCommand).not.toHaveBeenCalled();
  });

  it("does not hijack real command shortcuts", () => {
    const mathfield = field();
    const keyboardEvent = event({ key: "\\", ctrlKey: true });

    expect(handleMathfieldKeydown(mathfield, keyboardEvent)).toBe(false);
    expect(mathfield.executeCommand).not.toHaveBeenCalled();
  });
});
