import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { Box, ArrowLeft } from "lucide-react";
import Wordmark from "../components/Wordmark";
import { BRAND } from "../config/brand";

// The example page. Two customers owing and one settled, because a book in
// which everybody owes is not what a real one looks like, and the settled row
// is what makes the column mean something.
const LEDGER = [
  { name: "Kishan Cloth House", note: "Surat", amount: 12400 },
  { name: "Bansal Traders", note: "Ludhiana", amount: 4750 },
  { name: "New Krishna Textiles", note: "Ahmedabad", amount: 0 },
];

const AuthLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname === "/login";
  // The switcher belongs to the two screens it switches between. On the join
  // page it offered "Sign In" and "Create Account" to somebody who is doing
  // neither, and pushed their form down the page for no reason.
  const showSwitcher = isLogin || location.pathname === "/signup";

  const leftPanelRef = useRef(null);
  const formContentRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      tl.to(".brand-top", { y: 0, opacity: 1, duration: 0.6 }, 0.2)
        .to(".brand-center", { y: 0, opacity: 1, duration: 0.7 }, 0.4)
        .to(".brand-bottom", { y: 0, opacity: 1, duration: 0.6 }, 0.7);
    }, leftPanelRef);

    return () => ctx.revert();
  }, []);


  useEffect(() => {
    window.scrollTo(0, 0);

    if (formContentRef.current) {
      const elements = formContentRef.current.querySelectorAll(".form-stagger");
      if (elements.length > 0) {
        gsap.fromTo(
          elements,
          { y: 20, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.5,
            stagger: 0.06,
            ease: "power2.out",
            delay: 0.15,
          },
        );
      }
    }
  }, [location.pathname]);

  return (
    <main className="font-dmsans h-screen w-full flex overflow-hidden">
      {/* The panel is one idea, not a stack of them.
          It carried an eyebrow, a three line headline, a paragraph, three
          feature bullets and an early access card, which is five things
          competing where one would do, plus twelve randomly floating dots.
          A wholesaler opening this already knows what they came for.

          What is left is the thing itself: a page of the book, which says
          what the product is faster than a list of what it does. */}
      <div
        ref={leftPanelRef}
        className="relative hidden w-[48%] flex-col justify-between overflow-hidden bg-espresso px-10 py-10 grid-pattern xl:w-[46%] xl:p-12 lg:flex"
      >
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-clay/15 blur-3xl" />

        <div
          className="relative z-10 brand-top"
          style={{ opacity: 0, transform: "translateY(20px)" }}
        >
          <Link to="/" className="flex cursor-pointer items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clay">
              <Box className="h-4.5 w-4.5 text-cream" />
            </div>
            <Wordmark
              className="font-dmsans text-lg font-bold tracking-tight text-cream"
              accent="text-clay"
            />
          </Link>
        </div>

        <div
          className="brand-center relative z-10 max-w-md"
          style={{ opacity: 0, transform: "translateY(30px)" }}
        >
          {/* Two lines, and they have to stay two. The first version ran to
              three at 1440 and the break landed mid phrase. */}
          <h1 className="max-w-md text-[1.9rem] font-black leading-[1.12] tracking-tight text-cream xl:text-[2.25rem]">
            Know who owes you what,
            <br />
            <span className="text-clay">without a diary.</span>
          </h1>

          {/* A page of the book rather than a description of one. Real
              columns, real alignment, tabular figures: a wholesaler reads
              this at a glance because it is shaped like what they already
              keeps. Marked as an example, because it is one. */}
          <div className="mt-8 max-w-sm rounded-xl border border-cream/10 bg-cream/5 p-4 backdrop-blur-sm">
            <div className="mb-3 flex items-baseline justify-between border-b border-cream/10 pb-2">
              <span className="font-inter text-[10px] font-bold uppercase tracking-widest text-clay">
                Example page
              </span>
              <span className="font-inter text-[10px] font-semibold text-cream/40">
                Still to collect
              </span>
            </div>
            <ul className="font-inter space-y-2.5">
              {LEDGER.map((row) => (
                <li
                  key={row.name}
                  className="flex items-baseline justify-between gap-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-cream">
                      {row.name}
                    </span>
                    <span className="block text-[11px] text-cream/40">
                      {row.note}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[13px] font-bold tabular-nums ${
                      row.amount > 0 ? "text-cream" : "text-sage"
                    }`}
                  >
                    {row.amount > 0
                      ? `₹${row.amount.toLocaleString("en-IN")}`
                      : "Settled"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className="brand-bottom relative z-10"
          style={{ opacity: 0, transform: "translateY(25px)" }}
        >
          <p className="font-inter max-w-sm text-xs leading-relaxed text-cream/45">
            Built with a small group of wholesalers. If something does not fit
            how you work, tell us.
          </p>
        </div>
      </div>

      <div
        className="flex-1 bg-cream flex flex-col h-full relative overflow-y-auto overflow-x-hidden"
        style={{ scrollbarGutter: "stable" }}
      >
        {/* Header, form and footer share one column, so "Back to Home" sits
            directly above the fields and the small print directly below them.
            Spread across the full width they read as three unrelated things
            floating in a lot of cream. */}
        <div className="mx-auto flex w-full max-w-96 shrink-0 items-center justify-between px-6 pt-6 lg:px-0 lg:pt-7">
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-9 h-9 bg-clay rounded-lg flex items-center justify-center">
              <Box className="w-4 h-4 text-cream" />
            </div>
            <Wordmark className="text-espresso font-dmsans font-bold text-lg tracking-tight" />
          </div>

          <button
            onClick={() => navigate("/")}
            className="group flex items-center gap-2 text-slate-500 hover:text-espresso text-sm font-semibold transition-colors cursor-pointer ml-auto"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            <span className="hidden sm:inline">Back to Home</span>
            <span className="sm:hidden">Back</span>
          </button>
        </div>

        {/* Anchored to the top, never centred.
            Centring made the position of everything depend on how tall the
            form happened to be, so the Sign In and Create Account buttons
            moved 126px up the screen the moment you pressed one, which is
            under the cursor that just clicked. Measured at 1440x900.

            Reserving a height instead would not have fixed it: the form is
            436px on Sign In, 688px on Create Account, 790px once "I sell
            wholesale" reveals the state field and 798px with every validation
            message showing, so any fixed reserve is wrong for something. The
            top edge is the only thing that can hold still, so it does. */}
        <div className="flex flex-1 items-start justify-center px-6 pt-5 pb-10 lg:px-0 lg:pt-20 lg:pb-10">
          <div className="w-full max-w-96">
            {showSwitcher && (
            <div className="relative bg-white rounded-xl p-1 mb-6 shadow-sm border border-slate-200/60">
              <div
                className="tab-slider absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] bg-espresso rounded-lg z-0"
                style={{
                  transform: isLogin ? "translateX(0)" : "translateX(100%)",
                }}
              />
              <div className="font-inter relative z-10 flex">
                <button
                  onClick={() => navigate("/login")}
                  className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-colors duration-300 cursor-pointer ${
                    isLogin ? "text-cream" : "text-espresso"
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => navigate("/signup")}
                  className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-colors duration-300 cursor-pointer ${
                    !isLogin ? "text-cream" : "text-espresso"
                  }`}
                >
                  Create Account
                </button>
              </div>
            </div>
            )}

            <div ref={formContentRef}>
              <Outlet />
            </div>
          </div>
        </div>

        <div className="font-inter mx-auto w-full max-w-96 shrink-0 px-6 pb-5 text-center lg:px-0">
          <p className="text-[11px] text-slate-500 font-medium">
            2026 <i>{BRAND.name}</i>. All rights reserved.
          </p>
        </div>
      </div>
    </main>
  );
};

export default AuthLayout;
