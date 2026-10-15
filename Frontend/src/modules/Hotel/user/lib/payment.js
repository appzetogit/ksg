import { useCallback, useEffect, useRef, useState } from "react";
import { getBooking, retryPayment, verifyPayment } from "./bookingApi";
import { openRazorpay } from "./razorpay";

/**
 * Pay for a booking: open Razorpay with `payment` (or fetch one via retry-payment),
 * then verify. `pay()` resolves to the updated booking, or null when the customer
 * dismissed the window / something failed (the reason is in `error`).
 */
export function usePayBooking() {
  const [state, setState] = useState({ busy: false, step: "", error: "", dismissed: false, verifyFailed: false });
  const busyRef = useRef(false);

  const pay = useCallback(async (bookingId, payment = null) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setState({ busy: true, step: "opening", error: "", dismissed: false, verifyFailed: false });
    let stage = "order";
    try {
      let order = payment;
      if (!order) {
        const data = await retryPayment(bookingId);
        order = data?.razorpayOrderId ? data : data?.payment || null;
      }
      if (!order) {
        // Nothing payable online any more (e.g. paid from another tab): just refresh.
        const booking = await getBooking(bookingId);
        setState({ busy: false, step: "", error: "", dismissed: false, verifyFailed: false });
        return booking;
      }
      stage = "checkout";
      const response = await openRazorpay(order);
      stage = "verify";
      setState((s) => ({ ...s, step: "verifying" }));
      const booking = (await verifyPayment(bookingId, response)) || (await getBooking(bookingId));
      setState({ busy: false, step: "", error: "", dismissed: false, verifyFailed: false });
      return booking;
    } catch (err) {
      setState({
        busy: false,
        step: "",
        error: err.message,
        dismissed: Boolean(err.dismissed),
        verifyFailed: stage === "verify",
      });
      return null;
    } finally {
      busyRef.current = false;
    }
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: "", dismissed: false, verifyFailed: false })), []);
  return { ...state, pay, clearError };
}

/** Whole seconds until `iso` (never negative), ticking every second; null without a date. */
export function useCountdown(iso) {
  const target = iso ? new Date(iso).getTime() : NaN;
  const calc = () => (Number.isFinite(target) ? Math.max(0, Math.round((target - Date.now()) / 1000)) : null);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!Number.isFinite(target)) return undefined;
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return left;
}

export const fmtCountdown = (secs) => {
  if (secs === null || secs === undefined) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
