import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

const AUTOPLAY_MS = 6000;

// Each slide points somewhere real - a hero button that does nothing is worse
// than no button. Copy describes features the product actually has.
const SLIDES = [
  {
    badge: "B2B Marketplace",
    title: "Source Wholesale Products Instantly",
    description:
      "Buy in bulk from verified wholesalers, with clear minimum order quantities and live stock on every listing.",
    buttonText: "Browse catalogue",
    to: "/search?q=",
    image:
      "https://images.pexels.com/photos/2199293/pexels-photo-2199293.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
  },
  {
    badge: "Live Delivery Tracking",
    title: "Follow Your Order To The Door",
    description:
      "See the consignment leave the warehouse and watch it move on the map until it reaches you.",
    buttonText: "View your orders",
    to: "/orders",
    image:
      "https://images.pexels.com/photos/1214259/pexels-photo-1214259.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
  },
  {
    badge: "Direct Payments",
    title: "Zero Friction UPI Checkout",
    description:
      "Settle invoices instantly with UPI payments straight to your wholesaler's account.",
    buttonText: "See how it works",
    to: "/upi-guide",
    image:
      "https://images.pexels.com/photos/6169668/pexels-photo-6169668.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
  },
];

const HeroCarousel = () => {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef(null);
  const touchStartX = useRef(null);

  const go = useCallback((index) => {
    setCurrent((index + SLIDES.length) % SLIDES.length);
  }, []);
  const next = useCallback(() => go(current + 1), [current, go]);
  const prev = useCallback(() => go(current - 1), [current, go]);

  // Autoplay, suspended while the user is interacting or the tab is hidden,
  // and disabled entirely when reduced motion is preferred.
  useEffect(() => {
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    if (paused || reduced) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        setCurrent((c) => (c + 1) % SLIDES.length);
      }
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused]);

  // Arrow keys work once the carousel has focus.
  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    }
  };

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 50) (delta < 0 ? next : prev)();
    touchStartX.current = null;
  };

  return (
    <div
      ref={containerRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="Marketplace highlights"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="group relative mb-2 h-112.5 w-full overflow-hidden rounded-2xl bg-espresso shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-clay sm:h-125"
    >
      {SLIDES.map((slide, index) => {
        const isActive = index === current;
        return (
          <div
            key={slide.title}
            aria-hidden={!isActive}
            className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
              isActive ? "z-10 opacity-100" : "z-0 opacity-0"
            }`}
          >
            {/* The first slide is the page's largest paint: load it eagerly at
                high priority so the hero does not show as a bare dark panel
                while the image is still being fetched. */}
            <img
              src={slide.image}
              alt=""
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "low"}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-linear-to-t from-espresso via-espresso/80 to-espresso/20" />

            <div className="relative z-20 flex h-full max-w-2xl flex-col justify-center px-6 sm:px-12">
              <span
                className={`mb-3 inline-block w-fit rounded-full border border-clay/30 bg-espresso/30 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-clay backdrop-blur-sm transition-all delay-100 duration-700 ease-out sm:text-sm ${
                  isActive ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                }`}
              >
                {slide.badge}
              </span>

              <h2
                className={`mb-4 text-3xl font-black leading-tight tracking-tight text-cream transition-all delay-200 duration-700 ease-out sm:text-5xl ${
                  isActive ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                }`}
              >
                {slide.title}
              </h2>

              <p
                className={`mb-8 max-w-lg text-sm leading-relaxed text-cream/80 transition-all delay-300 duration-700 ease-out sm:text-lg ${
                  isActive ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                }`}
              >
                {slide.description}
              </p>

              <div
                className={`transition-all delay-400 duration-700 ease-out ${
                  isActive ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                }`}
              >
                <Link
                  to={slide.to}
                  tabIndex={isActive ? 0 : -1}
                  className="group/btn flex w-fit items-center gap-2 rounded-lg bg-clay px-6 py-3 text-sm font-semibold text-cream transition-colors duration-300 hover:bg-cream hover:text-espresso"
                >
                  {slide.buttonText}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                </Link>
              </div>
            </div>
          </div>
        );
      })}

      {/* Arrows: always reachable by keyboard, revealed on hover on desktop */}
      <button
        onClick={prev}
        aria-label="Previous slide"
        className="absolute left-3 top-1/2 z-30 -translate-y-1/2 rounded-full bg-espresso/40 p-2 text-cream opacity-0 backdrop-blur-sm transition-all hover:bg-espresso/70 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={next}
        aria-label="Next slide"
        className="absolute right-3 top-1/2 z-30 -translate-y-1/2 rounded-full bg-espresso/40 p-2 text-cream opacity-0 backdrop-blur-sm transition-all hover:bg-espresso/70 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="absolute bottom-6 left-0 right-0 z-30 flex justify-center gap-2">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.title}
            onClick={() => go(index)}
            aria-label={`Go to slide ${index + 1}: ${slide.title}`}
            aria-current={index === current}
            className={`h-1.5 cursor-pointer rounded-full transition-all duration-300 ${
              index === current
                ? "w-10 bg-clay"
                : "w-3 bg-cream/30 hover:bg-cream/60"
            }`}
          />
        ))}
      </div>
    </div>
  );
};

export default HeroCarousel;
