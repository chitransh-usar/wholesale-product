import { Link } from "react-router-dom";
import Wordmark from "./Wordmark";
import { BRAND } from "../config/brand";

const footerSections = [
  {
    title: "Platform",
    links: [
      { label: "Browse Products", to: "/browse-products" },
      { label: "Verified Sellers", to: "/verified-sellers" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help Center", to: "/help-center" },
      { label: "UPI Guide", to: "/upi-guide" },
      { label: "Contact Us", to: "/contact-us" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", to: "/terms-of-service" },
      { label: "Privacy Policy", to: "/privacy-policy" },
      { label: "Seller Agreement", to: "/seller-agreement" },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="mt-auto w-full border-t border-sage/30 bg-cream">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
        <div className="mb-8 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <div className="mb-4 text-xl font-black tracking-tighter text-espresso">
              <Wordmark />
            </div>
            <p className="text-xs leading-relaxed text-espresso/70">
              The premier B2B unified marketplace for seamless wholesale
              trading, with live delivery tracking and direct UPI payments.
            </p>
          </div>

          {footerSections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-4 text-sm font-bold text-espresso">
                {section.title}
              </h3>
              <ul className="flex flex-col gap-2 text-xs text-espresso/70">
                {section.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="transition-colors hover:text-clay"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-sage/20 pt-6 sm:flex-row">
          <p className="text-xs text-espresso/60">
            © 2026 {BRAND.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
