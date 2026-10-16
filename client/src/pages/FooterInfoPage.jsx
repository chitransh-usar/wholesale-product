import { Link } from "react-router-dom";
import {
  ShoppingBag,
  ShieldCheck,
  HelpCircle,
  Smartphone,
  MessageSquare,
  FileText,
  Lock,
  Handshake,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  ArrowLeft,
  Lightbulb,
  Home,
  Clock,
  Zap,
  Star,
  Compass,
} from "lucide-react";

const PAGE_CONFIG = {
  "browse-products": {
    icon: ShoppingBag,
    gradient: "from-violet-500 to-purple-600",
    accent: "violet",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    borderAccent: "border-violet-200",
    bgAccent: "bg-violet-50/50",
    gradientBg: "bg-gradient-to-br from-violet-50 to-purple-50",
    lightGradient: "bg-gradient-to-r from-violet-100/80 to-purple-100/80",
  },
  "verified-sellers": {
    icon: ShieldCheck,
    gradient: "from-emerald-500 to-green-600",
    accent: "emerald",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    borderAccent: "border-emerald-200",
    bgAccent: "bg-emerald-50/50",
    gradientBg: "bg-gradient-to-br from-emerald-50 to-green-50",
    lightGradient: "bg-gradient-to-r from-emerald-100/80 to-green-100/80",
  },
  "help-center": {
    icon: HelpCircle,
    gradient: "from-amber-500 to-orange-600",
    accent: "amber",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    borderAccent: "border-amber-200",
    bgAccent: "bg-amber-50/50",
    gradientBg: "bg-gradient-to-br from-amber-50 to-orange-50",
    lightGradient: "bg-gradient-to-r from-amber-100/80 to-orange-100/80",
  },
  "upi-guide": {
    icon: Smartphone,
    gradient: "from-indigo-500 to-blue-600",
    accent: "indigo",
    iconBg: "bg-indigo-50",
    iconColor: "text-indigo-600",
    borderAccent: "border-indigo-200",
    bgAccent: "bg-indigo-50/50",
    gradientBg: "bg-gradient-to-br from-indigo-50 to-blue-50",
    lightGradient: "bg-gradient-to-r from-indigo-100/80 to-blue-100/80",
  },
  "contact-us": {
    icon: MessageSquare,
    gradient: "from-rose-500 to-pink-600",
    accent: "rose",
    iconBg: "bg-rose-50",
    iconColor: "text-rose-600",
    borderAccent: "border-rose-200",
    bgAccent: "bg-rose-50/50",
    gradientBg: "bg-gradient-to-br from-rose-50 to-pink-50",
    lightGradient: "bg-gradient-to-r from-rose-100/80 to-pink-100/80",
  },
  "terms-of-service": {
    icon: FileText,
    gradient: "from-slate-500 to-slate-600",
    accent: "slate",
    iconBg: "bg-slate-50",
    iconColor: "text-slate-600",
    borderAccent: "border-slate-200",
    bgAccent: "bg-slate-50/50",
    gradientBg: "bg-gradient-to-br from-slate-50 to-slate-100",
    lightGradient: "bg-gradient-to-r from-slate-100/80 to-slate-200/80",
  },
  "privacy-policy": {
    icon: Lock,
    gradient: "from-teal-500 to-cyan-600",
    accent: "teal",
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
    borderAccent: "border-teal-200",
    bgAccent: "bg-teal-50/50",
    gradientBg: "bg-gradient-to-br from-teal-50 to-cyan-50",
    lightGradient: "bg-gradient-to-r from-teal-100/80 to-cyan-100/80",
  },
  "seller-agreement": {
    icon: Handshake,
    gradient: "from-orange-500 to-amber-600",
    accent: "orange",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-600",
    borderAccent: "border-orange-200",
    bgAccent: "bg-orange-50/50",
    gradientBg: "bg-gradient-to-br from-orange-50 to-amber-50",
    lightGradient: "bg-gradient-to-r from-orange-100/80 to-amber-100/80",
  },
};

const pageContent = {
  "browse-products": {
    tag: "Marketplace",
    title: "Browse wholesale products with confidence",
    description:
      "Explore verified inventory across packaging, electronics, apparel, and fast-moving essentials. Every listing includes supplier transparency, pricing history, and delivery expectations so buyers can compare options quickly and make informed bulk decisions.",
    highlights: [
      "Filter by category, region, and verified suppliers",
      "Compare bulk pricing and minimum order quantities",
      "Save products for later in your personalized wishlist",
    ],
    extra: [
      "Search across trusted categories with real-time inventory visibility.",
      "Create a shortlist for procurement teams before finalizing a purchase.",
    ],
  },
  "verified-sellers": {
    tag: "Trust & Quality",
    title: "Work with verified sellers only",
    description:
      "We highlight suppliers who have completed onboarding, identity checks, and quality reviews. This helps wholesale buyers reduce risk and transact with confidence at scale while keeping procurement standards consistent.",
    highlights: [
      "Verified seller badges and business credentials",
      "Transparent review history and response times",
      "Priority support for high-volume buyers",
    ],
    extra: [
      "Every seller profile includes business readiness and compliance signals.",
      "High-trust suppliers receive faster approvals for repeat orders.",
    ],
  },
  "help-center": {
    tag: "Support",
    title: "Get help with ordering, payments, and onboarding",
    description:
      "The help center covers the essentials for new and returning wholesale buyers, including account setup, order management, dispute resolution, and supplier communication.",
    highlights: [
      "Step-by-step guides for first-time buyers",
      "Answers to common questions about invoicing",
      "Fast access to account specialists",
    ],
    extra: [
      "Useful resources are grouped by buyer, seller, and finance workflows.",
      "Live assistance is available for urgent order or payment issues.",
    ],
  },
  "upi-guide": {
    tag: "Payments",
    title: "Make secure UPI payments for wholesale orders",
    description:
      "Use UPI to complete transactions quickly with seller-friendly confirmation flows. The guide explains accepted payment steps, settlement expectations, and safety checks for smoother checkout experiences.",
    highlights: [
      "Simple setup steps for trusted UPI payments",
      "Confirmation details for every transaction",
      "Support for payment disputes and failed transfers",
    ],
    extra: [
      "UPI payments help reduce delays for repeat purchases and urgent restocks.",
      "Each payment includes transparent confirmation details for account records.",
    ],
  },
  "contact-us": {
    tag: "Contact",
    title: "Talk to the marketplace team",
    description:
      "Whether you need help choosing a supplier, setting up your account, or resolving an order issue, our team is ready to help with practical support and fast follow-up.",
    highlights: [
      "Email: support@marketplace.in",
      "Phone: +91 99999 11111",
      "Business hours: Mon-Sat, 9:00 AM to 7:00 PM",
    ],
    extra: [
      "Prefer email? We typically respond within one business day.",
      "Large-order buyers can request a dedicated account manager.",
    ],
  },
  "terms-of-service": {
    tag: "Legal",
    title: "Terms of service",
    description:
      "These terms define how buyers, sellers, and marketplace administrators interact across product listings, payments, delivery coordination, and account usage in a transparent and compliant environment.",
    highlights: [
      "Use of platform services is subject to account compliance",
      "Buyers and sellers are responsible for accurate product details",
      "Marketplace policies may change with notice to users",
    ],
    extra: [
      "The terms are designed to keep commercial operations fair and predictable.",
      "Users are encouraged to review updates before renewing partnerships.",
    ],
  },
  "privacy-policy": {
    tag: "Legal",
    title: "Privacy policy",
    description:
      "We collect only the data needed to run your account, provide support, and improve your buying experience. Your information is handled with care and shared only where required.",
    highlights: [
      "Profile, contact, and transaction data are securely stored",
      "Communication preferences can be updated anytime",
      "Data requests and deletion support are available on request",
    ],
    extra: [
      "We use your data to personalize recommendations and improve platform reliability.",
      "You can request access or correction of stored information at any time.",
    ],
  },
  "seller-agreement": {
    tag: "Legal",
    title: "Seller agreement",
    description:
      "The seller agreement outlines onboarding responsibilities, catalog standards, payment handling, and conduct expectations for verified suppliers on the platform, helping both sides work with clarity.",
    highlights: [
      "Suppliers must keep product data accurate and current",
      "Fulfillment commitments and service levels are part of the agreement",
      "Platform policies apply to pricing, communication, and disputes",
    ],
    extra: [
      "The agreement supports reliable order fulfillment and better buyer trust.",
      "Suppliers can review their obligations anytime from the dashboard.",
    ],
  },
};

const FooterInfoPage = ({ page }) => {
  const content = pageContent[page];
  const config = PAGE_CONFIG[page];

  if (!content || !config) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-slate-50 to-slate-100"></div>
        <div className="absolute top-20 left-20 w-72 h-72 bg-slate-200/30 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-72 h-72 bg-slate-200/30 rounded-full blur-3xl"></div>

        <div className="max-w-md w-full text-center relative z-10">
          <div className="w-24 h-24 mx-auto mb-8 rounded-2xl bg-white shadow-lg flex items-center justify-center relative">
            <HelpCircle className="w-12 h-12 text-slate-400" />
            <div className="absolute -top-2 -right-2 w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center">
              <span className="text-sm">🤔</span>
            </div>
          </div>
          <h1 className="text-3xl font-black text-slate-900">Page not found</h1>
          <p className="mt-4 text-base text-slate-500 leading-relaxed">
            The requested page is unavailable. Return to the marketplace
            homepage.
          </p>
          <Link
            to="/"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-bold text-white transition-all hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98] group"
          >
            <Home className="w-4 h-4" />
            Go home
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    );
  }

  const Icon = config.icon;

  return (
    <div className="relative overflow-hidden">
      <div
        className={`absolute top-0 right-0 w-96 h-96 ${config.lightGradient} rounded-full blur-3xl opacity-50`}
      ></div>
      <div
        className={`absolute bottom-0 left-0 w-96 h-96 ${config.lightGradient} rounded-full blur-3xl opacity-30`}
      ></div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-6 relative z-10">
        <Link
          to="/"
          className="group inline-flex items-center gap-2 pl-1.5 pr-4 py-1.5 rounded-full border border-slate-200/80 bg-white/70 backdrop-blur-sm text-xs font-semibold text-slate-500 shadow-sm hover:text-slate-900 hover:border-slate-300 hover:shadow-md transition-all mb-8"
        >
          <span
            className={`flex items-center justify-center w-6 h-6 rounded-full ${config.iconBg} group-hover:scale-95 transition-transform`}
          >
            <ArrowLeft
              className={`w-3.5 h-3.5 ${config.iconColor} transition-transform group-hover:-translate-x-0.5`}
            />
          </span>
          Marketplace
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 flex flex-col gap-8">
            <div
              className={`relative rounded-2xl ${config.gradientBg} p-8 overflow-hidden`}
            >
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2"></div>
              <div className="absolute top-1/2 right-1/3 w-16 h-16 bg-white/10 rounded-full"></div>

              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-6">
                  <div
                    className={`w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center shrink-0`}
                  >
                    <Icon
                      className={`w-8 h-8 ${config.iconColor}`}
                      strokeWidth={1.5}
                    />
                  </div>
                  <span
                    className={`inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm text-[11px] font-bold uppercase tracking-wider font-dmsans ${config.iconColor} px-4 py-1.5 rounded-full shadow-sm`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {content.tag}
                  </span>
                </div>

                <h1 className="font-dmsans text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight tracking-tight mb-4">
                  {content.title}
                </h1>

                <p className="font-dmsans text-base text-slate-700 max-w-2xl leading-relaxed">
                  {content.description}
                </p>
              </div>
            </div>

            <div>
              <h2 className="font-dmsans text-sm font-bold uppercase tracking-wider text-slate-500 mb-5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Star className="w-4 h-4 text-slate-500" />
                </div>
                Key Features
              </h2>
              <div className="font-dmsans grid gap-4 sm:grid-cols-2">
                {content.highlights.map((item, idx) => (
                  <div
                    key={idx}
                    className={`group flex items-start gap-4 p-5 rounded-xl border ${config.borderAccent} bg-white shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden`}
                  >
                    <div
                      className={`absolute top-0 right-0 w-24 h-24 ${config.bgAccent} rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition-transform`}
                    ></div>
                    <div className="relative z-10 flex items-start gap-4 w-full">
                      <div
                        className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center shrink-0`}
                      >
                        <CheckCircle2
                          className={`w-5 h-5 ${config.iconColor}`}
                          strokeWidth={2}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-700 pt-1.5">
                        {item}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div
                className={`absolute inset-0 ${config.lightGradient} rounded-2xl blur-xl opacity-30`}
              ></div>
              <div
                className={`relative rounded-2xl border ${config.borderAccent} ${config.bgAccent} p-6 backdrop-blur-sm`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center`}
                  >
                    <Lightbulb className={`w-5 h-5 ${config.iconColor}`} />
                  </div>
                  <h2 className="font-dmsans text-sm font-bold uppercase tracking-wider text-slate-700">
                    Good to Know
                  </h2>
                </div>
                <ul className="font-dmsans grid gap-4 sm:grid-cols-2">
                  {content.extra.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-3 text-sm text-slate-600"
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${config.iconColor} bg-current mt-2 shrink-0`}
                      ></div>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-2">
              <Link
                to="/browse-products"
                className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98] relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-linear-to-r from-slate-800 to-slate-900 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="font-dmsans relative z-10 flex items-center gap-2">
                  <Compass className="w-4 h-4" />
                  Explore Products
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
              <Link
                to="/contact-us"
                className={`group inline-flex items-center gap-2 rounded-xl border ${config.borderAccent} bg-white px-6 py-3 text-sm font-bold ${config.iconColor} transition-all hover:shadow-md hover:-translate-y-0.5 relative overflow-hidden`}
              >
                <div
                  className={`absolute inset-0 ${config.bgAccent} opacity-0 group-hover:opacity-100 transition-opacity`}
                ></div>
                <div className="font-dmsans relative z-10 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Contact Support
                </div>
              </Link>
            </div>
          </div>

          <aside className="lg:col-span-4 lg:sticky lg:top-8 self-start flex flex-col gap-6">
            <div
              className={`relative overflow-hidden rounded-2xl border ${config.borderAccent} bg-white shadow-sm`}
            >
              <div
                className={`absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r ${config.gradient}`}
              ></div>
              <div className="p-6">
                <div className="flex items-center gap-4">
                  <div
                    className={` w-14 h-14 rounded-xl ${config.iconBg} flex items-center justify-center`}
                  >
                    <Icon className={`w-7 h-7 ${config.iconColor}`} />
                  </div>
                  <div>
                    <p className="font-dmsans text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      {content.tag}
                    </p>
                    <p className="font-dmsans text-sm text-slate-600">
                      Quick overview of this section.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <nav className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-dmsans text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" color="blue" />
                  Explore
                </h3>
              </div>
              <ul className="divide-y font-dmsans  divide-slate-50">
                {Object.entries(PAGE_CONFIG)
                  .filter(([key]) => key !== page)
                  .slice(0, 5)
                  .map(([key, cfg]) => {
                    const NavIcon = cfg.icon;
                    const navContent = pageContent[key];
                    return (
                      <li key={key}>
                        <Link
                          to={`/${key}`}
                          className="group flex items-center gap-3 px-5 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                        >
                          <div
                            className={`w-9 h-9 rounded-lg ${cfg.iconBg} flex items-center justify-center group-hover:shadow-sm transition-all`}
                          >
                            <NavIcon className={`w-4 h-4 ${cfg.iconColor}`} />
                          </div>
                          <span className="truncate">{navContent.tag}</span>
                          <ArrowRight className="w-4 h-4 text-slate-300 ml-auto shrink-0 group-hover:translate-x-1 transition-transform" />
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </nav>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-dmsans text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Need assistance?
                </h3>
              </div>
              <div className="p-5 font-dmsans  space-y-4">
                <a
                  href="mailto:support@marketplace.in"
                  className="group flex items-center gap-3 text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center text-lg group-hover:bg-slate-100 transition-colors">
                    ✉️
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Email</p>
                    <p className="text-sm font-medium">
                      support@marketplace.in
                    </p>
                  </div>
                </a>
                <a
                  href="tel:+919999911111"
                  className="group flex items-center gap-3 text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center text-lg group-hover:bg-slate-100 transition-colors">
                    📱
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Phone</p>
                    <p className="text-sm font-medium">+91 99999 11111</p>
                  </div>
                </a>
                {page === "contact-us" && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span>Mon-Sat 9 AM - 7 PM</span>
                    </div>
                  </div>
                )}
                <Link
                  to="/contact-us"
                  className="mt-3 block w-full text-center rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 hover:shadow-sm"
                >
                  View all contact options
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default FooterInfoPage;
