import { useEffect, useId, useState } from "react";
import { Check, Star } from "lucide-react";
import { cx } from "./ui";
import { amenityIcon, catalogueAmenities, catalogueSuitability, catalogueTypes, typeIcon } from "../lib/catalogue";

const PRICE_BUCKETS = [
  { label: "Under ₹1,000", min: undefined, max: 1000 },
  { label: "₹1,000 – ₹2,500", min: 1000, max: 2500 },
  { label: "₹2,500 – ₹5,000", min: 2500, max: 5000 },
  { label: "₹5,000+", min: 5000, max: undefined },
];

const RATINGS = [4.5, 4, 3.5, 3];

function Group({ title, children, action }) {
  return (
    <fieldset className="border-b border-slate-100 py-5 first:pt-0 last:border-0">
      <div className="mb-3 flex items-center justify-between">
        <legend className="text-sm font-bold text-slate-900">{title}</legend>
        {action}
      </div>
      {children}
    </fieldset>
  );
}

function CheckRow({ checked, onChange, icon: Icon, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg py-1.5 text-sm text-slate-700 hover:text-slate-900">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={cx(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition peer-focus-visible:ring-4 peer-focus-visible:ring-blue-200",
          checked ? "border-[#0B2A6F] bg-[#0B2A6F] text-white" : "border-slate-300 bg-white"
        )}
        aria-hidden="true"
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      <span>{children}</span>
    </label>
  );
}

function Chip({ active, onClick, children, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200",
        active ? "border-[#FF7A00] bg-orange-50 text-[#E85D04]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
      )}
    >
      {children}
    </button>
  );
}

function PriceInputs({ min, max, onCommit }) {
  const [lo, setLo] = useState(min ?? "");
  const [hi, setHi] = useState(max ?? "");
  const idLo = useId();
  const idHi = useId();
  useEffect(() => {
    setLo(min ?? "");
    setHi(max ?? "");
  }, [min, max]);
  const commit = () => {
    const a = lo === "" ? undefined : Math.max(0, Number(lo));
    const b = hi === "" ? undefined : Math.max(0, Number(hi));
    const [nextMin, nextMax] = a !== undefined && b !== undefined && a > b ? [b, a] : [a, b];
    if (nextMin !== min || nextMax !== max) onCommit(nextMin, nextMax);
  };
  const onKey = (e) => e.key === "Enter" && (e.preventDefault(), commit());
  const field = "w-full rounded-lg border border-slate-300 py-2 pl-6 pr-2 text-sm focus:border-[#0B2A6F] focus:outline-none focus:ring-2 focus:ring-blue-100";
  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="relative flex-1">
        <label htmlFor={idLo} className="sr-only">
          Minimum price per night
        </label>
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
        <input id={idLo} type="number" inputMode="numeric" min="0" placeholder="Min" value={lo} onChange={(e) => setLo(e.target.value)} onBlur={commit} onKeyDown={onKey} className={field} />
      </div>
      <span className="text-slate-400">–</span>
      <div className="relative flex-1">
        <label htmlFor={idHi} className="sr-only">
          Maximum price per night
        </label>
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
        <input id={idHi} type="number" inputMode="numeric" min="0" placeholder="Max" value={hi} onChange={(e) => setHi(e.target.value)} onBlur={commit} onKeyDown={onKey} className={field} />
      </div>
    </div>
  );
}

/**
 * Filter controls. `value` is the search state; `onChange(patch)` receives changed
 * filter fields. Used live in the desktop sidebar and on a draft in the mobile sheet.
 */
export default function Filters({ value, onChange, catalogue }) {
  const [allAmenities, setAllAmenities] = useState(false);
  const types = catalogueTypes(catalogue);
  const amenities = catalogueAmenities(catalogue);
  const suitability = catalogueSuitability(catalogue);
  const shownAmenities = allAmenities ? amenities : amenities.slice(0, 8);

  const toggle = (key, item, on) => {
    const set = new Set(value[key] || []);
    if (on) set.add(item);
    else set.delete(item);
    onChange({ [key]: [...set] });
  };

  return (
    <div>
      <Group title="Price per night">
        <div className="flex flex-wrap gap-2">
          {PRICE_BUCKETS.map((b) => {
            const active = value.minPrice === b.min && value.maxPrice === b.max;
            return (
              <Chip key={b.label} active={active} onClick={() => onChange(active ? { minPrice: undefined, maxPrice: undefined } : { minPrice: b.min, maxPrice: b.max })}>
                {b.label}
              </Chip>
            );
          })}
        </div>
        <PriceInputs min={value.minPrice} max={value.maxPrice} onCommit={(minPrice, maxPrice) => onChange({ minPrice, maxPrice })} />
      </Group>

      {types.length > 0 && (
        <Group title="Property type">
          {types.map((t) => (
            <CheckRow key={t.key} icon={typeIcon(t.key)} checked={value.types.includes(t.key)} onChange={(on) => toggle("types", t.key, on)}>
              {t.label}
            </CheckRow>
          ))}
        </Group>
      )}

      <Group title="Guest rating">
        <div className="flex flex-wrap gap-2">
          {RATINGS.map((r) => (
            <Chip key={r} active={value.minRating === r} onClick={() => onChange({ minRating: value.minRating === r ? undefined : r })} ariaLabel={`Rated ${r} and above`}>
              <Star className="h-3 w-3 fill-current" aria-hidden="true" /> {r}+
            </Chip>
          ))}
        </div>
      </Group>

      {suitability.length > 0 && (
        <Group title="Suitable for">
          <div className="flex flex-wrap gap-2">
            {suitability.map((s) => (
              <Chip key={s.key} active={value.suitability === s.key} onClick={() => onChange({ suitability: value.suitability === s.key ? "" : s.key })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Group>
      )}

      {amenities.length > 0 && (
        <Group
          title="Amenities"
          action={
            amenities.length > 8 && (
              <button type="button" onClick={() => setAllAmenities((v) => !v)} className="text-xs font-semibold text-[#0B2A6F] hover:underline">
                {allAmenities ? "Show fewer" : `Show all ${amenities.length}`}
              </button>
            )
          }
        >
          {shownAmenities.map((a) => (
            <CheckRow key={a.key} icon={amenityIcon(a.key)} checked={value.amenities.includes(a.key)} onChange={(on) => toggle("amenities", a.key, on)}>
              {a.label}
            </CheckRow>
          ))}
        </Group>
      )}
    </div>
  );
}
