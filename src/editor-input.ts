import type { MathfieldElement } from "mathlive";

type EditableMathfield = Pick<
  MathfieldElement,
  "executeCommand" | "insert" | "mode"
>;

type ConsumableEvent = Pick<Event, "preventDefault" | "stopImmediatePropagation">;

type MathfieldKeyboardEvent = ConsumableEvent &
  Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "getModifierState" | "isComposing" | "key" | "metaKey"
  >;

type MathfieldBeforeInputEvent = ConsumableEvent &
  Pick<InputEvent, "data" | "inputType" | "isTrusted">;

function consume(event: ConsumableEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Handle layout-sensitive math characters by their produced value rather than
 * their physical key code. MathLive's built-in layout detection only knows a
 * finite set of keyboard layouts, while Windows MSKLC layouts can put these
 * characters on any physical key.
 */
function handleMathControlCharacter(
  field: EditableMathfield,
  character: string,
  event: ConsumableEvent,
): boolean {
  if (character === "\\" && field.mode !== "latex") {
    consume(event);
    field.executeCommand(["switchMode", "latex", "", "\\"]);
    return true;
  }

  if (character === "/" && field.mode === "math") {
    consume(event);
    field.insert("\\frac{#@}{#?}", {
      format: "latex",
      mode: "math",
      selectionMode: "placeholder",
    });
    return true;
  }

  return false;
}

export function handleMathfieldKeydown(
  field: EditableMathfield,
  event: MathfieldKeyboardEvent,
): boolean {
  if (event.key === "Enter" && field.mode === "latex") {
    consume(event);
    field.executeCommand(["complete", "accept-all"]);
    return true;
  }

  // Windows commonly exposes AltGr as Ctrl+Alt. It is a text-producing
  // modifier, not a command shortcut.
  const usesAltGraph =
    event.getModifierState("AltGraph") || (event.ctrlKey && event.altKey);
  const usesCommandModifier =
    event.metaKey || ((event.ctrlKey || event.altKey) && !usesAltGraph);
  if (event.isComposing || usesCommandModifier) return false;

  return handleMathControlCharacter(field, event.key, event);
}

export function handleMathfieldBeforeInput(
  field: EditableMathfield,
  event: MathfieldBeforeInputEvent,
): boolean {
  // This is a fallback for custom layouts whose keydown event has key
  // "Unidentified". The trusted beforeinput event contains the character that
  // Windows and the browser actually produced.
  if (!event.isTrusted || event.inputType !== "insertText" || !event.data) {
    return false;
  }
  return handleMathControlCharacter(field, event.data, event);
}
