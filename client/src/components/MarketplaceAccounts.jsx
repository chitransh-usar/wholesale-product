import { useEffect, useState } from "react";
import { Pause, Pencil, Play, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";
import ModalShell from "./ModalShell";
import { resetMasters } from "../hooks/useMasters";

/**
 * A wholesaler's second (and third) Amazon or Flipkart account.
 *
 * Each account gets its own run of bill numbers and nothing else, because a
 * marketplace sends one settlement report per account and each has to be
 * matched against its own run. Sale and order numbers stay on their one run.
 *
 * Lives on the bill numbering screen because that is all it changes. The
 * number after the prefix follows the format set above it on the same page,
 * the same as the built in Amazon and Flipkart books do.
 *
 * `version` is bumped by the page after it saves the number format, so the
 * samples shown here are redrawn in the new shape.
 */
const MarketplaceAccounts = ({ version = 0 }) => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(null);

  // Bumped after a change here, to fetch the list again.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/marketplace-accounts")
      .then((res) => {
        if (!alive) return;
        setData(res.data);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [version, tick]);

  // The sale, order and bill forms read the accounts through the masters,
  // which are fetched once per page load. Dropped after any change here so
  // the next form opened offers what is on this screen.
  const changed = () => {
    resetMasters();
    setTick((t) => t + 1);
  };

  const setActive = async (account, isActive) => {
    try {
      await api.put(`/api/marketplace-accounts/${account.id}`, { isActive });
      toast.success(isActive ? `${account.linkage_name} is back on` : `${account.linkage_name} is paused`);
      changed();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not change that account.");
    }
  };

  const remove = async (account) => {
    if (!window.confirm(`Remove ${account.linkage_name}? This only works while nothing has been recorded in it.`)) return;
    try {
      await api.delete(`/api/marketplace-accounts/${account.id}`);
      toast.success(`${account.linkage_name} removed`);
      changed();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not remove that account.");
    }
  };

  return (
    <section className="max-w-3xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-espresso">Selling on Amazon or Flipkart</h3>
          <p className="mt-1 text-xs text-slate-500">
            Bills for Amazon and Flipkart already have their own numbers. If you
            sell from more than one account on the same site, add the others
            here, so each account's bills can be matched against that account's
            report. Nothing is taken from Amazon or Flipkart.
          </p>
        </div>
        {data?.setUp && (
          <button
            type="button"
            onClick={() => setEditing({})}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-lg bg-espresso px-4 py-2 text-xs font-bold text-cream transition-colors hover:bg-clay"
          >
            <Plus className="h-3.5 w-3.5" />
            Add an account
          </button>
        )}
      </div>

      {failed && (
        <p className="text-sm text-slate-500">Could not load your accounts. Try again in a moment.</p>
      )}

      {data && (
        <ul className="divide-y divide-slate-100">
          {data.builtIn.map((b) => (
            <Row
              key={b.prefix}
              name={b.name}
              detail="Already set up for everyone"
              sample={b.sample}
            />
          ))}
          {data.accounts.map((a) => (
            <Row
              key={a.id}
              name={a.linkage_name}
              detail={`${a.marketplace_name}${a.is_active ? "" : ", paused"}`}
              sample={a.sample}
              muted={!a.is_active}
            >
              <IconButton label="Change" onClick={() => setEditing(a)}>
                <Pencil className="h-4 w-4" />
              </IconButton>
              {a.is_active ? (
                <IconButton label="Pause" onClick={() => setActive(a, false)}>
                  <Pause className="h-4 w-4" />
                </IconButton>
              ) : (
                <IconButton label="Switch on" onClick={() => setActive(a, true)}>
                  <Play className="h-4 w-4" />
                </IconButton>
              )}
              <IconButton label="Remove" onClick={() => remove(a)} danger>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </Row>
          ))}
        </ul>
      )}

      {data && !data.setUp && (
        <p className="rounded-lg bg-cream px-3 py-2 text-xs text-espresso/70">
          Adding more accounts is not switched on yet. The Amazon and Flipkart
          bills above work as they always have.
        </p>
      )}

      {data?.accounts?.some((a) => !a.is_active) && (
        <p className="text-xs text-slate-500">
          A paused account takes no new sales. Sales already in it can still be
          billed, and keep its numbers.
        </p>
      )}

      {editing && (
        <AccountForm
          account={editing.id ? editing : null}
          marketplaces={data?.marketplaces || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
    </section>
  );
};

const Row = ({ name, detail, sample, muted = false, children }) => (
  <li className={`flex flex-wrap items-center justify-between gap-3 py-3 ${muted ? "opacity-60" : ""}`}>
    <div className="flex min-w-0 items-center gap-3">
      <ShoppingBag className="h-4 w-4 shrink-0 text-sage" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-espresso">{name}</p>
        <p className="text-xs text-slate-500">{detail}</p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bills read</p>
        <p className="font-mono text-sm font-bold text-espresso">{sample}</p>
      </div>
      {children && <div className="flex items-center gap-1">{children}</div>}
    </div>
  </li>
);

const IconButton = ({ label, onClick, danger = false, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`cursor-pointer rounded-lg border border-slate-200 p-1.5 transition-colors ${
      danger ? "text-clay hover:bg-clay/10" : "text-slate-600 hover:bg-slate-50 hover:text-espresso"
    }`}
  >
    {children}
  </button>
);

/**
 * Add or change one account. Three things only: which site, a name the
 * wholesaler will recognise on the sale form, and the prefix its bills carry.
 * Every rule about the prefix is the server's, and its reason is shown as it
 * comes, so this screen cannot promise a prefix the server then refuses.
 */
const AccountForm = ({ account, marketplaces, onClose, onSaved }) => {
  const [marketplace, setMarketplace] = useState(account?.marketplace || marketplaces[0]?.id || "amazon");
  const [name, setName] = useState(account?.linkage_name || "");
  const [prefix, setPrefix] = useState(account?.invoice_prefix || "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setProblem("");
    try {
      const body = { name, invoicePrefix: prefix };
      if (account) {
        await api.put(`/api/marketplace-accounts/${account.id}`, body);
        toast.success("Account saved");
      } else {
        await api.post("/api/marketplace-accounts", { ...body, marketplace });
        toast.success("Account added");
      }
      onSaved();
    } catch (err) {
      setProblem(err.response?.data?.message || "Could not save the account.");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay";

  return (
    <ModalShell
      onClose={onClose}
      closeOnEscape={!saving}
      title={account ? `Change ${account.linkage_name}` : "Add an Amazon or Flipkart account"}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="cursor-pointer rounded-lg bg-espresso px-5 py-2 text-sm font-bold text-cream transition-colors hover:bg-clay disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      }
    >
      <form onSubmit={save} className="space-y-4 p-6">
        {!account && (
          <div>
            <label htmlFor="mkt-site" className="mb-1.5 block text-sm font-bold text-espresso">
              Which site
            </label>
            <select
              id="mkt-site"
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
              className={field}
            >
              {marketplaces.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="mkt-name" className="mb-1.5 block text-sm font-bold text-espresso">
            Name
          </label>
          <input
            id="mkt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Amazon, second store"
            className={field}
          />
          <p className="mt-1 text-xs text-slate-500">What you will pick on the sale form.</p>
        </div>
        <div>
          <label htmlFor="mkt-prefix" className="mb-1.5 block text-sm font-bold text-espresso">
            Start of the bill number
          </label>
          <input
            id="mkt-prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            placeholder="AZ2/"
            maxLength={8}
            className={`${field} font-mono`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Short, and different from every other book, so a bill tells you at a
            glance which account it came from. It cannot change once a bill has
            gone out with it.
          </p>
        </div>
        {problem && (
          <p className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{problem}</p>
        )}
      </form>
    </ModalShell>
  );
};

export default MarketplaceAccounts;
