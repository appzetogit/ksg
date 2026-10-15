import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BedDouble, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { BASE_PATH } from "../lib/constants";
import { formatDate, money } from "../lib/utils";
import { BOOKING_STATUS_META, guestCount, paymentState } from "../lib/bookings";
import { Button, Card, Modal, cx } from "./ui";

/* Pieces shared by the partner bookings, dashboard and earnings screens. */

export function BookingStatusChip({ status }) {
  const meta = BOOKING_STATUS_META[status] || { label: status || "Unknown", chip: "bg-slate-100 text-slate-600 ring-slate-200" };
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", meta.chip)}>
      {meta.label}
    </span>
  );
}

const PAY_TONE = {
  paid: "bg-green-50 text-green-700 ring-green-200",
  partly: "bg-amber-50 text-amber-700 ring-amber-200",
  at_hotel: "bg-blue-50 text-[#0B2A6F] ring-blue-200",
};

export function PaymentBadge({ booking, className }) {
  const s = paymentState(booking);
  const text = s.key === "partly" ? `Partly paid · ${money(s.due)} due` : s.key === "at_hotel" ? `Pay at hotel · ${money(s.due)}` : "Paid";
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        PAY_TONE[s.key],
        className,
      )}
    >
      {text}
    </span>
  );
}

/** One booking as a tappable card (lists, dashboard). */
export function BookingCard({ booking: b, compact = false }) {
  const rooms = Number(b.rooms) || 1;
  return (
    <Link to={`${BASE_PATH}/bookings/${b._id}`} className="group block focus:outline-none">
      <Card className="p-4 transition group-hover:border-slate-300 group-hover:shadow-md group-focus-visible:ring-4 group-focus-visible:ring-blue-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{b.guestDetails?.name || "Guest"}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              <span className="font-mono">{b.bookingRef}</span>
              {b.snapshot?.propertyName ? ` · ${b.snapshot.propertyName}` : ""}
            </p>
          </div>
          <BookingStatusChip status={b.status} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
          <span className="font-medium">
            {formatDate(b.checkIn, { day: "numeric", month: "short" })} → {formatDate(b.checkOut, { day: "numeric", month: "short" })}
            <span className="font-normal text-slate-400"> · {b.nights}N</span>
          </span>
          {!compact && (
            <>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <BedDouble className="h-4 w-4" /> {rooms} × {b.snapshot?.roomTypeName || "Room"}
              </span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Users className="h-4 w-4" /> {guestCount(b.guests)}
              </span>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <PaymentBadge booking={b} />
          <span className="flex items-center gap-1 text-sm font-bold text-[#071A47]">
            {money(b.pricing?.total)}
            <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

export function BookingCardSkeletons({ count = 4 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-200/70" aria-hidden />
  ));
}

/** Previous / next for a `{ page, limit, total }` envelope. */
export function Pager({ page, limit, total, onPage, busy }) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(limit) || 20)));
  if (!total || pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-600">
      <span className="tabular-nums">
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * A modal whose primary button runs `onSubmit()` (may return a promise). It stays open
 * and busy until that settles; it closes only on success, so a failed call can be retried.
 * Buttons are disabled while busy to stop double submits.
 */
export function ActionDialog({
  open,
  onClose,
  title,
  children,
  submitLabel = "Confirm",
  variant = "primary",
  onSubmit,
  canSubmit = true,
  extraActions,
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch {
      /* the caller showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {extraActions?.map((a) => (
            <Button key={a.label} variant={a.variant || "secondary"} disabled={busy || a.disabled} onClick={() => run(a.onClick)}>
              {a.label}
            </Button>
          ))}
          <Button variant={variant} loading={busy} disabled={!canSubmit} onClick={() => run(onSubmit)}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
