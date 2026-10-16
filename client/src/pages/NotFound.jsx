import { useNavigate, Link } from "react-router-dom";
import { BRAND } from "../config/brand";
import { ArrowLeft, Home, Search, PackageX } from "lucide-react";

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-dmsans">
      {/* Minimal Header */}
      <header className="h-16 flex items-center px-6 lg:px-8 border-b border-slate-200 bg-white shrink-0">
        <Link
          to="/"
          className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 select-none"
        >
          market<span className="text-clay">place.</span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full flex flex-col items-center">
          <div className="w-24 h-24 bg-rose-50 rounded-full flex items-center justify-center mb-8 shadow-inner border border-rose-100">
            <PackageX className="w-12 h-12 text-rose-500" strokeWidth={1.5} />
          </div>

          <h1 className="text-7xl font-black text-espresso tracking-tight mb-4">
            404
          </h1>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            Page not found
          </h2>
          <p className="text-slate-500 mb-10 leading-relaxed">
            Oops! It looks like the page or product you're looking for doesn't
            exist, has been removed, or is temporarily unavailable.
          </p>

          <div className="flex flex-col w-full gap-3">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center justify-center gap-2 w-full py-3.5 bg-clay text-white text-sm font-bold rounded-xl hover:bg-clay/90 transition-all shadow-sm shadow-clay/20 cursor-pointer active:scale-[0.98]"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>

            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/"
                className="flex items-center justify-center gap-2 w-full py-3.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm cursor-pointer"
              >
                <Home className="w-4 h-4" />
                Home
              </Link>

              <Link
                to="/search"
                className="flex items-center justify-center gap-2 w-full py-3.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm cursor-pointer"
              >
                <Search className="w-4 h-4" />
                Search
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="py-6 text-center text-xs text-slate-400 font-medium">
        &copy; {new Date().getFullYear()} {BRAND.name}. All rights reserved.
      </footer>
    </div>
  );
};

export default NotFound;
