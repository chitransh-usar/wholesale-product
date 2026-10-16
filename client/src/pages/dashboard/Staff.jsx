import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Power,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import api from "../../utils/axios";

/**
 * The people who work on this wholesaler's book.
 *
 * Owner only, and the server says so too. An employee who could edit
 * permissions could give themselves the rest of them, so this is the one part of
 * the dashboard that is not delegable.
 *
 * The page is built around the two questions an owner actually has: who can
 * open my book, and what can each of them touch. Everything else, the dates
 * and the codes, is secondary and reads as detail rather than as the point.
 */

const when = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

const STATUS = {
  invited: {
    label: "Waiting to join",
    style: "border-amber-200 bg-amber-50 text-amber-700",
  },
  active: {
    label: "Working",
    style: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  disabled: {
    label: "Turned off",
    style: "border-slate-200 bg-slate-100 text-slate-500",
  },
};

const Staff = () => {
  const [staff, setStaff] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [working, setWorking] = useState(null);
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await api.get("/api/staff");
        if (cancelled) return;
        setStaff(Array.isArray(data.staff) ? data.staff : []);
        setCatalogue(Array.isArray(data.permissions) ? data.permissions : []);
        setLoadError("");
      } catch (err) {
        if (cancelled) return;
        // An empty list and a failed load look identical on screen unless one
        // of them says so, and "you have no staff" is a bad thing to tell
        // somebody who has four.
        setLoadError(
          err.response?.data?.message ||
            "We could not load your staff just now.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const replace = (updated) =>
    setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

  const togglePermission = async (person, key) => {
    const next = person.permissions.includes(key)
      ? person.permissions.filter((p) => p !== key)
      : [...person.permissions, key];

    setWorking(person.id);
    try {
      const { data } = await api.patch(`/api/staff/${person.id}`, {
        permissions: next,
      });
      replace(data.staff);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save that change");
    } finally {
      setWorking(null);
    }
  };

  const setStatus = async (person, status) => {
    setWorking(person.id);
    try {
      const { data } = await api.post(`/api/staff/${person.id}/status`, {
        status,
      });
      replace(data.staff);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not change this");
    } finally {
      setWorking(null);
    }
  };

  const newCode = async (person) => {
    setWorking(person.id);
    try {
      const { data } = await api.post(`/api/staff/${person.id}/invite`);
      replace(data.staff);
      toast.success("New code made. The old one no longer works.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not make a new code");
    } finally {
      setWorking(null);
    }
  };

  const remove = async (person) => {
    setWorking(person.id);
    try {
      const { data } = await api.delete(`/api/staff/${person.id}`);
      setStaff((prev) => prev.filter((s) => s.id !== person.id));
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not remove this person");
    } finally {
      setWorking(null);
      setRemoving(null);
    }
  };

  const copyCode = async (person) => {
    const link = `${window.location.origin}/join?code=${encodeURIComponent(person.inviteCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied. Send it to them on WhatsApp.");
    } catch {
      // Clipboard is blocked on some phones. The code is on screen anyway.
      toast.error("Could not copy. Read them the code on the screen.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-espresso sm:text-2xl">
            Your staff
          </h2>
          <p className="mt-1 max-w-lg text-sm text-slate-500">
            People who can open your book and work in it on your behalf. Nobody
            here can change your business details, your GST number or this page.
          </p>
        </div>
        <button
          onClick={() => setInviting(true)}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          <UserPlus className="h-4 w-4" />
          Add someone
        </button>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-clay/30 bg-clay/5 py-14 text-center">
          <p className="font-bold text-espresso">{loadError}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-4 cursor-pointer rounded-xl bg-clay px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-espresso"
          >
            Try again
          </button>
        </div>
      ) : staff.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sage/40 py-14 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-espresso/15" />
          <p className="font-bold text-espresso">You work alone at the moment</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Add your nephew, your munim or anyone who helps you, and they get their
            own login instead of using yours. Everything they do is recorded
            under their name.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {staff.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              catalogue={catalogue}
              busy={working === person.id}
              onToggle={togglePermission}
              onStatus={setStatus}
              onNewCode={newCode}
              onCopy={copyCode}
              onRemove={setRemoving}
            />
          ))}
        </div>
      )}

      {removing && (
        <RemoveModal
          person={removing}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
          busy={working === removing.id}
        />
      )}

      {inviting && (
        <InviteModal
          catalogue={catalogue}
          onClose={() => setInviting(false)}
          onInvited={(person) => setStaff((prev) => [person, ...prev])}
        />
      )}
    </div>
  );
};

const PersonCard = ({
  person,
  catalogue,
  busy,
  onToggle,
  onStatus,
  onNewCode,
  onCopy,
  onRemove,
}) => {
  const status = STATUS[person.status] || STATUS.invited;
  const off = person.status === "disabled";

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-opacity sm:p-5 ${
        off ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold text-espresso">
              {person.name}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${status.style}`}
            >
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[person.phone, person.email].filter(Boolean).join(" · ") ||
              "No phone or email"}
          </p>
          {person.status === "active" && (
            <p className="mt-0.5 text-xs text-slate-400">
              {person.lastSeenAt
                ? `Last opened your book ${when(person.lastSeenAt)}`
                : "Has not opened your book yet"}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onStatus(person, off ? "active" : "disabled")}
            disabled={busy}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
              off
                ? "border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                : "border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {/* An invite turned off goes back to invited with a fresh code,
                not straight to working, so the word has to match. */}
            {off
              ? person.hasAccount
                ? "Turn back on"
                : "Invite again"
              : person.hasAccount
                ? "Turn off"
                : "Cancel invite"}
          </button>
          <button
            onClick={() => onRemove(person)}
            disabled={busy}
            aria-label={`Remove ${person.name}`}
            title="Remove from your staff"
            className="cursor-pointer rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {person.status === "invited" && person.inviteCode && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">
            They have not joined yet. Send them this link and they choose their own
            password.
          </p>
          <p className="mt-2 break-all rounded-lg bg-white/70 px-2.5 py-2 font-mono text-[11px] text-espresso">
            {person.inviteCode}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => onCopy(person)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy the link
            </button>
            <button
              onClick={() => onNewCode(person)}
              disabled={busy}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Make a new code
            </button>
          </div>
          {person.inviteExpiresAt && (
            <p className="mt-2 text-[11px] text-amber-800">
              This code stops working on {when(person.inviteExpiresAt)}.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          What they can do
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalogue.map((permission) => {
            const on = person.permissions.includes(permission.key);
            return (
              <button
                key={permission.key}
                onClick={() => onToggle(person, permission.key)}
                disabled={busy || off}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  on
                    ? "border-sage/40 bg-sage/5"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on
                      ? "border-sage bg-sage text-white"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-espresso">
                    {permission.label}
                  </span>
                  <span className="block text-[11px] leading-snug text-slate-500">
                    {permission.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * Removing somebody, which is the one thing on this page that cannot be undone.
 *
 * It says what actually happens rather than asking "are you sure". A man who
 * has done work keeps their history and only loses their way in; an invite that was
 * never used simply goes. Those are different enough to be worth two sentences.
 */
const RemoveModal = ({ person, onClose, onConfirm, busy }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
      <h3 className="flex items-center gap-2 text-base font-bold text-espresso">
        <Trash2 className="h-5 w-5 text-rose-500" />
        Remove {person.name}?
      </h3>

      <p className="mt-3 text-sm text-slate-600">
        {person.hasAccount ? (
          <>
            They will not be able to open your book again. Everything they did stays
            on the record under their name, so your sales and dispatches do not
            change.
          </>
        ) : (
          <>
            They never used their code, so there is nothing of their in your book. The
            code stops working.
          </>
        )}
      </p>

      {person.hasAccount && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          If they might come back, turn them off instead. That keeps them on this
          list and you can turn them on again in one tap.
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <button
          onClick={onClose}
          className="cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-espresso/60 transition-colors hover:bg-slate-100"
        >
          Keep them
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="cursor-pointer rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
        >
          {busy ? "Removing..." : "Remove them"}
        </button>
      </div>
    </div>
  </div>
);

const InviteModal = ({ catalogue, onClose, onInvited }) => {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Everything ticked, matching the server's default. An owner adding their
  // nephew wants them working, not locked out of every screen.
  const [permissions, setPermissions] = useState(() =>
    catalogue.map((p) => p.key),
  );
  const [working, setWorking] = useState(false);

  const toggle = (key) =>
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );

  const submit = async (e) => {
    e.preventDefault();
    setWorking(true);
    try {
      const { data } = await api.post("/api/staff", {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        permissions,
      });
      onInvited(data.staff);
      toast.success("Added. Send them the code so they can set their password.");
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not add this person");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="my-8 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-espresso">
              <UserPlus className="h-5 w-5 text-clay" />
              Add someone to your shop
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              They get their own login. Everything they do is recorded under their
              name, and you can turn them off any time.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-slate-400 transition-colors hover:text-espresso"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="staff-name"
              className="mb-1 block text-xs font-semibold text-espresso/70"
            >
              Their name
            </label>
            <input
              id="staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kishan Shah"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="staff-phone"
                className="mb-1 block text-xs font-semibold text-espresso/70"
              >
                Phone
              </label>
              <input
                id="staff-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98200 11223"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
              />
            </div>
            <div>
              <label
                htmlFor="staff-email"
                className="mb-1 block text-xs font-semibold text-espresso/70"
              >
                Email
              </label>
              <input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kishan@example.com"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            One of the two is enough. It is how you send them their code.
          </p>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              What they can do
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {catalogue.map((permission) => {
                const on = permissions.includes(permission.key);
                return (
                  <button
                    key={permission.key}
                    type="button"
                    onClick={() => toggle(permission.key)}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
                      on
                        ? "border-sage/40 bg-sage/5"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on
                          ? "border-sage bg-sage text-white"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-espresso">
                        {permission.label}
                      </span>
                      <span className="block text-[11px] leading-snug text-slate-500">
                        {permission.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-espresso/60 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={working || !name.trim()}
              className="cursor-pointer rounded-xl bg-clay px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-espresso disabled:opacity-50"
            >
              {working ? "Adding..." : "Add them"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Staff;
