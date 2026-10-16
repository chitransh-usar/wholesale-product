import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Phone, User, ShoppingBag, IndianRupee, CreditCard } from "lucide-react";
import { INDIAN_STATES } from "../utils/gstin";
import { useCart } from "../context/CartContext";
import { toast } from "sonner";
import api from "../utils/axios";
import LocationPicker from "../components/LocationPicker";

const Checkout = () => {
  const navigate = useNavigate();
  const { items, subtotal, clearCart } = useCart();
  const [loading, setLoading] = useState(false);
  const [paymentPlan, setPaymentPlan] = useState("full"); // 'full' or 'installment_50_50'
  
  const [addressForm, setAddressForm] = useState({
    name: "",
    phone: "",
    house: "",
    street: "",
    area: "",
    city: "",
    state: "",
    country: "India",
    pincode: ""
  });

  const [errors, setErrors] = useState({});
  const [pin, setPin] = useState(null);

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <ShoppingBag className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Your cart is empty</h2>
          <button
            onClick={() => navigate("/")}
            className="text-clay font-semibold hover:underline cursor-pointer"
          >
            Continue shopping
          </button>
        </div>
      </div>
    );
  }

  const validateForm = () => {
    const newErrors = {};
    
    if (!addressForm.name.trim()) newErrors.name = "Name is required";
    if (!addressForm.phone.trim()) newErrors.phone = "Phone is required";
    if (!addressForm.house.trim()) newErrors.house = "House/Building number is required";
    if (!addressForm.street.trim()) newErrors.street = "Street address is required";
    if (!addressForm.area.trim()) newErrors.area = "Area is required";
    if (!addressForm.city.trim()) newErrors.city = "City is required";
    if (!addressForm.state.trim()) newErrors.state = "State is required";
    if (!addressForm.country.trim()) newErrors.country = "Country is required";
    if (!addressForm.pincode.trim()) newErrors.pincode = "Pincode is required";
    
    if (addressForm.phone && !/^\d{10}$/.test(addressForm.phone.replace(/\s/g, ""))) {
      newErrors.phone = "Please enter a valid 10-digit phone number";
    }
    
    if (addressForm.pincode && !/^\d{6}$/.test(addressForm.pincode)) {
      newErrors.pincode = "Please enter a valid 6-digit pincode";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setAddressForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const handleProceedToPayment = async () => {
    if (!validateForm()) {
      toast.error("Please fill all required fields");
      return;
    }

    setLoading(true);
    try {
      const products = items.map((item) => ({
        productId: item.productId,
        inventoryId: item.inventoryId,
        quantity: item.quantity,
      }));

      const response = await api.post("/api/orders/create", {
        products,
        paymentPlan,
        deliveryAddress: pin ? { ...addressForm, ...pin } : addressForm,
      });

      if (response.data.success && response.data.orderId) {
        clearCart();
        navigate(`/payment/${response.data.orderId}`);
      } else {
        toast.error("Failed to create order tracking information.");
      }
    } catch (error) {
      console.error("Order creation error details:", error);
      const message = error.response?.data?.message || "Failed to create order";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const initialAmount = paymentPlan === "installment_50_50" 
    ? Number((subtotal * 0.5).toFixed(2)) 
    : subtotal;
  const remainingAmount = paymentPlan === "installment_50_50"
    ? Number((subtotal - initialAmount).toFixed(2))
    : subtotal;

  /**
   * What the 50/50 option WOULD cost, regardless of what is selected.
   *
   * The option card below is always on screen, and it used to print
   * initialAmount and remainingAmount, both of which fall back to the whole
   * subtotal when "full" is selected. So a buyer paying in full was shown a
   * card offering "Pay 50% Now 10,000, Remaining 50% 10,000" on a 10,000
   * order: the card misdescribed the very plan it was offering, and the two
   * halves added up to twice the order.
   */
  const halfNow = Number((subtotal * 0.5).toFixed(2));
  const halfLater = Number((subtotal - halfNow).toFixed(2));

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Checkout</h1>
            <p className="text-sm text-slate-500">Complete your order details</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Checkout Section */}
          <div className="lg:col-span-2 space-y-6">
            {/* Address Form */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-6">
                <MapPin className="w-5 h-5 text-clay" />
                <h2 className="text-lg font-bold text-slate-900">Delivery Address</h2>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Full Name <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        name="name"
                        value={addressForm.name}
                        onChange={handleInputChange}
                        placeholder="Enter your full name"
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                          errors.name ? "border-rose-300" : "border-slate-200"
                        }`}
                      />
                    </div>
                    {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Mobile Number <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="tel"
                        name="phone"
                        value={addressForm.phone}
                        onChange={handleInputChange}
                        placeholder="10-digit mobile number"
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                          errors.phone ? "border-rose-300" : "border-slate-200"
                        }`}
                      />
                    </div>
                    {errors.phone && <p className="text-xs text-rose-500 mt-1">{errors.phone}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    House/Building Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="house"
                    value={addressForm.house}
                    onChange={handleInputChange}
                    placeholder="e.g., 123, Apt 4B"
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                      errors.house ? "border-rose-300" : "border-slate-200"
                    }`}
                  />
                  {errors.house && <p className="text-xs text-rose-500 mt-1">{errors.house}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Street Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="street"
                    value={addressForm.street}
                    onChange={handleInputChange}
                    placeholder="e.g., MG Road, Near City Center"
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                      errors.street ? "border-rose-300" : "border-slate-200"
                    }`}
                  />
                  {errors.street && <p className="text-xs text-rose-500 mt-1">{errors.street}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Area / Landmark <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="area"
                      value={addressForm.area}
                      onChange={handleInputChange}
                      placeholder="e.g., Indiranagar"
                      className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                        errors.area ? "border-rose-300" : "border-slate-200"
                      }`}
                    />
                    {errors.area && <p className="text-xs text-rose-500 mt-1">{errors.area}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      City <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="city"
                      value={addressForm.city}
                      onChange={handleInputChange}
                      placeholder="e.g., Bengaluru"
                      className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                        errors.city ? "border-rose-300" : "border-slate-200"
                      }`}
                    />
                    {errors.city && <p className="text-xs text-rose-500 mt-1">{errors.city}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      State <span className="text-rose-500">*</span>
                    </label>
                    {/* A list, not a box. A typed "Karnatka" goes onto the
                        delivery address printed on their bill, and matches no
                        state anything else in the product compares against. */}
                    <select
                      name="state"
                      value={addressForm.state}
                      onChange={handleInputChange}
                      className={`w-full cursor-pointer px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                        errors.state ? "border-rose-300" : "border-slate-200"
                      }`}
                    >
                      <option value="">Choose a state</option>
                      {INDIAN_STATES.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    {errors.state && <p className="text-xs text-rose-500 mt-1">{errors.state}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Country <span className="text-rose-500">*</span>
                    </label>
                    {/* One option on purpose, rather than a list of two
                        hundred. Every bill this product raises is a GST
                        invoice with an HSN code and a place of supply, and an
                        export is a different document with a different tax
                        treatment that none of this handles. Offering Nepal in
                        the list would be offering something that does not
                        work. */}
                    <select
                      name="country"
                      value={addressForm.country}
                      onChange={handleInputChange}
                      className={`w-full cursor-pointer px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                        errors.country ? "border-rose-300" : "border-slate-200"
                      }`}
                    >
                      <option value="India">India</option>
                    </select>
                    {errors.country && <p className="text-xs text-rose-500 mt-1">{errors.country}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Pincode <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="pincode"
                      value={addressForm.pincode}
                      onChange={handleInputChange}
                      placeholder="6-digit pincode"
                      className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clay/20 ${
                        errors.pincode ? "border-rose-300" : "border-slate-200"
                      }`}
                    />
                    {errors.pincode && <p className="text-xs text-rose-500 mt-1">{errors.pincode}</p>}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5">
                  <h3 className="mb-1 text-sm font-bold text-slate-900">
                    Pin your exact location
                  </h3>
                  <p className="mb-3 text-xs text-slate-500">
                    Helps the wholesaler's driver find you. Optional, but far
                    more precise than matching a typed address.
                  </p>
                  <LocationPicker value={pin} onChange={setPin} />
                </div>
              </div>
            </div>

            {/* Payment Plan Options */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-2">
                <CreditCard className="w-5 h-5 text-clay" />
                <h2 className="text-lg font-bold text-slate-900">Payment Option</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Choose your preferred payment method. Selecting installments does NOT alter the total order amount.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Pay Full Amount */}
                <div
                  onClick={() => setPaymentPlan("full")}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    paymentPlan === "full"
                      ? "border-clay bg-clay/5 shadow-sm"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-bold text-sm text-slate-900 block">Pay Full Amount</span>
                      <span className="text-xs text-slate-500">Pay 100% now</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentPlan === "full" ? "border-clay bg-clay" : "border-slate-300"}`}>
                      {paymentPlan === "full" && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-600 font-medium">Pay Now</span>
                    <span className="text-base font-bold text-slate-900">₹{subtotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>

                {/* Pay 2 Installments */}
                <div
                  onClick={() => setPaymentPlan("installment_50_50")}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    paymentPlan === "installment_50_50"
                      ? "border-clay bg-clay/5 shadow-sm"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-slate-900">Pay in 2 Installments</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">50 / 50</span>
                      </div>
                      <span className="text-xs text-slate-500">Pay 50% now, 50% later</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentPlan === "installment_50_50" ? "border-clay bg-clay" : "border-slate-300"}`}>
                      {paymentPlan === "installment_50_50" && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-medium">Pay 50% Now</span>
                      <span className="font-bold text-clay">₹{halfNow.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Remaining 50%</span>
                      <span className="font-semibold text-slate-700">₹{halfLater.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sticky top-24">
              <div className="flex items-center gap-3 mb-6">
                <ShoppingBag className="w-5 h-5 text-clay" />
                <h2 className="text-lg font-bold text-slate-900">Order Summary</h2>
              </div>

              <div className="space-y-4 mb-6">
                {items.map((item) => {
                  const unitPrice = item.bulkQuantity && item.quantity >= item.bulkQuantity
                    ? item.bulkPrice
                    : item.price;
                  return (
                    <div key={item.id} className="flex gap-3 pb-4 border-b border-slate-100">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-16 h-16 rounded-lg object-cover border border-slate-200"
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 truncate">
                          {item.name}
                        </h3>
                        <p className="text-xs text-slate-500">{item.vendorName}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-slate-600">Qty: {item.quantity}</span>
                          <span className="text-sm font-bold text-clay">
                            ₹{(unitPrice * item.quantity).toLocaleString("en-IN")}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-600">Total Order Amount</span>
                  <span className="font-bold text-slate-900">₹{subtotal.toLocaleString("en-IN")}</span>
                </div>

                {paymentPlan === "installment_50_50" ? (
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-bold text-clay">Pay Now (50%)</span>
                      <div className="flex items-center gap-0.5">
                        <IndianRupee className="w-4 h-4 text-clay" />
                        <span className="text-lg font-black text-clay">
                          {initialAmount.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-600 border-t border-slate-200 pt-1.5">
                      <span>Remaining Amount</span>
                      <span className="font-semibold">₹{remainingAmount.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-sm pb-1">
                    <span className="font-bold text-clay">Pay Now (100%)</span>
                    <div className="flex items-center gap-1">
                      <IndianRupee className="w-4 h-4 text-clay" />
                      <span className="text-xl font-black text-clay">
                        {subtotal.toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleProceedToPayment}
                  disabled={loading}
                  className="w-full bg-clay text-white text-sm font-bold py-3 rounded-lg hover:bg-clay/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? "Creating Order..." : "Proceed to Payment"}
                </button>

                <p className="text-xs text-slate-500 text-center">
                  By proceeding, you agree to our Terms of Service
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;