import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronRight, MapPin, Navigation } from "lucide-react";
import HeartButton from "./HeartButton";
import { PriceTag, RatingBadge, Skeleton, SmartImage, cx, fadeUp } from "./ui";
import { amenityIcon, amenityLabel, typeLabel } from "../lib/catalogue";
import { formatDistance, shortAddress } from "../lib/format";

export const propertyHref = (p, stayQs) => `/hotel/p/${encodeURIComponent(p.slug || p._id)}${stayQs ? `?${stayQs}` : ""}`;

/** Search result row: horizontal on tablets/desktop, stacked on phones. */
export function ResultCard({ property: p, stayQs, catalogue, priority = false }) {
  const amenities = (p.amenities || []).slice(0, 4);
  const soldOut = p.available === false;
  return (
    <motion.article variants={fadeUp} className="relative">
      <Link
        to={propertyHref(p, stayQs)}
        className="group grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 sm:grid-cols-[260px_1fr]"
      >
        <div className="relative">
          <SmartImage src={p.coverImage} alt={p.name} eager={priority} className="aspect-[16/10] h-full w-full sm:aspect-auto sm:min-h-[210px]" imgClassName="transition-transform duration-700 group-hover:scale-105" />
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#0B2A6F] shadow">
            {typeLabel(p.propertyType)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-base font-bold text-slate-900 group-hover:text-[#0B2A6F] sm:text-lg">{p.name}</h3>
              <p className="mt-1 flex items-center gap-1 truncate text-sm text-slate-500">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {shortAddress(p.address) || "Location on request"}
              </p>
              {p.distanceKm !== undefined && p.distanceKm !== null && (
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#16A34A]">
                  <Navigation className="h-3 w-3" aria-hidden="true" />
                  {formatDistance(p.distanceKm)}
                </p>
              )}
            </div>
            <RatingBadge rating={p.avgRating} reviews={p.totalReviews} />
          </div>

          {amenities.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Key amenities">
              {amenities.map((key) => {
                const Icon = amenityIcon(key);
                return (
                  <li key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {amenityLabel(key, catalogue)}
                  </li>
                );
              })}
              {p.amenities.length > 4 && <li className="text-xs font-medium text-slate-400">+{p.amenities.length - 4} more</li>}
            </ul>
          )}

          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <div className="text-xs">
              {soldOut ? (
                <span className="font-semibold text-rose-600">Sold out for your dates</span>
              ) : (
                <span className="inline-flex items-center gap-1 font-semibold text-[#0B2A6F]">
                  View rooms <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              )}
            </div>
            {Number(p.startingPrice) > 0 ? (
              <PriceTag price={p.startingPrice} original={p.originalPrice} suffix="per night + taxes" />
            ) : (
              <span className="text-sm text-slate-500">Price on selection</span>
            )}
          </div>
        </div>
      </Link>
      <HeartButton propertyId={p._id} name={p.name} className="absolute right-3 top-3 sm:left-[212px] sm:right-auto" />
    </motion.article>
  );
}

export function ResultCardSkeleton() {
  return (
    <div className="grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white sm:grid-cols-[260px_1fr]">
      <Skeleton className="aspect-[16/10] rounded-none sm:aspect-auto sm:min-h-[210px]" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="flex gap-3 pt-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        <div className="flex justify-end pt-6">
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
    </div>
  );
}

/** Compact vertical card for horizontal strips. */
export function MiniCard({ property: p, stayQs }) {
  return (
    <motion.div variants={fadeUp} className="relative w-[250px] shrink-0 snap-start sm:w-[280px]">
      <Link
        to={propertyHref(p, stayQs)}
        className="group block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
      >
        <div className="relative">
          <SmartImage src={p.coverImage} alt={p.name} className="aspect-[4/3]" imgClassName="transition-transform duration-700 group-hover:scale-105" />
          {p.distanceKm !== undefined && p.distanceKm !== null && (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
              {formatDistance(p.distanceKm)}
            </span>
          )}
        </div>
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-1 text-sm font-bold text-slate-900">{p.name}</h3>
            <RatingBadge rating={p.avgRating} reviews={p.totalReviews} />
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {typeLabel(p.propertyType)} · {shortAddress(p.address)}
          </p>
          <div className={cx("mt-2 flex items-baseline gap-1.5")}>
            {Number(p.startingPrice) > 0 && (
              <>
                <span className="text-base font-bold text-slate-900">₹{Number(p.startingPrice).toLocaleString("en-IN")}</span>
                {Number(p.originalPrice) > Number(p.startingPrice) && (
                  <span className="text-xs text-slate-400 line-through">₹{Number(p.originalPrice).toLocaleString("en-IN")}</span>
                )}
                <span className="text-[11px] text-slate-500">/ night</span>
              </>
            )}
          </div>
        </div>
      </Link>
      <HeartButton propertyId={p._id} name={p.name} className="absolute right-2 top-2" />
    </motion.div>
  );
}

export function MiniCardSkeleton() {
  return (
    <div className="w-[250px] shrink-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white sm:w-[280px]">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-3.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}
