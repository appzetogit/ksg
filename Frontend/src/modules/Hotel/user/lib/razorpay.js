// Razorpay Checkout for hotel bookings. Own loader (not Food/utils/razorpay.js): that one
// fakes a successful payment for `mock_order_` ids and carries Food branding, neither of
// which is acceptable for a booking that holds real inventory.

const SRC = "https://checkout.razorpay.com/v1/checkout.js";
let scriptPromise = null;

export const loadRazorpay = () => {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(window.Razorpay);
  scriptPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    const timer = setTimeout(() => fail(new Error("The payment window took too long to load. Check your connection and try again.")), 15000);
    function fail(err) {
      clearTimeout(timer);
      scriptPromise = null;
      script.remove();
      reject(err);
    }
    script.onload = () => {
      clearTimeout(timer);
      if (window.Razorpay) resolve(window.Razorpay);
      else fail(new Error("The payment window could not start. Please try again."));
    };
    script.onerror = () => fail(new Error("We couldn't load the payment window. Check your connection and try again."));
    document.body.appendChild(script);
  });
  return scriptPromise;
};

/**
 * Open Checkout for a contract `payment` object. Resolves with Razorpay's success
 * response (`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`); rejects
 * with `err.dismissed = true` when the customer closes the window (carrying the last
 * failure reason, if a payment attempt failed first).
 */
export const openRazorpay = async (payment) => {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    let lastFailure = "";
    let settled = false;
    const rzp = new Razorpay({
      key: payment.keyId,
      amount: payment.amount,
      currency: payment.currency || "INR",
      order_id: payment.razorpayOrderId,
      name: payment.name || "KSG Stays",
      description: payment.description || "Hotel booking",
      prefill: payment.prefill || {},
      theme: { color: "#0B2A6F" },
      handler: (response) => {
        settled = true;
        resolve(response);
      },
      modal: {
        ondismiss: () => {
          if (settled) return;
          settled = true;
          const err = new Error(lastFailure || "Payment was not completed.");
          err.dismissed = true;
          reject(err);
        },
      },
    });
    rzp.on("payment.failed", (resp) => {
      lastFailure = resp?.error?.description || "The payment failed. You can try again.";
    });
    rzp.open();
  });
};
