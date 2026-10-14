import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarCheck, Luggage, Search } from "lucide-react";
import { BTN, StateMessage, cx } from "../components/ui";
import { getUserToken, loginRedirect } from "../lib/session";
import useTitle from "../lib/useTitle";

const TABS = ["Upcoming", "Completed", "Cancelled"];

// TODO(booking phase): list GET /user/bookings here (tabs by status), with booking
// detail, voucher, cancel with refund preview and write-a-review.
export default function StaysPage() {
  useTitle("My stays");
  const navigate = useNavigate();
  const loggedIn = Boolean(getUserToken());

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold text-slate-900">My stays</h1>
      <p className="mt-1 text-sm text-slate-500">Your hotel bookings, vouchers and cancellations in one place.</p>

      <div className="mt-6 flex gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200/70" role="tablist" aria-label="Booking status">
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={i === 0}
            disabled={i !== 0}
            className={cx("flex-1 rounded-xl py-2 text-sm font-semibold", i === 0 ? "bg-[#0B2A6F] text-white" : "text-slate-400")}
          >
            {t}
          </button>
        ))}
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
        {loggedIn ? (
          <StateMessage
            icon={Luggage}
            tone="saffron"
            title="No trips booked yet"
            message="Online hotel booking opens soon. Once you reserve a stay, it will show up here with your voucher and check-in details."
          >
            <Link to="/hotel" className={BTN.primary}>
              <Search className="h-4 w-4" aria-hidden="true" /> Explore stays
            </Link>
          </StateMessage>
        ) : (
          <StateMessage icon={CalendarCheck} title="Log in to see your stays" message="Your bookings are linked to your KSG account.">
            <button type="button" onClick={() => loginRedirect(navigate, "/hotel/stays")} className={BTN.navy}>
              Log in
            </button>
            <Link to="/hotel" className={BTN.outline}>
              Explore stays
            </Link>
          </StateMessage>
        )}
      </motion.div>
    </div>
  );
}
