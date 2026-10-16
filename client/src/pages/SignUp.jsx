import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  User,
  Building2,
  Phone,
  ChevronDown,
  MapPin,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { INDIAN_STATES } from "../utils/gstin";

const GoogleIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

const Spinner = () => (
  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      className="opacity-25"
    />
    <path
      d="M4 12a8 8 0 018-8"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      className="opacity-75"
    />
  </svg>
);

const strengthConfig = [
  { label: "", color: "" },
  { label: "Weak", color: "#ef4444" },
  { label: "Fair", color: "#f97316" },
  { label: "Good", color: "#eab308" },
  { label: "Strong", color: "#22c55e" },
];

const SignUp = () => {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bizType, setBizType] = useState("");
  // Asked once, here, because every bill this account ever raises depends on
  // it: same state as the customer is CGST plus SGST, a different state is
  // IGST. It used to be asked nowhere at all, and a new wholesaler's profile
  // simply said Delhi.
  const [state, setState] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [shakeFields, setShakeFields] = useState({});

  // Who raises bills, and so who has to be asked where they are.
  const sells = bizType === "seller" || bizType === "both";

  const showError = useCallback((field, msg) => {
    setErrors((prev) => ({ ...prev, [field]: msg }));
    setShakeFields((prev) => ({ ...prev, [field]: true }));
    setTimeout(() => {
      setShakeFields((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }, 500);
  }, []);

  const clearError = useCallback((field) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({});
    setShakeFields({});
  }, []);

  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const passwordStrength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  const strengthInfo = strengthConfig[passwordStrength];

  const handlePhoneChange = (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 10) val = val.substring(0, 10);
    if (val.length > 5) {
      setPhone(val.substring(0, 5) + " " + val.substring(5));
    } else {
      setPhone(val);
    }
    clearError("phone");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearAllErrors();
    let valid = true;

    if (!firstName) {
      showError("firstName", "Required");
      valid = false;
    }
    if (!lastName) {
      showError("lastName", "Required");
      valid = false;
    }
    if (!bizType) {
      showError("bizType", "Please select a business type");
      valid = false;
    }
    // Only for someone who will raise bills. A retailer buying for their shop
    // does not need to be asked, and asking them would be a field for nothing.
    if (sells && !state) {
      showError("state", "Please choose your state");
      valid = false;
    }
    if (!email) {
      showError("email", "Work email is required");
      valid = false;
    } else if (!isValidEmail(email)) {
      showError("email", "Please enter a valid email");
      valid = false;
    }
    const rawPhone = phone.replace(/\s/g, "");
    if (!rawPhone) {
      showError("phone", "Phone number is required");
      valid = false;
    } else if (!/^\d{10}$/.test(rawPhone)) {
      showError("phone", "Enter a valid 10-digit number");
      valid = false;
    }
    if (!password) {
      showError("password", "Password is required");
      valid = false;
    } else if (password.length < 8) {
      showError("password", "Minimum 8 characters required");
      valid = false;
    }
    if (!terms) {
      toast.error("Please accept the Terms of Service");
      valid = false;
    }

    if (!valid) return;

    setLoading(true);

    try {
      await register({
        firstName,
        lastName,
        email,
        phone: rawPhone,
        password,
        role: bizType,
        state: sells ? state : undefined,
      });

      toast.success("Account created! Check your email for verification.");
      navigate("/login");
    } catch (error) {
      const errorMessage =
        error.response?.data?.message ||
        "Registration failed. Please try again.";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const errStyle = (field) =>
    errors[field] ? { borderBottomColor: "#ef4444" } : undefined;

  return (
    <>
      <div
        className="mb-7 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        <h2 className="font-dmsans text-xl font-black text-espresso tracking-tight">
          Create your account
        </h2>
        <p className="text-slate-500 text-sm mt-1 font-dmsans">
          Set up your business in a couple of minutes
        </p>
      </div>

      {/* <div
        className="flex gap-3 mb-5 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        <button
          type="button"
          onClick={() => toast.info("Google sign-up initiated")}
          className="social-btn flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 cursor-pointer"
        >
          <GoogleIcon />
          Google
        </button>
        <button
          type="button"
          onClick={() => toast.info("Phone sign-up initiated")}
          className="social-btn flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 cursor-pointer"
        >
          <Smartphone className="w-4 h-4" />
          Phone
        </button>
      </div>

      <div
        className="flex items-center gap-3 mb-5 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        <div className="divider-line flex-1 h-px bg-slate-200" />
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">
          or
        </span>
        <div className="divider-line flex-1 h-px bg-slate-200" />
      </div> */}

      <form onSubmit={handleSubmit} noValidate>
        <div
          className="grid grid-cols-2 gap-4 mb-5 form-stagger"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <div
            className={`input-wrapper relative ${
              shakeFields.firstName ? "error-shake" : ""
            }`}
          >
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              First Name
            </label>
            <div className="relative">
              <User className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
              <input
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  clearError("firstName");
                }}
                className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-7 pb-2.5 pt-1 text-sm text-espresso placeholder:text-slate-400 font-medium transition-colors duration-300"
                placeholder="Rajesh"
                autoComplete="given-name"
                style={errStyle("firstName")}
              />
              <div className="input-line" />
            </div>
            <p
              className={`text-xs mt-1.5 font-medium ${
                errors.firstName ? "text-red-500" : "hidden"
              }`}
            >
              {errors.firstName}
            </p>
          </div>
          <div
            className={`input-wrapper relative ${
              shakeFields.lastName ? "error-shake" : ""
            }`}
          >
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Last Name
            </label>
            <div className="relative">
              <User className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
              <input
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  clearError("lastName");
                }}
                className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-7 pb-2.5 pt-1 text-sm text-espresso placeholder:text-slate-400 font-medium transition-colors duration-300"
                placeholder="Kumar"
                autoComplete="family-name"
                style={errStyle("lastName")}
              />
              <div className="input-line" />
            </div>
            <p
              className={`text-xs mt-1.5 font-medium ${
                errors.lastName ? "text-red-500" : "hidden"
              }`}
            >
              {errors.lastName}
            </p>
          </div>
        </div>

        <div
          className={`input-wrapper relative mb-5 form-stagger ${
            shakeFields.bizType ? "error-shake" : ""
          }`}
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
            What do you do?
          </label>
          <div className="relative">
            <Building2 className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
            <select
              value={bizType}
              onChange={(e) => {
                setBizType(e.target.value);
                clearError("bizType");
              }}
              className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-7 pb-2.5 pt-1 text-sm text-espresso font-medium transition-colors duration-300 appearance-none cursor-pointer"
              style={errStyle("bizType")}
            >
              <option value="" className="text-slate-400">
                Choose one
              </option>
              <option value="seller">I sell wholesale</option>
              <option value="buyer">I buy for my shop</option>
              <option value="both">I do both</option>
            </select>
            <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <div className="input-line" />
          </div>
          <p
            className={`text-xs mt-1.5 font-medium ${
              errors.bizType ? "text-red-500" : "hidden"
            }`}
          >
            {errors.bizType}
          </p>
        </div>

        {/* Shown only once they say they sell. A list rather than a text box on
            purpose: this is the field that decides CGST and SGST against IGST,
            and "Gujrat" typed by hand is a state nothing recognises. */}
        {sells && (
          <div
            className={`input-wrapper relative mb-5 ${
              shakeFields.state ? "error-shake" : ""
            }`}
          >
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Which state do you sell from?
            </label>
            <div className="relative">
              <MapPin className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  clearError("state");
                }}
                className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-7 pb-2.5 pt-1 text-sm text-espresso font-medium transition-colors duration-300 appearance-none cursor-pointer"
                style={errStyle("state")}
              >
                <option value="" className="text-slate-400">
                  Choose your state
                </option>
                {INDIAN_STATES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <div className="input-line" />
            </div>
            <p
              className={`text-xs mt-1.5 font-medium ${
                errors.state ? "text-red-500" : "text-slate-400"
              }`}
            >
              {errors.state ||
                "Your bills charge CGST and SGST inside your state, IGST outside it."}
            </p>
          </div>
        )}

        <div
          className={`input-wrapper relative mb-5 form-stagger ${
            shakeFields.email ? "error-shake" : ""
          }`}
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
            Work Email
          </label>
          <div className="relative">
            <Mail className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearError("email");
              }}
              className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-7 pb-2.5 pt-1 text-sm text-espresso placeholder:text-slate-400 font-medium transition-colors duration-300"
              placeholder="you@company.com"
              autoComplete="email"
              style={errStyle("email")}
            />
            <div className="input-line" />
          </div>
          <p
            className={`text-xs mt-1.5 font-medium ${
              errors.email ? "text-red-500" : "hidden"
            }`}
          >
            {errors.email}
          </p>
        </div>

        <div
          className={`input-wrapper relative mb-5 form-stagger ${
            shakeFields.phone ? "error-shake" : ""
          }`}
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
            Phone Number
          </label>
          <div className="relative">
            <Phone className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
            <div className="absolute left-7 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium pr-2 border-r border-slate-200">
              +91
            </div>
            <input
              type="tel"
              value={phone}
              onChange={handlePhoneChange}
              className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-17 pb-1 pt-1 text-sm text-espresso placeholder:text-slate-400 font-medium transition-colors duration-300"
              placeholder="98765 43210"
              autoComplete="tel"
              maxLength={14}
              style={errStyle("phone")}
            />
            <div className="input-line" />
          </div>
          <p
            className={`text-xs mt-1.5 font-medium ${
              errors.phone ? "text-red-500" : "hidden"
            }`}
          >
            {errors.phone}
          </p>
        </div>

        <div
          className={`input-wrapper relative mb-2 form-stagger ${
            shakeFields.password ? "error-shake" : ""
          }`}
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
            Password
          </label>
          <div className="relative">
            <Lock className="input-icon absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError("password");
              }}
              className="w-full bg-transparent border-b-2 border-slate-200 focus:border-clay outline-none pl-7 pr-10 pb-2.5 pt-1 text-sm text-espresso placeholder:text-slate-400 font-medium transition-colors duration-300"
              placeholder="Min 8 characters"
              autoComplete="new-password"
              style={errStyle("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-1/2 -translate-y-1/2 p-1 cursor-pointer text-slate-400 hover:text-clay transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
            <div className="input-line" />
          </div>
          <p
            className={`text-xs mt-1.5 font-medium ${
              errors.password ? "text-red-500" : "hidden"
            }`}
          >
            {errors.password}
          </p>
        </div>

        <div
          className="flex gap-1.5 mb-5 form-stagger"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="strength-segment flex-1 h-1 rounded-full"
              style={{
                background:
                  i <= passwordStrength && password.length > 0
                    ? strengthInfo.color
                    : "#e2e8f0",
              }}
            />
          ))}
          <span
            className="text-[10px] font-semibold ml-2 min-w-12.5"
            style={{
              color:
                password.length > 0 && passwordStrength > 0
                  ? strengthInfo.color
                  : "#94a3b8",
            }}
          >
            {password.length > 0
              ? passwordStrength > 0
                ? strengthInfo.label
                : "Too short"
              : ""}
          </span>
        </div>

        <div
          className="flex items-start gap-2 mb-7 form-stagger"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="custom-check accent-clay mt-0.5"
            id="termsCheck"
          />
          <label
            htmlFor="termsCheck"
            className="text-xs text-slate-400 font-inter leading-relaxed cursor-pointer select-none"
          >
            I agree to the{" "}
            <button
              type="button"
              onClick={() => toast.info("Terms of Service page")}
              className="text-clay font-semibold hover:underline cursor-pointer"
            >
              Terms of Service
            </button>{" "}
            and{" "}
            <button
              type="button"
              onClick={() => toast.info("Privacy Policy page")}
              className="text-clay font-semibold hover:underline cursor-pointer"
            >
              Privacy Policy
            </button>
          </label>
        </div>

        <div
          className="form-stagger"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <button
            type="submit"
            disabled={loading}
            className="w-full group flex items-center justify-center gap-2 bg-clay text-cream py-3 rounded-xl font-semibold text-sm hover:bg-espresso transition-all duration-300 cursor-pointer hover:shadow-lg hover:shadow-espresso/20 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <span>{loading ? "Please wait..." : "Create Account"}</span>
            {loading ? (
              <Spinner />
            ) : (
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            )}
          </button>
        </div>
      </form>

      <p
        className="font-inter text-center text-xs text-slate-500 mt-6 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        Already have an account?{" "}
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="text-clay font-semibold hover:underline cursor-pointer"
        >
          Sign in
        </button>
      </p>
    </>
  );
};

export default SignUp;
