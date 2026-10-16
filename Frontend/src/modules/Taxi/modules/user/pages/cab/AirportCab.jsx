import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, LoaderCircle, MapPin, Plane, TrainFront, AlertCircle } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import { getSavedLocation, getSavedLocationCoords } from '../../services/locationStore';

/*
 * Airport / railway station shortcut.
 *
 * Lists active transit hubs near the rider (GET /common/transit-hubs, see
 * docs/taxi-transit-hubs-contract.md). Tapping one fills the drop ("Going to")
 * or the pickup ("Coming from") with the hub's pin and address and opens the
 * normal booking flow, so the fare, and any hub pickup/drop fee or parking, comes
 * from the same server quote as every other ride.
 */

const HUB_TYPES = {
  airport: {
    label: 'Airport',
    title: 'Airport Cab',
    banner: 'Airport transfers',
    sub: 'Pickup and drop at nearby airports',
    Icon: Plane,
    gradient: 'from-blue-600 to-blue-800',
    shadow: 'shadow-[0_8px_24px_rgba(37,99,235,0.25)]',
    active: 'bg-blue-600 text-white border-blue-600',
    chip: 'bg-blue-50 text-blue-600 border-blue-100',
  },
  railway_station: {
    label: 'Railway station',
    title: 'Railway Station Cab',
    banner: 'Station transfers',
    sub: 'Pickup and drop at nearby railway stations',
    Icon: TrainFront,
    gradient: 'from-indigo-600 to-indigo-800',
    shadow: 'shadow-[0_8px_24px_rgba(79,70,229,0.25)]',
    active: 'bg-indigo-600 text-white border-indigo-600',
    chip: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  },
};

const unwrapItems = (response) => {
  const items = response?.data?.items ?? response?.items ?? response?.data ?? [];
  return Array.isArray(items) ? items : [];
};

const AirportCab = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  const type = searchParams.get('type') === 'railway_station' ? 'railway_station' : 'airport';
  const config = HUB_TYPES[type];
  const [direction, setDirection] = useState('to'); // 'to' = hub is the drop, 'from' = hub is the pickup
  const [coords, setCoords] = useState(() => getSavedLocationCoords()); // [lng, lat]
  const [hubs, setHubs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // No saved location yet: ask the browser once.
  useEffect(() => {
    if (coords || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords([pos.coords.longitude, pos.coords.latitude]),
      () => setError('Turn on location to see nearby hubs, or enter the address manually.'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, [coords]);

  useEffect(() => {
    if (!coords) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    api
      .get('/common/transit-hubs', { params: { lat: coords[1], lng: coords[0], type } })
      .then((res) => {
        if (active) setHubs(unwrapItems(res));
      })
      .catch(() => {
        if (active) {
          setHubs([]);
          setError(`Could not load nearby ${config.label.toLowerCase()}s.`);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [coords, type, config.label]);

  const sortedHubs = useMemo(
    () => [...hubs].sort((a, b) => Number(a?.distanceKm ?? Infinity) - Number(b?.distanceKm ?? Infinity)),
    [hubs],
  );

  const openBooking = (hub) => {
    const saved = getSavedLocation();
    const here = saved?.address || '';
    const hubCoords = hub
      ? [Number(hub.longitude), Number(hub.latitude)]
      : null;
    const hubLabel = hub ? (hub.address ? `${hub.name}, ${hub.address}` : hub.name) : '';
    const state = { rideType: 'normal' };
    if (hub && direction === 'to') {
      Object.assign(state, { pickup: here, pickupCoords: coords || null, drop: hubLabel, dropCoords: hubCoords });
    } else if (hub) {
      Object.assign(state, { pickup: hubLabel, pickupCoords: hubCoords, drop: '', dropCoords: null });
    }
    navigate(`${routePrefix}/ride/select-location`, { state });
  };

  const BannerIcon = config.Icon;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-16 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-blue-100/60 blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-sm active:scale-95 transition-all">
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </button>
          <div className="flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Auto & Cab</p>
            <h1 className="text-[19px] font-black tracking-tight text-slate-900">{config.title}</h1>
          </div>
        </div>
      </header>

      {/* Hub type */}
      <div className="mx-5 mt-4 grid grid-cols-2 gap-2">
        {Object.entries(HUB_TYPES).map(([key, item]) => {
          const ItemIcon = item.Icon;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSearchParams(key === 'airport' ? {} : { type: key }, { replace: true })}
              className={`flex items-center justify-center gap-2 py-3 rounded-[14px] text-[12px] font-black border-2 transition-all ${
                type === key ? `${item.active} shadow-sm` : 'bg-white/90 text-slate-600 border-slate-100'
              }`}
            >
              <ItemIcon size={15} strokeWidth={2.4} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Banner */}
      <div className={`mx-5 mt-3 rounded-[20px] overflow-hidden bg-gradient-to-br ${config.gradient} p-5 flex items-center gap-4 ${config.shadow}`}>
        <div className="flex-1">
          <p className="text-[10px] font-black text-white/70 uppercase tracking-widest mb-1">{config.banner}</p>
          <h2 className="text-[18px] font-black text-white leading-tight">{config.sub}</h2>
          <p className="text-[11px] font-bold text-white/70 mt-1">Any {config.label.toLowerCase()} fee is shown with your fare</p>
        </div>
        <div className="w-16 h-16 bg-white/10 rounded-[18px] flex items-center justify-center">
          <BannerIcon size={32} className="text-white" strokeWidth={1.5} />
        </div>
      </div>

      <div className="px-5 pt-4 space-y-4">
        {/* Direction */}
        <div>
          <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 ml-1 mb-1.5 block">Trip</label>
          <div className="flex gap-2">
            {[
              { id: 'to', label: `Going to ${config.label.toLowerCase()}` },
              { id: 'from', label: `Pickup from ${config.label.toLowerCase()}` },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDirection(option.id)}
                className={`flex-1 py-3 px-2 rounded-[14px] text-[12px] font-black border-2 transition-all ${
                  direction === option.id ? `${config.active} shadow-sm` : 'bg-white/90 text-slate-600 border-slate-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Nearby hubs */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400 mb-2">
            Nearby {config.label.toLowerCase()}s
          </p>

          {loading && (
            <div className="min-h-[120px] flex flex-col items-center justify-center gap-2 text-slate-400">
              <LoaderCircle size={22} className="animate-spin" />
              <p className="text-[11px] font-bold uppercase tracking-widest">Finding nearby {config.label.toLowerCase()}s</p>
            </div>
          )}

          {!loading && error && (
            <p className="text-[11px] font-black text-red-500 ml-1 mb-2 flex items-center gap-1">
              <AlertCircle size={11} strokeWidth={3} />{error}
            </p>
          )}

          {!loading && !error && coords && sortedHubs.length === 0 && (
            <div className="rounded-[18px] border border-slate-100 bg-white/90 px-4 py-5 text-center">
              <p className="text-[13px] font-black text-slate-900">No {config.label.toLowerCase()} nearby</p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">You can still enter the address manually.</p>
            </div>
          )}

          {!loading && sortedHubs.length > 0 && (
            <div className="space-y-2">
              {sortedHubs.map((hub, index) => {
                const distance = Number(hub?.distanceKm);
                return (
                  <motion.button
                    key={hub.id || hub._id || `${hub.name}-${index}`}
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => openBooking(hub)}
                    className="w-full flex items-center gap-4 p-4 rounded-[18px] border-2 border-slate-100 bg-white/90 text-left transition-all"
                  >
                    <div className={`w-10 h-10 rounded-[14px] border flex items-center justify-center shrink-0 ${config.chip}`}>
                      <BannerIcon size={18} strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-black text-slate-900">{hub.name}</span>
                        {hub.code && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${config.chip}`}>{hub.code}</span>
                        )}
                      </div>
                      {hub.address && <p className="truncate text-[11px] font-bold text-slate-400">{hub.address}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      {Number.isFinite(distance) && (
                        <p className="text-[13px] font-black text-slate-900">{distance.toFixed(1)} km</p>
                      )}
                      <ChevronRight size={16} className="ml-auto text-slate-300" strokeWidth={2.5} />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => openBooking(null)}
          className="w-full flex items-center justify-center gap-2 rounded-[18px] border-2 border-slate-100 bg-white/90 py-3.5 text-[13px] font-black text-slate-700"
        >
          <MapPin size={15} strokeWidth={2.4} className="text-slate-400" />
          Enter address manually
        </button>
      </div>
    </div>
  );
};

export default AirportCab;
