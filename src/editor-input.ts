import type { MathfieldElement } from "mathlive";

type EditableMathfield = Pick<
  MathfieldElement,
  "executeCommand" | "insert" | "mode" | "selection" | "getValue"
>;

const commandTemplates = new WeakMap<EditableMathfield, Map<string, string>>();

export function configureCommandTemplates(
  field: EditableMathfield,
  shortcuts: MathfieldElement["inlineShortcuts"],
): void {
  const templates = new Map<string, string>();
  for (const shortcut of Object.values(shortcuts)) {
    const template = typeof shortcut === "string" ? shortcut : shortcut.value;
    const command = template.match(/^(\\[a-zA-Z]+)(?=[{[_^])/u)?.[1];
    if (command && template.includes("#?")) {
      const existing = templates.get(command);
      // Prefer the basic command over variants such as cbrt/nthroot, which
      // share \\sqrt but add an optional index before its main argument.
      if (!existing || template.length < existing.length) {
        templates.set(command, template);
      }
    }
  }
  commandTemplates.set(field, templates);
}

function completeCommand(field: EditableMathfield): void {
  field.executeCommand(["complete", "accept-all"]);
  // Bare commands with missing arguments are selected as a whole by MathLive.
  // Replace that incomplete selection using its built-in shortcut templates.
  // No template is needed for symbols such as \\mu, whose caret is already after
  // the rendered symbol, or for commands with arguments already supplied.
  const selected = field.getValue(field.selection);
  const command = selected.match(/^(\\[a-zA-Z]+)(?:\{\}|\{)*$/u)?.[1];
  const template = command ? commandTemplates.get(field)?.get(command) : undefined;
  if (template) {
    field.insert(template, {
      format: "latex",
      mode: "math",
      selectionMode: "placeholder",
    });
  }
}

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
  // Windows commonly exposes AltGr as Ctrl+Alt. It is a text-producing
  // modifier, not a command shortcut.
  const usesAltGraph =
    event.getModifierState("AltGraph") || (event.ctrlKey && event.altKey);
  const usesCommandModifier =
    event.metaKey || ((event.ctrlKey || event.altKey) && !usesAltGraph);
  if (event.isComposing || usesCommandModifier) return false;

  if (field.mode === "latex") {
    if (event.key === "Tab" || event.key === "Enter") {
      consume(event);
      completeCommand(field);
      return true;
    }
    if (event.key === "Escape") {
      // Keep unfinished LaTeX in the editor.
      consume(event);
      return true;
    }
    if (event.key === " " || event.key === "}") {
      // MathLive automatically completes on Space or a final closing brace.
      // Insert these literally so rendering requires Tab or Enter.
      consume(event);
      field.insert(event.key, {
        format: "latex",
        mode: "latex",
        selectionMode: "after",
      });
      return true;
    }
  }

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
  if (field.mode === "latex" && (event.data === " " || event.data === "}")) {
    consume(event);
    field.insert(event.data, {
      format: "latex",
      mode: "latex",
      selectionMode: "after",
    });
    return true;
  }
  return handleMathControlCharacter(field, event.data, event);
}
