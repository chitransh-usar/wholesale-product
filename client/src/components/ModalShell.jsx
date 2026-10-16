import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The shell every modal in this product should sit in.
 *
 * There were two conventions and fourteen modals. Three used this; the rest
 * each built their own overlay, with different z-indexes, different overlay
 * opacities, and no scroll lock, which is why a new one never quite matched
 * the last one. This is the one to use.
 *
 * ---------------------------------------------------------------------------
 * ESCAPE CLOSES IT, AND NOTHING USED TO
 * ---------------------------------------------------------------------------
 * Not one modal in the product closed on Escape. The only two keydown
 * handlers anywhere in the client were in ItemPicker and MyProducts. Escape
 * is the first thing anybody who types for a living reaches for, and having
 * it do nothing makes the whole product feel like it is not listening.
 *
 * Handled here rather than in each modal, so it cannot be forgotten in the
 * next one. The listener is bound per open modal and removed on unmount, and
 * stacked modals do not both close: only the one on top does, because the
 * others stop listening while they are covered.
 */

// Which shells are open, in the order they opened. The last one is on top
// and is the only one Escape reaches.
const stack = [];

const ModalShell = ({
  onClose,
  children,
  maxWidth = "max-w-md",
  /** Set false for a modal mid-save that must not be dismissed by accident. */
  closeOnEscape = true,
  /** Set false where a stray click on the overlay would lose typed work. */
  closeOnOverlayClick = true,
  labelledBy,
  /**
   * A heading and a footer that stay put while the body scrolls.
   *
   * Not decoration. The hand-rolled form modals all pinned their Save button
   * below the scroll area on purpose: on a phone, a long customer form pushes
   * a scrolling button off the bottom and it looks as though there is no way
   * to save. Passing them here keeps that, and keeps it consistent, which a
   * single scroll region could not.
   */
  title,
  footer,
}) => {
  const panelRef = useRef(null);
  const id = useRef({});

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    const me = id.current;
    stack.push(me);

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      // Only the topmost shell responds, so closing a confirmation opened on
      // top of a form does not take the form with it.
      if (stack[stack.length - 1] !== me) return;
      if (!closeOnEscape) return;
      event.stopPropagation();
      onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const at = stack.indexOf(me);
      if (at !== -1) stack.splice(at, 1);
    };
  }, [onClose, closeOnEscape]);

  /**
   * The first field, focused on open.
   *
   * Without this a modal opens and the cursor is still behind it on the page,
   * so the first thing typed goes nowhere and Tab walks the page underneath
   * rather than the form in front. Skips anything marked data-autofocus="off",
   * for a destructive confirmation where landing on the button is wrong.
   */
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const target = panel.querySelector(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [data-autofocus="on"]',
    );
    if (target && target.dataset.autofocus !== "off") {
      // After paint, or the browser scrolls the page behind the overlay.
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-950/70"
      onClick={closeOnOverlayClick ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${maxWidth} sm:mx-4 rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[85vh] flex flex-col overflow-hidden`}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <span className="h-1 w-10 rounded-full bg-slate-200" />
        </div>

        {title && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
            {/* A plain string is the heading. A node is rendered as given, for
                the modals that carry a second line under it, such as the bill
                number a credit note is reversing. */}
            {typeof title === "string" ? (
              <h3 id={labelledBy} className="text-lg font-black text-espresso">
                {title}
              </h3>
            ) : (
              <div id={labelledBy} className="min-w-0">
                {title}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              data-autofocus="off"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#cbd5e1 transparent",
          }}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default ModalShell;
