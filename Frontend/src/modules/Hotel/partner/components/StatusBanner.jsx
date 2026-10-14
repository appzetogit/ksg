import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Ban, CheckCircle2, Clock3, PencilLine, XCircle } from "lucide-react";
import { BASE_PATH } from "../lib/constants";
import { cx } from "./ui";

/**
 * The partner account's review state. `incomplete` (profile not filled yet) takes
 * precedence over `pending` so a new partner knows what to do next.
 */
export default function StatusBanner({ partner, incomplete, showAction = true }) {
  if (!partner) return null;
  const status = partner.status;

  let tone;
  let Icon;
  let title;
  let text;
  let action = null;

  if (status === "blocked") {
    tone = "border-zinc-300 bg-zinc-50 text-zinc-800";
    Icon = Ban;
    title = "Account blocked";
    text = partner.rejectionReason || "Please contact KSG support.";
  } else if (status === "rejected") {
    tone = "border-rose-200 bg-rose-50 text-rose-800";
    Icon = XCircle;
    title = "Your application needs changes";
    text = partner.rejectionReason ? `Reason: ${partner.rejectionReason}` : "Please review your details.";
    action = { to: `${BASE_PATH}/profile`, label: "Fix and resubmit" };
  } else if (incomplete) {
    tone = "border-orange-200 bg-orange-50 text-orange-900";
    Icon = PencilLine;
    title = "Finish setting up your account";
    text = "Add your KYC, bank details and accept the partner terms so we can verify you.";
    action = { to: `${BASE_PATH}/profile`, label: "Complete profile" };
  } else if (status === "approved") {
    tone = "border-green-200 bg-green-50 text-green-800";
    Icon = CheckCircle2;
    title = "Your account is verified";
    text = "Approved properties can go live and take bookings.";
  } else {
    tone = "border-amber-200 bg-amber-50 text-amber-900";
    Icon = Clock3;
    title = "Account under review";
    text = "We usually verify partners within 1–2 working days. You can add properties in the meantime.";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      className={cx("flex flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center", tone)}
    >
      <Icon className="hidden h-6 w-6 shrink-0 sm:block" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 sm:hidden" /> {title}
        </p>
        <p className="mt-0.5 text-sm opacity-90">{text}</p>
      </div>
      {showAction && action && (
        <Link
          to={action.to}
          className="inline-flex h-9 w-fit items-center rounded-lg bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-black/5 hover:bg-slate-50"
        >
          {action.label}
        </Link>
      )}
    </motion.div>
  );
}
