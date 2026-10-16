/**
 * Loading Razorpay's checkout script.
 *
 * Their window is an iframe served from checkout.razorpay.com, and that is the
 * whole reason to use theirs rather than draw our own: card numbers and UPI
 * PINs are entered inside a document we do not control and never touch our
 * code. A convincing local imitation of it, which is what this replaced, gets
 * the look right and the security exactly backwards.
 *
 * Loaded on demand rather than from index.html. Most people who open this app
 * never reach a payment screen, and a third party script in the document head
 * is a request on every page load and a name in the global scope for the whole
 * session.
 *
 * The promise is cached, so two buttons pressed quickly share one load. A
 * FAILED load is not cached: the usual reason is a flaky connection or a
 * blocker, and both can be gone by the time they press it again.
 */

const SRC = "https://checkout.razorpay.com/v1/checkout.js";

let pending = null;

export const loadRazorpay = () => {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (pending) return pending;

  pending = new Promise((resolve) => {
    // Someone else may have put the tag in already, on an earlier attempt that
    // has not finished. Reusing it avoids a second download.
    const existing = document.querySelector(`script[src="${SRC}"]`);
    const script = existing || document.createElement("script");

    const done = (ok) => {
      pending = null;
      resolve(ok && Boolean(window.Razorpay));
    };

    script.addEventListener("load", () => done(true), { once: true });
    script.addEventListener("error", () => done(false), { once: true });

    if (!existing) {
      script.src = SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return pending;
};

export default loadRazorpay;
