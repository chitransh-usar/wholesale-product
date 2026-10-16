import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";

/**
 * The employee's way in.
 *
 * Their owner adds them and reads them a code, or sends them a link with the code
 * in it. Here they choose a password, and from then on they sign in on the
 * ordinary login screen like everybody else. One way in rather than two.
 *
 * Public by necessity: they have no account yet, and the code is the credential.
 * The server treats a wrong code and an already used one the same way, so this
 * page cannot be used to find out which codes exist.
 */
const JoinShop = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // Read from the link on the first render rather than in an effect. A link
  // carries the code, so they do not have to read it off a phone screen and
  // type it; typing it is still allowed for a code given verbally.
  const [code, setCode] = useState(() => params.get("code") || "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Choose a password of at least 8 characters.");
      return;
    }

    setWorking(true);
    try {
      const { data } = await api.post("/api/staff/accept", {
        code: code.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password,
      });
      toast.success(data.message);
      navigate(`/login?email=${encodeURIComponent(data.email || email)}`);
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Could not set up your account. Check the code with your owner.",
      );
    } finally {
      setWorking(false);
    }
  };

  // The layout already supplies the column, the padding and the ground. This
  // page used to draw its own card inside it, which framed the form twice and
  // squeezed it into half the width it had. Login and SignUp render a bare
  // heading and form; this now matches them.
  return (
    <>
      <div className="mb-7">
        <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-clay/10 text-clay">
          <KeyRound className="h-4.5 w-4.5" />
        </span>
        <h1 className="font-dmsans text-xl font-black tracking-tight text-espresso">
          Join your shop
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Your owner has added you. Use the code they gave you and choose a
          password. After this you sign in normally.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label
            htmlFor="join-code"
            className="mb-1 block text-xs font-semibold text-espresso/70"
          >
            The code your owner gave you
          </label>
          <input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-xl border border-sage/30 bg-cream/40 px-3.5 py-2.5 font-mono text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
            required
          />
        </div>

        <div>
          <label
            htmlFor="join-email"
            className="mb-1 block text-xs font-semibold text-espresso/70"
          >
            Your email
          </label>
          <input
            id="join-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-sage/30 bg-cream/40 px-3.5 py-2.5 text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
          />
          <p className="mt-1 text-[11px] text-espresso/40">
            This is what you will sign in with. Leave it blank to use the one
            your owner already put in for you.
          </p>
        </div>

        <div>
          <label
            htmlFor="join-phone"
            className="mb-1 block text-xs font-semibold text-espresso/70"
          >
            Your phone number
          </label>
          <input
            id="join-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            className="w-full rounded-xl border border-sage/30 bg-cream/40 px-3.5 py-2.5 text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
          />
          <p className="mt-1 text-[11px] text-espresso/40">
            Leave it blank if your owner already put your number in.
          </p>
        </div>

        <div>
          <label
            htmlFor="join-password"
            className="mb-1 block text-xs font-semibold text-espresso/70"
          >
            Choose a password
          </label>
          <input
            id="join-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-xl border border-sage/30 bg-cream/40 px-3.5 py-2.5 text-sm text-espresso focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
            required
          />
        </div>

        <button
          type="submit"
          disabled={working || !code.trim() || password.length < 8}
          className="w-full cursor-pointer rounded-xl bg-clay px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-espresso disabled:opacity-50"
        >
          {working ? "Setting up..." : "Set up my account"}
        </button>
        </form>

      <p className="mt-5 text-center text-xs text-slate-500">
        Already set this up?{" "}
        <Link to="/login" className="font-bold text-clay hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
};

export default JoinShop;
