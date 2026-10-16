import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { toast } from "sonner";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import api from "../utils/axios";
import { useAuth } from "../context/AuthContext";

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

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [shakeFields, setShakeFields] = useState({});

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearAllErrors();
    let valid = true;

    if (!email) {
      showError("email", "Email is required");
      valid = false;
    } else if (!isValidEmail(email)) {
      showError("email", "Please enter a valid email");
      valid = false;
    }
    if (!password) {
      showError("password", "Password is required");
      valid = false;
    }

    if (!valid) return;

    setLoading(true);

    try {
      const response = await api.post("/api/auth/login", { email, password });
      await login(response.data.token);

      toast.success("Signed in successfully!");
      
      // Redirect based on user role
      const userRole = response.data.user?.role;
      if (userRole === "seller" || userRole === "both") {
        navigate("/seller");
      } else {
        navigate("/");
      }
    } catch (error) {
      // The password was right and the account still did not load, which is
      // the connection rather than the credentials. Saying "invalid
      // credentials" there sends somebody off to reset a password that was
      // never wrong.
      const errorMessage =
        error.code === "ACCOUNT_LOAD_FAILED"
          ? error.message
          : error.response?.data?.message ||
            "Invalid credentials. Please try again.";
      showError("email", errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className="mb-7 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        <h2 className="font-dmsans text-xl font-black text-espresso tracking-tight">
          Welcome back
        </h2>
        <p className="text-slate-500 text-sm mt-1 font-dmsans">
          Sign in to your business
        </p>
      </div>

      {/* <div
        className="flex gap-3 mb-5 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        <button
          type="button"
          onClick={() => toast.info("Google sign-in initiated")}
          className="social-btn flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 cursor-pointer"
        >
          <GoogleIcon />
          Google
        </button>
        <button
          type="button"
          onClick={() => toast.info("Phone sign-in initiated")}
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
          className={`input-wrapper relative mb-5 form-stagger ${
            shakeFields.email ? "error-shake" : ""
          }`}
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
            Email Address
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
              style={
                errors.email ? { borderBottomColor: "#ef4444" } : undefined
              }
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
          className={`input-wrapper relative mb-4 form-stagger ${
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
              placeholder="Enter your password"
              autoComplete="current-password"
              style={
                errors.password ? { borderBottomColor: "#ef4444" } : undefined
              }
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
          className="flex items-center justify-between mb-7 form-stagger"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="custom-check accent-clay"
            />
            <span className="text-xs font-inter text-slate-500 font-medium">
              Remember me
            </span>
          </label>
          <button
            type="button"
            onClick={() => toast.info("Password reset link sent to your email")}
            className="text-xs font-inter text-clay font-semibold hover:underline cursor-pointer"
          >
            Forgot password?
          </button>
        </div>

        <div
          className="form-stagger"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <button
            type="submit"
            disabled={loading}
            className="font-inter w-full group flex items-center justify-center gap-2 bg-espresso text-cream py-3 rounded-xl font-semibold text-sm hover:bg-clay transition-all duration-300 cursor-pointer hover:shadow-lg hover:shadow-clay/20 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <span>{loading ? "Please wait..." : "Sign In"}</span>
            {loading ? (
              <Spinner />
            ) : (
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            )}
          </button>
        </div>
      </form>

      <p
        className="text-center font-inter text-xs text-slate-500 mt-6 form-stagger"
        style={{ opacity: 0, transform: "translateY(20px)" }}
      >
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={() => navigate("/signup")}
          className="text-clay font-semibold hover:underline cursor-pointer"
        >
          Create one
        </button>
      </p>
    </>
  );
};

export default Login;
