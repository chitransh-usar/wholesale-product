import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { Toaster } from "sonner";
import { CartProvider } from "./context/CartContext";
import { WishlistProvider } from "./context/WishlistContext";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { NotificationProvider } from "./context/NotificationContext";
import { UnreadProvider } from "./context/UnreadContext";
import { LocationProvider } from "./context/LocationContext";

import MainLayout from "./layouts/MainLayout";
import AuthLayout from "./layouts/AuthLayout";
import InfoLayout from "./layouts/InfoLayout";

import RequireRole from "./components/RequireRole";
import { FEATURES } from "./config/features";

import Home from "./pages/Home";
import ProductDetails from "./pages/ProductDetails";
import Wishlist from "./pages/Wishlist";
import SignUp from "./pages/SignUp";
import Login from "./pages/Login";
import SearchResults from "./pages/SearchResults";
import FooterInfoPage from "./pages/FooterInfoPage";
import Checkout from "./pages/Checkout";
import Payment from "./pages/Payment";
import OrderSuccess from "./pages/OrderSuccess";
import OrderDetails from "./pages/OrderDetails";
import MyOrders from "./pages/MyOrders";
import Messages from "./pages/Messages";
import RetailDashboard from "./pages/RetailDashboard";
import NotificationCenter from "./pages/NotificationCenter";
import Invoices from "./pages/dashboard/Invoices";
import CreateInvoice from "./pages/dashboard/CreateInvoice";
import InvoiceDetails from "./pages/dashboard/InvoiceDetails";
import InvoiceReports from "./pages/dashboard/InvoiceReports";
import InvoiceSettings from "./pages/dashboard/InvoiceSettings";
import WholesalerProfile from "./pages/WholesalerProfile";
import SharedListing from "./pages/SharedListing";
import DriverTracking from "./pages/DriverTracking";
import JoinShop from "./pages/JoinShop";
import NotFound from "./pages/NotFound";

// Seller workspace is lazy-loaded: retailers never download this bundle.
const SellerLayout = lazy(() => import("./layouts/SellerLayout"));
// The platform administration area. Its own layout and its own guard, because
// /seller/* is guarded by role seller|both and a platform admin need not be a
// wholesaler at all. See MasterLayout for the rest of the reasoning.
const MasterLayout = lazy(() => import("./layouts/MasterLayout"));
const MasterOverview = lazy(() => import("./pages/master/MasterOverview"));
const MasterStates = lazy(() => import("./pages/master/lists").then((m) => ({ default: m.MasterStates })));
const MasterUnits = lazy(() => import("./pages/master/lists").then((m) => ({ default: m.MasterUnits })));
const MasterTaxRates = lazy(() => import("./pages/master/lists").then((m) => ({ default: m.MasterTaxRates })));
const MasterTaxTerms = lazy(() => import("./pages/master/lists").then((m) => ({ default: m.MasterTaxTerms })));
const MasterHsn = lazy(() => import("./pages/master/lists").then((m) => ({ default: m.MasterHsn })));
const MasterSettings = lazy(() => import("./pages/master/MasterSettings"));
const MyProducts = lazy(() => import("./pages/dashboard/MyProducts"));
const AddProduct = lazy(() => import("./pages/dashboard/AddProduct"));
const EditProduct = lazy(() => import("./pages/dashboard/EditProduct"));
const Orders = lazy(() => import("./pages/dashboard/Orders"));
const Promotions = lazy(() => import("./pages/dashboard/Promotions"));
const Settings = lazy(() => import("./pages/dashboard/Settings"));
const PaymentSetup = lazy(() => import("./pages/dashboard/PaymentSetup"));
const Parties = lazy(() => import("./pages/dashboard/Parties"));
const PartyDetail = lazy(() => import("./pages/dashboard/PartyDetail"));
const PartyStatement = lazy(() => import("./pages/dashboard/PartyStatement"));
const Sales = lazy(() => import("./pages/dashboard/Sales"));
const RecordSale = lazy(() => import("./pages/dashboard/RecordSale"));
const SaleDetail = lazy(() => import("./pages/dashboard/SaleDetail"));
const Overview = lazy(() => import("./pages/dashboard/Overview"));
const MoneyBreakdown = lazy(() => import("./pages/dashboard/MoneyBreakdown"));
const SellerOrderDetail = lazy(() => import("./pages/dashboard/SellerOrderDetail"));
const Staff = lazy(() => import("./pages/dashboard/Staff"));
const YourData = lazy(() => import("./pages/dashboard/YourData"));
const Challans = lazy(() => import("./pages/dashboard/Challans"));
const Stock = lazy(() => import("./pages/dashboard/Stock"));
const DayBook = lazy(() => import("./pages/dashboard/DayBook"));
const RecordOrder = lazy(() => import("./pages/dashboard/RecordOrder"));
const RecordChallan = lazy(() => import("./pages/dashboard/RecordChallan"));
const ChallanDetail = lazy(() => import("./pages/dashboard/ChallanDetail"));
// The purchase side: goods coming in, who they came from, what is owed.
const Purchases = lazy(() => import("./pages/dashboard/Purchases"));
const RecordPurchase = lazy(() => import("./pages/dashboard/RecordPurchase"));
const PurchaseDetail = lazy(() => import("./pages/dashboard/PurchaseDetail"));
const Suppliers = lazy(() => import("./pages/dashboard/Suppliers"));
const SupplierDetail = lazy(() => import("./pages/dashboard/SupplierDetail"));

const SellerFallback = () => (
  <div className="flex min-h-dvh items-center justify-center bg-slate-100">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
  </div>
);

// Wraps the seller shell in its role guard and Suspense boundary.
const SellerArea = () => (
  <RequireRole roles={["seller", "both"]}>
    <Suspense fallback={<SellerFallback />}>
      <SellerLayout />
    </Suspense>
  </RequireRole>
);

// Marketplace-only screens. Kept in the tree and still compiled, but not
// routable while FEATURES.MARKETPLACE is off. Flipping the flag brings the
// whole browsing side back with no other change.
const MARKETPLACE_ROUTES = [
  { path: "product/:id", element: <ProductDetails /> },
  { path: "wholesaler/:id", element: <WholesalerProfile /> },
  { path: "wishlist", element: <Wishlist /> },
  { path: "search", element: <SearchResults /> },
  { path: "checkout", element: <Checkout /> },
  { path: "payment/:orderId", element: <Payment /> },
  { path: "order-success", element: <OrderSuccess /> },
  { path: "retail-dashboard", element: <RetailDashboard /> },
];

const router = createBrowserRouter([
  {
    path: "*",
    element: <NotFound />,
  },
  // Driver tracking link: standalone, unauthenticated, no marketplace shell.
  { path: "/track/:token", element: <DriverTracking /> },
  {
    path: "/",
    element: <MainLayout />,
    children: [
      { index: true, element: <Home /> },
      ...(FEATURES.MARKETPLACE ? MARKETPLACE_ROUTES : []),
      // A share link is reached by its URL, not by browsing, so it survives
      // the marketplace being switched off.
      { path: "listing/:inventoryId", element: <SharedListing /> },
      { path: "messages", element: <Messages /> },
      { path: "messages/:vendorId", element: <Messages /> },
      { path: "orders", element: <MyOrders /> },
      { path: "notifications", element: <NotificationCenter /> },
      { path: "orders/:orderId", element: <OrderDetails /> },
    ],
  },
  {
    path: "/seller",
    element: <SellerArea />,
    children: [
      // Always the 3.0 overview, marketplace or not. The old dashboard
      // reported a buyer rating and a listing count, which is not what a
      // wholesaler opens this for.
      { index: true, element: <Overview /> },
      { path: "customers", element: <Parties /> },
      { path: "customers/:id", element: <PartyDetail /> },
      { path: "customers/:id/statement", element: <PartyStatement /> },
      { path: "sales", element: <Sales /> },
      // Before "sales/:id" so the word is not read as a sale id.
      { path: "sales/new", element: <RecordSale /> },
      { path: "sales/:id", element: <SaleDetail /> },
      { path: "sales/:id/edit", element: <RecordSale /> },
      // Purchases. Same ordering rule as sales: "new" before ":id" so the
      // word is not read as a purchase id.
      { path: "purchases", element: <Purchases /> },
      { path: "purchases/new", element: <RecordPurchase /> },
      { path: "purchases/:id", element: <PurchaseDetail /> },
      { path: "purchases/:id/edit", element: <RecordPurchase /> },
      { path: "suppliers", element: <Suppliers /> },
      { path: "suppliers/:id", element: <SupplierDetail /> },
      // The rate list is now one list with the shop listings. The old address
      // keeps working so a bookmark or an old link does not land on "not
      // found".
      { path: "rates", element: <Navigate to="/seller/products" replace /> },
      { path: "products", element: <MyProducts /> },
      { path: "products/new", element: <AddProduct /> },
      { path: "products/edit/:id", element: <EditProduct /> },
      { path: "orders", element: <Orders /> },
      // One order in full, beside the list rather than instead of it.
      { path: "orders/:orderId", element: <SellerOrderDetail /> },
      // The rows behind each figure on the overview.
      { path: "money/:metric", element: <MoneyBreakdown /> },
      { path: "invoices", element: <Invoices /> },
      // Goods sent out before the money came in. Not a tax document.
      { path: "stock", element: <Stock /> },
      { path: "daybook", element: <DayBook /> },
      { path: "orders/new", element: <RecordOrder /> },
      { path: "challans", element: <Challans /> },
      // One challan in full. The list could only be downloaded from, so the
      // only way to read what was sent was to open a PDF.
      // new BEFORE :challanId, or "new" is read as an id.
      { path: "challans/new", element: <RecordChallan /> },
      { path: "challans/:id/edit", element: <RecordChallan /> },
      { path: "challans/:challanId", element: <ChallanDetail /> },
      { path: "invoices/create", element: <CreateInvoice /> },
      { path: "invoices/reports", element: <InvoiceReports /> },
      { path: "invoices/settings", element: <InvoiceSettings /> },
      { path: "invoices/:id", element: <InvoiceDetails /> },
      // Hidden, not deleted. The nav entry follows the same flag, so this is
      // only reachable by an old bookmark; sending those to the dashboard is
      // kinder than a "not found" for a page that still exists.
      ...(FEATURES.PROMOTIONS
        ? [{ path: "promotions", element: <Promotions /> }]
        : [{ path: "promotions", element: <Navigate to="/seller" replace /> }]),
      { path: "messages", element: <Messages /> },
      { path: "messages/:vendorId", element: <Messages /> },
      { path: "settings", element: <Settings /> },
      // Getting set up to take card payments. Until this is done a buyer's
      // card payment would land in the platform's account, so it is not
      // offered and they pay by UPI instead.
      { path: "settings/payments", element: <PaymentSetup /> },
      // Owner only, and the server refuses an employee outright.
      { path: "staff", element: <Staff /> },
      // Import and export. Both of these used to sit under the Save button at
      // the bottom of Settings, where nobody found them.
      { path: "data", element: <YourData /> },
    ],
  },
  // Old dashboard links and bookmarks keep working.
  {
    // Signed in and admin only. MasterLayout does the checking and draws the
    // refusal itself, so a wholesaler who follows a link here is told what the
    // area is rather than bounced somewhere confusing.
    path: "/administration",
    element: (
      <Suspense fallback={<SellerFallback />}>
        <MasterLayout />
      </Suspense>
    ),
    children: [
      { index: true, element: <MasterOverview /> },
      { path: "states", element: <MasterStates /> },
      { path: "units", element: <MasterUnits /> },
      { path: "tax-rates", element: <MasterTaxRates /> },
      { path: "tax-terms", element: <MasterTaxTerms /> },
      { path: "hsn", element: <MasterHsn /> },
      { path: "settings", element: <MasterSettings /> },
    ],
  },
  { path: "/dashboard", element: <Navigate to="/seller" replace /> },
  { path: "/dashboard/*", element: <Navigate to="/seller" replace /> },
  {
    element: <InfoLayout />,
    children: [
      {
        path: "browse-products",
        element: <FooterInfoPage page="browse-products" />,
      },
      {
        path: "verified-sellers",
        element: <FooterInfoPage page="verified-sellers" />,
      },
      { path: "help-center", element: <FooterInfoPage page="help-center" /> },
      { path: "upi-guide", element: <FooterInfoPage page="upi-guide" /> },
      { path: "contact-us", element: <FooterInfoPage page="contact-us" /> },
      {
        path: "terms-of-service",
        element: <FooterInfoPage page="terms-of-service" />,
      },
      {
        path: "privacy-policy",
        element: <FooterInfoPage page="privacy-policy" />,
      },
      {
        path: "seller-agreement",
        element: <FooterInfoPage page="seller-agreement" />,
      },
    ],
  },
  {
    element: <AuthLayout />,
    children: [
      { path: "login", element: <Login /> },
      { path: "signup", element: <SignUp /> },
      // An employee turning their owner's code into an account. Public, because
      // they have no login yet; the code in the form is the credential.
      { path: "join", element: <JoinShop /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <NotificationProvider>
          <UnreadProvider>
            <CartProvider>
              <WishlistProvider>
                <LocationProvider>
                  <Toaster richColors position="bottom-right" />
                  <RouterProvider router={router} />
                </LocationProvider>
              </WishlistProvider>
            </CartProvider>
          </UnreadProvider>
        </NotificationProvider>
      </SocketProvider>
    </AuthProvider>
  );
}
