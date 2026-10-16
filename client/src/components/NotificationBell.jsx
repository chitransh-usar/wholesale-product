import { Bell } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNotifications } from "../context/NotificationContext";
import { useAuth } from "../context/AuthContext";
import NotificationDropdown from "./NotificationDropdown";

/**
 * The bell, and where its panel goes.
 *
 * CONTROLLED, because the navbar has to be able to shut it. It used to own its
 * open state, and the profile menu owned its own separately, so opening one did
 * not close the other: a person tapped their profile, then tapped the bell, and
 * got both flyouts stacked on top of each other. The navbar now holds one
 * "which menu is open" value and this is told.
 *
 * Each copy of this gets a DIFFERENT key from the navbar, which matters. The
 * navbar mounts two, one for phones and one for desktop, and hides the wrong
 * one with CSS. Sharing a single flag between them is what once broke the city
 * picker outright: the hidden copy's outside-click handler saw a click on the
 * visible copy as a click outside ITSELF and closed the menu on mousedown,
 * destroying the button before the mouseup could land on it. The listener
 * below is only attached while THIS copy is open, so a closed copy has no
 * handler to misfire.
 *
 * POSITIONED FROM THE BUTTON'S RECT, not with `absolute right-0`. That is what
 * it used to be, and since the bell is not the last icon in the row, a 358px
 * panel anchored to the bell's right edge hung 14px off the left of a 390px
 * screen. Measured, at 360 and 390 both. A fixed panel placed from the
 * button and clamped to the viewport cannot do that at any width, whatever
 * else moves into the row later.
 */
const NotificationBell = ({ open = false, onToggle, onClose }) => {
  const { unreadCount } = useNotifications();
  const { isAuthenticated } = useAuth();
  const bellRef = useRef(null);
  const [box, setBox] = useState(null);

  const place = useCallback(() => {
    const rect = bellRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(384, window.innerWidth - 16);
    // Right-aligned to the button, the way a dropdown should read, then pulled
    // back inside the screen if that would put it past either edge.
    const left = Math.max(
      8,
      Math.min(rect.right - width, window.innerWidth - width - 8),
    );
    setBox({ top: rect.bottom + 8, left, width });
  }, []);

  // Before paint, so the panel never shows for a frame in the wrong place.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event) => {
      if (bellRef.current && !bellRef.current.contains(event.target)) {
        onClose?.();
      }
    };
    // The bar is sticky, so the button moves under a scroll and the panel has
    // to follow it or it detaches.
    const reflow = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open, onClose, place]);

  // Nothing to show, and nothing to fetch, until someone is signed in.
  if (!isAuthenticated) return null;

  return (
    <div className="relative" ref={bellRef}>
      <button
        className="relative rounded-full p-2 text-espresso/60 transition-colors hover:bg-sage/10 hover:text-espresso"
        onClick={() => onToggle?.()}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && box && (
        <NotificationDropdown box={box} onClose={() => onClose?.()} />
      )}
    </div>
  );
};

export default NotificationBell;
