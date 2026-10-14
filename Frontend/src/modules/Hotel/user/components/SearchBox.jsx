import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin, Search, X } from "lucide-react";
import { DatesField, GuestsField } from "./StayFields";
import { useOutsideClose } from "./Popover";
import { BTN, cx } from "./ui";
import { getCities } from "../lib/api";
import { plural } from "../lib/format";

/** Ask the browser for the current position; resolves `{lat, lng}`. */
export const locate = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: Number(pos.coords.latitude.toFixed(5)), lng: Number(pos.coords.longitude.toFixed(5)) }),
      (err) =>
        reject(
          new Error(
            err?.code === 1
              ? "Location permission was denied. Allow it in your browser settings, or type a city."
              : "We couldn't find your location. Please type a city instead."
          )
        ),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  });

const destFromState = (s) => {
  if (s.lat !== undefined && s.lng !== undefined) return { text: s.place || "Near me", lat: s.lat, lng: s.lng, place: s.place || "Near me" };
  return { text: s.city || s.q || "", city: s.city || "" };
};

function DestinationField({ value, onChange, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [cities, setCities] = useState([]);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(ref, open, close);

  useEffect(() => {
    getCities()
      .then(setCities)
      .catch(() => setCities([]));
  }, []);

  const isGeo = value.lat !== undefined;
  const term = isGeo ? "" : value.text.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const sorted = [...cities].sort((a, b) => (b.count || 0) - (a.count || 0));
    return (term ? sorted.filter((c) => c.city.toLowerCase().includes(term)) : sorted).slice(0, 6);
  }, [cities, term]);

  // Option 0 is "near me", then the city suggestions.
  const options = [{ kind: "geo" }, ...suggestions.map((c) => ({ kind: "city", ...c }))];

  const useMyLocation = async () => {
    setGeoError("");
    setLocating(true);
    try {
      const { lat, lng } = await locate();
      onChange({ text: "Near me", lat, lng, place: "Near me" });
      setOpen(false);
    } catch (e) {
      setGeoError(e.message);
    } finally {
      setLocating(false);
    }
  };

  const choose = (opt) => {
    if (!opt) return;
    if (opt.kind === "geo") {
      useMyLocation();
      return;
    }
    onChange({ text: opt.city, city: opt.city });
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <label className="flex items-center gap-3 rounded-xl px-4 py-3 transition focus-within:bg-orange-50 focus-within:ring-2 focus-within:ring-[#FF7A00] hover:bg-slate-50">
        {isGeo ? (
          <LocateFixed className="h-5 w-5 shrink-0 text-[#16A34A]" aria-hidden="true" />
        ) : (
          <MapPin className="h-5 w-5 shrink-0 text-[#FF7A00]" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Where to?</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder="City, area or hotel name"
            value={value.text}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onChange={(e) => {
              onChange({ text: e.target.value });
              setActive(-1);
              setOpen(true);
            }}
            className="block w-full truncate bg-transparent text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
          />
        </span>
        {value.text && (
          <button
            type="button"
            aria-label="Clear destination"
            onClick={() => {
              onChange({ text: "" });
              inputRef.current?.focus();
            }}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </label>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[60] overflow-hidden rounded-2xl border border-slate-200 bg-white py-2 text-slate-800 shadow-2xl sm:right-auto sm:w-[360px]">
          <ul id={listId} role="listbox" aria-label="Destinations">
            {options.map((opt, i) => (
              <li
                key={opt.kind === "geo" ? "geo" : opt.city}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active === i}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(opt)}
                onMouseEnter={() => setActive(i)}
                className={cx("flex cursor-pointer items-center gap-3 px-4 py-2.5", active === i && "bg-orange-50")}
              >
                {opt.kind === "geo" ? (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-[#16A34A]">
                      {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[#16A34A]">Near me</span>
                      <span className="block text-xs text-slate-500">Use my current location</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{opt.city}</span>
                      <span className="block text-xs text-slate-500">{plural(opt.count || 0, "stay")}</span>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {geoError && (
            <p role="alert" className="mx-4 mt-1 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {geoError}
            </p>
          )}
          {!suggestions.length && term && (
            <p className="px-4 py-2 text-xs text-slate-500">
              No city matches “{value.text}”. Search anyway to look through hotel names and areas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The hotel search form: destination, dates, guests. `initial` is a search state
 * (lib/searchState.readSearch); `onSearch(patch)` receives the fields to put in the URL.
 */
export default function SearchBox({ initial, onSearch, variant = "hero", autoFocus = false }) {
  const [dest, setDest] = useState(() => destFromState(initial));
  const [stay, setStay] = useState({ checkIn: initial.checkIn, checkOut: initial.checkOut });
  const [guests, setGuests] = useState({ adults: initial.adults, children: initial.children, rooms: initial.rooms });

  const submit = (e) => {
    e?.preventDefault();
    const text = dest.text.trim();
    const geo = dest.lat !== undefined && dest.lng !== undefined;
    onSearch({
      q: !geo && !dest.city ? text : "",
      city: !geo ? dest.city || "" : "",
      lat: geo ? dest.lat : undefined,
      lng: geo ? dest.lng : undefined,
      place: geo ? dest.place : "",
      ...stay,
      ...guests,
      sort: geo ? "distance" : undefined,
      page: 1,
    });
  };

  const hero = variant === "hero";
  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label="Search hotels"
      className={cx(
        "grid gap-1 rounded-2xl bg-white p-2 text-left shadow-2xl",
        hero ? "shadow-blue-950/30 lg:grid-cols-[1.4fr_1.5fr_1fr_auto]" : "border border-slate-200 shadow-lg lg:grid-cols-[1.4fr_1.5fr_1fr_auto]"
      )}
    >
      <DestinationField
        value={dest}
        autoFocus={autoFocus}
        onChange={(patch) => setDest(patch.lat !== undefined || patch.city ? patch : { text: patch.text })}
      />
      <DatesField checkIn={stay.checkIn} checkOut={stay.checkOut} onChange={setStay} className="lg:border-l lg:border-slate-100" />
      <GuestsField {...guests} onChange={setGuests} align="right" className="lg:border-l lg:border-slate-100" />
      <button type="submit" className={cx(BTN.primary, "m-1 h-auto min-h-[52px] px-7 text-base")}>
        <Search className="h-5 w-5" aria-hidden="true" />
        Search
      </button>
    </form>
  );
}
