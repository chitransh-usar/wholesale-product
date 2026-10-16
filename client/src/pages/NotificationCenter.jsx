import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BellOff } from "lucide-react";
import { useNotifications } from "../context/NotificationContext";

const NotificationCenter = () => {
  const navigate = useNavigate();
  const { notifications, loadNotifications, isLoading, total, markAllRead } =
    useNotifications();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadNotifications({ page: 1 });
    })();
    return () => {
      cancelled = true;
    };
    // The loader is recreated each render; only the first load belongs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-16">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="group rounded-lg p-2 text-espresso/60 transition-colors hover:bg-sage/10 hover:text-espresso"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-black tracking-tight text-espresso">
            Notifications
          </h1>
          <p className="text-sm text-espresso/60">
            Order updates, payments and account alerts.
          </p>
        </div>
        {hasUnread && (
          <button
            onClick={markAllRead}
            className="shrink-0 rounded-xl border border-sage/40 px-3 py-2 text-xs font-bold text-espresso transition-colors hover:bg-sage/10"
          >
            Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sage/40 py-16 text-center">
          <BellOff className="mx-auto mb-3 h-10 w-10 text-espresso/15" />
          <p className="font-bold text-espresso">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-espresso/50">
            Updates about your orders and payments will show up here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${
                  notification.is_read
                    ? "border-sage/20 bg-white/80"
                    : "border-clay/30 bg-clay/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-espresso">
                      {notification.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-espresso/60">
                      {notification.message}
                    </p>
                  </div>
                  {!notification.is_read && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-clay" />
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-espresso/40">
                  <span>
                    {new Date(notification.created_at).toLocaleString("en-IN")}
                  </span>
                  <span className="uppercase tracking-wider">
                    {notification.notification_type}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-espresso/40">
            Showing {notifications.length} of {total}
          </p>
        </>
      )}
    </div>
  );
};

export default NotificationCenter;
