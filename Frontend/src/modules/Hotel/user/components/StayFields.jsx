import { useCallback, useRef, useState } from "react";
import { CalendarDays, Users } from "lucide-react";
import DateRangeCalendar from "./DateRangeCalendar";
import Popover, { useOutsideClose } from "./Popover";
import { BTN, Stepper, cx } from "./ui";
import { addDays, diffDays, fmtDay, nightsLabel } from "../lib/dates";
import { LIMITS } from "../lib/searchState";
import { plural } from "../lib/format";

export const guestsSummary = ({ adults, children, rooms }) =>
  [plural(adults, "adult"), children ? plural(children, "child", "children") : null, plural(rooms, "room")]
    .filter(Boolean)
    .join(" · ");

/** Shared field-button look for the date and guest triggers. */
export function FieldButton({ icon: Icon, label, value, sub, open, onClick, className = "", dark = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cx(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4",
        dark ? "focus-visible:ring-orange-200" : "focus-visible:ring-blue-200",
        open ? "bg-orange-50 ring-2 ring-[#FF7A00]" : "hover:bg-slate-50",
        className
      )}
    >
      <Icon className="h-5 w-5 shrink-0 text-[#FF7A00]" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="block truncate text-sm font-semibold text-slate-900">{value}</span>
        {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
      </span>
    </button>
  );
}

/** Date-range field with its calendar popover. `onChange({checkIn, checkOut})`. */
export function DatesField({ checkIn, checkOut, onChange, align = "left", className = "" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ checkIn, checkOut });
  const ref = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    // Closing half-way through: keep the new check-in with a one-night stay.
    const next = draft.checkOut ? draft : { checkIn: draft.checkIn, checkOut: addDays(draft.checkIn, 1) };
    setDraft(next);
    if (next.checkIn !== checkIn || next.checkOut !== checkOut) onChange(next);
  }, [draft, checkIn, checkOut, onChange]);
  useOutsideClose(ref, open, close);

  const toggle = () => {
    if (open) close();
    else {
      setDraft({ checkIn, checkOut });
      setOpen(true);
    }
  };

  const nights = draft.checkOut ? diffDays(draft.checkIn, draft.checkOut) : 0;
  return (
    <div ref={ref} className={cx("relative", className)}>
      <FieldButton
        icon={CalendarDays}
        label="Check-in — Check-out"
        value={`${fmtDay(checkIn)} → ${fmtDay(checkOut)}`}
        sub={nightsLabel(diffDays(checkIn, checkOut))}
        open={open}
        onClick={toggle}
      />
      <Popover
        open={open}
        onClose={close}
        label="Select dates"
        align={align}
        className="sm:w-[640px] sm:max-w-[calc(100vw-2rem)]"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">
              {draft.checkOut ? (
                <>
                  <b className="text-slate-900">{fmtDay(draft.checkIn)}</b> → <b className="text-slate-900">{fmtDay(draft.checkOut)}</b> ·{" "}
                  {nightsLabel(nights)}
                </>
              ) : (
                "Now pick your check-out date"
              )}
            </span>
            <button type="button" onClick={close} className={cx(BTN.primary, "px-6 py-2.5")}>
              Done
            </button>
          </div>
        }
      >
        <DateRangeCalendar
          checkIn={draft.checkIn}
          checkOut={draft.checkOut}
          onChange={(next) => {
            setDraft(next);
            if (next.checkOut) onChange(next);
          }}
        />
      </Popover>
    </div>
  );
}

export function GuestsPanel({ value, onChange }) {
  const set = (patch) => {
    const next = { ...value, ...patch };
    if (next.rooms > next.adults) next.rooms = next.adults;
    onChange(next);
  };
  return (
    <div className="divide-y divide-slate-100">
      <Stepper label="Adults" hint="Age 13+" value={value.adults} min={LIMITS.adults[0]} max={LIMITS.adults[1]} onChange={(adults) => set({ adults })} />
      <Stepper
        label="Children"
        hint="Age 0–12"
        value={value.children}
        min={LIMITS.children[0]}
        max={LIMITS.children[1]}
        onChange={(children) => set({ children })}
      />
      <Stepper
        label="Rooms"
        hint="At least one adult per room"
        value={value.rooms}
        min={LIMITS.rooms[0]}
        max={Math.min(LIMITS.rooms[1], value.adults)}
        onChange={(rooms) => set({ rooms })}
      />
    </div>
  );
}

/** Guests & rooms field with its stepper popover. `onChange({adults, children, rooms})`. */
export function GuestsField({ adults, children, rooms, onChange, align = "left", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(ref, open, close);
  const value = { adults, children, rooms };
  return (
    <div ref={ref} className={cx("relative", className)}>
      <FieldButton icon={Users} label="Guests & rooms" value={guestsSummary(value)} open={open} onClick={() => setOpen((o) => !o)} />
      <Popover
        open={open}
        onClose={close}
        label="Guests & rooms"
        align={align}
        className="sm:w-[340px]"
        footer={
          <button type="button" onClick={close} className={cx(BTN.primary, "w-full")}>
            Done
          </button>
        }
      >
        <GuestsPanel value={value} onChange={onChange} />
      </Popover>
    </div>
  );
}
