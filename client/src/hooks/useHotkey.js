import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts, declared where they act.
 *
 * One document listener and a registry, rather than an addEventListener in
 * every screen that wants a key. That is not tidiness for its own sake: the
 * help list is built from the registry, so a shortcut cannot exist without
 * being listed, and a binding registered by a form is removed when the form
 * unmounts rather than firing on whatever page came next.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MATTERS
 * ---------------------------------------------------------------------------
 * A bare key never fires while somebody is typing. A wholesaler putting "n"
 * into a customer's name must not get a new sale form. So a binding with no
 * modifier is ignored whenever the focus is in an input, a textarea, a select
 * or anything contenteditable.
 *
 * Anything that has to work WHILE typing therefore needs a modifier, which is
 * why saving is mod+s and adding a line is alt+n rather than bare letters.
 * Those are allowed through, because they are mid-form when they want them and
 * that is the whole point.
 */

// mod is Cmd on a Mac and Ctrl everywhere else, so one binding covers both.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const parse = (combo) => {
  const parts = String(combo).toLowerCase().split("+");
  const key = parts[parts.length - 1];
  return {
    key,
    mod: parts.includes("mod"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
    bare: parts.length === 1,
  };
};

/** How a combo should read on screen, for the help list. */
export const prettyCombo = (combo) =>
  String(combo)
    .split("+")
    .map((part) => {
      const p = part.toLowerCase();
      if (p === "mod") return IS_MAC ? "⌘" : "Ctrl";
      if (p === "alt") return IS_MAC ? "⌥" : "Alt";
      if (p === "shift") return "Shift";
      if (p === "enter") return "Enter";
      if (p === "escape") return "Esc";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(IS_MAC ? "" : " + ");

// Every live binding. A Map keyed by an object identity, so two screens can
// bind the same combo without colliding and the newest wins.
const registry = new Map();
let listening = false;

const isTyping = (target) => {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable === true
  );
};

const onKeyDown = (event) => {
  const typing = isTyping(event.target);

  // Newest first, so a form's binding beats a page-level one of the same name.
  const entries = [...registry.values()].reverse();

  for (const entry of entries) {
    if (entry.enabled === false) continue;
    const c = entry.parsed;

    if (c.key !== String(event.key).toLowerCase()) continue;
    if (c.mod !== (event.metaKey || event.ctrlKey)) continue;
    if (c.alt !== event.altKey) continue;
    // Shift is only compared when the binding asks for it: "?" already needs
    // shift on most layouts and demanding it be declared would be noise.
    if (c.shift && !event.shiftKey) continue;

    if (typing && c.bare && !entry.allowInInput) continue;

    event.preventDefault();
    entry.handler(event);
    return;
  }
};

const ensureListening = () => {
  if (listening) return;
  document.addEventListener("keydown", onKeyDown);
  listening = true;
};

/** Every binding currently live, for the help list. */
export const listHotkeys = () =>
  [...registry.values()]
    .filter((e) => e.label && e.enabled !== false)
    .map((e) => ({ combo: e.combo, label: e.label, group: e.group || "" }));

/**
 * @param {string} combo   "mod+s", "alt+n", "alt+enter", "mod+k", "/"
 * @param {Function} handler
 * @param {object} [options]
 * @param {boolean} [options.enabled]       skip while false, without unbinding
 * @param {boolean} [options.allowInInput]  let a BARE key fire while typing
 * @param {string}  [options.label]         shown in the help list
 * @param {string}  [options.group]         heading in the help list
 */
export const useHotkey = (combo, handler, options = {}) => {
  const { enabled = true, allowInInput = false, label, group } = options;

  // Held in a ref so a handler that closes over fresh state does not need the
  // binding to be torn down and rebuilt on every render. Written in an effect
  // rather than during render, which React 19 rightly refuses: a render can be
  // thrown away, and a ref written by one that was would be stale.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const id = {};
    registry.set(id, {
      combo,
      parsed: parse(combo),
      handler: (event) => handlerRef.current?.(event),
      enabled,
      allowInInput,
      label,
      group,
    });
    ensureListening();
    return () => registry.delete(id);
  }, [combo, enabled, allowInInput, label, group]);
};

export default useHotkey;
