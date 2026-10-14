import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MAX_ADVANCE_DAYS, MAX_NIGHTS, addDays, diffDays, fmtDate, todayIST, toUTC } from "../lib/dates";
import { cx } from "./ui";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const monthKey = (iso) => iso.slice(0, 7); // YYYY-MM
const shiftMonth = (ym, n) => {
  const d = toUTC(`${ym}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

function Month({ ym, checkIn, checkOut, hover, today, lastDay, onPick, onHover }) {
  const first = toUTC(`${ym}-01`);
  const lead = first.getUTCDay();
  const next = toUTC(`${shiftMonth(ym, 1)}-01`);
  const days = Math.round((next - first) / 86400000);
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  const rangeEnd = checkOut || (checkIn && hover > checkIn ? hover : null);

  return (
    <div className="w-full">
      <div className="mb-3 text-center text-sm font-bold text-slate-800">
        {first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-slate-400">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`b${i}`} />;
          const disabled =
            iso < today || iso > lastDay || (checkIn && !checkOut && iso > checkIn && diffDays(checkIn, iso) > MAX_NIGHTS);
          const isStart = iso === checkIn;
          const isEnd = iso === checkOut;
          const inRange = checkIn && rangeEnd && iso > checkIn && iso < rangeEnd;
          const isHoverEnd = !checkOut && iso === rangeEnd;
          return (
            <div
              key={iso}
              className={cx(
                "relative flex h-10 items-center justify-center",
                inRange && "bg-orange-50",
                isStart && rangeEnd && "bg-gradient-to-r from-transparent from-50% to-orange-50 to-50%",
                (isEnd || isHoverEnd) && "bg-gradient-to-l from-transparent from-50% to-orange-50 to-50%"
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(iso)}
                onMouseEnter={() => onHover(iso)}
                aria-label={fmtDate(iso, { weekday: "long", day: "numeric", month: "long" })}
                aria-pressed={isStart || isEnd}
                className={cx(
                  "relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition",
                  disabled && "cursor-not-allowed text-slate-300",
                  !disabled && !isStart && !isEnd && "text-slate-700 hover:bg-orange-100",
                  (isStart || isEnd) && "bg-[#FF7A00] font-bold text-white shadow-md shadow-orange-500/30",
                  isHoverEnd && "ring-2 ring-[#FF7A00]",
                  iso === today && !isStart && !isEnd && "font-bold text-[#0B2A6F] underline decoration-2 underline-offset-4"
                )}
              >
                {Number(iso.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Range calendar. First tap picks check-in, second picks check-out. Past dates and
 * stays longer than MAX_NIGHTS are disabled. `onChange({checkIn, checkOut|null})`.
 */
export default function DateRangeCalendar({ checkIn, checkOut, onChange }) {
  const today = todayIST();
  const lastDay = addDays(today, MAX_ADVANCE_DAYS);
  const [view, setView] = useState(monthKey(checkIn || today));
  const [hover, setHover] = useState(null);
  const firstYM = monthKey(today);
  const lastYM = monthKey(lastDay);

  const pick = (iso) => {
    if (!checkIn || checkOut || iso <= checkIn) onChange({ checkIn: iso, checkOut: null });
    else onChange({ checkIn, checkOut: iso });
  };

  const months = useMemo(() => [view, shiftMonth(view, 1)], [view]);

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setView((v) => shiftMonth(v, -1))}
          disabled={view <= firstYM}
          aria-label="Previous month"
          className="absolute left-0 top-0 z-10 rounded-full p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-25"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setView((v) => shiftMonth(v, 1))}
          disabled={view >= lastYM}
          aria-label="Next month"
          className="absolute right-0 top-0 z-10 rounded-full p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-25"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="grid gap-6 sm:grid-cols-2">
          {months.map((ym, idx) => (
            <div key={ym} className={idx === 1 ? "hidden sm:block" : ""}>
              <Month
                ym={ym}
                checkIn={checkIn}
                checkOut={checkOut}
                hover={hover}
                today={today}
                lastDay={lastDay}
                onPick={pick}
                onHover={setHover}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
