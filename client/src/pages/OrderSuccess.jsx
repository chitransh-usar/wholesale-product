import { useNavigate } from "react-router-dom";
import { CheckCircle, ShoppingBag, Home, Package, ArrowRight } from "lucide-react";

const OrderSuccess = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
          {/* Success Icon */}
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-emerald-600" />
          </div>

          {/* Success Message */}
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Order Confirmed!
          </h1>
          <p className="text-slate-600 mb-8">
            Thank you for your order. Your payment has been received and your order is being processed.
          </p>

          {/* Order Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-slate-50 rounded-lg p-4">
              <Package className="w-6 h-6 text-clay mx-auto mb-2" />
              <p className="text-xs text-slate-500 uppercase tracking-wide">Order Status</p>
              <p className="text-sm font-bold text-slate-900">Confirmed</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <ShoppingBag className="w-6 h-6 text-clay mx-auto mb-2" />
              <p className="text-xs text-slate-500 uppercase tracking-wide">Payment</p>
              <p className="text-sm font-bold text-slate-900">Paid</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <Package className="w-6 h-6 text-clay mx-auto mb-2" />
              <p className="text-xs text-slate-500 uppercase tracking-wide">Delivery</p>
              <p className="text-sm font-bold text-slate-900">Processing</p>
            </div>
          </div>

          {/* What's Next */}
          <div className="bg-slate-50 rounded-lg p-6 mb-8 text-left">
            <h3 className="text-lg font-bold text-slate-900 mb-4">What happens next?</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-clay text-white rounded-full flex items-center justify-center shrink-0 text-xs font-bold">1</div>
                <p className="text-sm text-slate-600">Supplier will receive your order details and payment confirmation</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-clay text-white rounded-full flex items-center justify-center shrink-0 text-xs font-bold">2</div>
                <p className="text-sm text-slate-600">Supplier will process and ship your order within the specified timeline</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-clay text-white rounded-full flex items-center justify-center shrink-0 text-xs font-bold">3</div>
                <p className="text-sm text-slate-600">You'll receive tracking information once shipped</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-clay text-white rounded-full flex items-center justify-center shrink-0 text-xs font-bold">4</div>
                <p className="text-sm text-slate-600">Contact supplier directly if you have any questions about your order</p>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate("/")}
              className="flex items-center justify-center gap-2 bg-clay text-white px-6 py-3 rounded-lg font-semibold hover:bg-clay/90 transition-colors cursor-pointer"
            >
              <Home className="w-4 h-4" />
              Return to Home
            </button>
            <button
              onClick={() => navigate("/orders")}
              className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 px-6 py-3 rounded-lg font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              View Orders
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Support Info */}
        <div className="mt-6 text-center">
          <p className="text-sm text-slate-500">
            Need help? Contact our support team or reach out to your supplier directly
          </p>
        </div>
      </div>
    </div>
  );
};

export default OrderSuccess;
