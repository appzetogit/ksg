import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, Building2, ImageOff, MapPin, PencilLine, Plus, Star } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH, PROPERTY_STATUS_META, typeMeta } from "../lib/constants";
import { asList, money } from "../lib/utils";
import { Card, Chip, EmptyState, InlineError, LinkButton, PageHeader, Skeleton, StatusChip, Toggle } from "../components/ui";

const FILTERS = ["all", "draft", "pending", "approved", "rejected", "suspended"];

export function LiveToggle({ property, partnerApproved, onChange }) {
  const [busy, setBusy] = useState(false);
  const canGoLive = property.status === "approved" && partnerApproved;
  const reason =
    property.status !== "approved"
      ? "A property can go live once KSG approves it."
      : !partnerApproved
        ? "Your partner account must be verified first."
        : "";

  const flip = async (isLive) => {
    setBusy(true);
    try {
      const data = await partnerApi.put(`/partner/properties/${property._id}/live`, { isLive });
      onChange({ ...property, ...(data?.property || {}), isLive: data?.property?.isLive ?? isLive });
      toast.success(isLive ? `${property.name} is live` : `${property.name} is hidden from customers`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2" title={reason || undefined}>
      <span className={`text-xs font-semibold ${property.isLive ? "text-[#16A34A]" : "text-slate-500"}`}>
        {property.isLive ? "Live" : "Offline"}
      </span>
      <Toggle
        checked={Boolean(property.isLive)}
        onChange={flip}
        busy={busy}
        disabled={!canGoLive && !property.isLive}
        label={`${property.name} live on KSG`}
      />
    </div>
  );
}

function PropertyCard({ property, partnerApproved, onChange, index }) {
  const meta = typeMeta(property.propertyType);
  const Icon = meta.icon;
  const editable = ["draft", "rejected"].includes(property.status);
  const city = [property.address?.area, property.address?.city].filter(Boolean).join(", ");
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
    >
      <Card className="flex h-full flex-col overflow-hidden transition hover:shadow-md">
        <Link to={`${BASE_PATH}/properties/${property._id}`} className="relative block aspect-[16/9] bg-slate-100">
          {property.coverImage ? (
            <img src={property.coverImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-slate-300">
              <ImageOff className="h-8 w-8" />
            </span>
          )}
          <span className="absolute left-3 top-3">
            <StatusChip status={property.status} />
          </span>
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-[#0B2A6F] shadow-sm">
            <Icon className="h-3.5 w-3.5" /> {meta.label}
          </span>
        </Link>
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <Link to={`${BASE_PATH}/properties/${property._id}`} className="min-w-0">
              <h3 className="truncate font-semibold text-slate-900 hover:text-[#0B2A6F]">{property.name || "Untitled property"}</h3>
              {city && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-slate-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" /> {city}
                </p>
              )}
            </Link>
            {property.totalReviews > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-xs font-semibold text-green-700">
                <Star className="h-3 w-3 fill-current" /> {Number(property.avgRating).toFixed(1)}
              </span>
            )}
          </div>
          {property.status === "rejected" && property.rejectionReason && (
            <p className="mt-2 line-clamp-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              {property.rejectionReason}
            </p>
          )}
          {property.startingPrice > 0 && (
            <p className="mt-2 text-sm text-slate-600">
              From <span className="font-semibold text-slate-900">{money(property.startingPrice)}</span> / night
            </p>
          )}
          <div className="min-h-4 flex-1" />
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            {editable ? (
              <Link
                to={`${BASE_PATH}/properties/${property._id}/edit`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-[#E85D04] hover:underline"
              >
                <PencilLine className="h-4 w-4" /> {property.status === "draft" ? "Continue setup" : "Fix & resubmit"}
              </Link>
            ) : (
              <Link
                to={`${BASE_PATH}/properties/${property._id}`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-[#0B2A6F] hover:underline"
              >
                Manage <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            <LiveToggle property={property} partnerApproved={partnerApproved} onChange={onChange} />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export default function Properties() {
  const { isApproved } = usePartner();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(() => {
    setError("");
    partnerApi
      .get("/partner/properties")
      .then((d) => setItems(asList(d, "properties")))
      .catch((e) => {
        setError(e.message);
        setItems((v) => v || []);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (next) => setItems((list) => list.map((p) => (p._id === next._id ? next : p)));
  const shown = (items || []).filter((p) => filter === "all" || p.status === filter);
  const count = (s) => (items || []).filter((p) => s === "all" || p.status === s).length;

  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle="Everything you list on KSG Stays."
        action={
          <LinkButton to={`${BASE_PATH}/properties/new`} icon={Plus}>
            Add property
          </LinkButton>
        }
      />

      {error && (
        <div className="mb-4">
          <InlineError message={error} onRetry={load} />
        </div>
      )}

      {items && items.length > 0 && (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
          {FILTERS.filter((f) => f === "all" || count(f) > 0).map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : PROPERTY_STATUS_META[f].label} · {count(f)}
            </Chip>
          ))}
        </div>
      )}

      {!items ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No properties yet"
          text="Add your hotel, resort, villa, homestay, hostel or PG. It takes about 10 minutes, and you can save and come back anytime."
          action={
            <LinkButton to={`${BASE_PATH}/properties/new`} icon={Plus}>
              Add your first property
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>
            {shown.map((p, i) => (
              <PropertyCard key={p._id} property={p} index={i} partnerApproved={isApproved} onChange={replace} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
