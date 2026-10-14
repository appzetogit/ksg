import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  FileX2,
  MapPin,
  PauseCircle,
  RotateCcw,
  Star,
  XCircle,
} from "lucide-react";
import { getCatalogue } from "../../shared/hotelApi";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { formatDate, fullAddress, label, money } from "../format";
import StatusActions from "../components/StatusActions";
import { BackLink } from "./PartnerDetail";
import {
  Button,
  Card,
  ConfirmDialog,
  DetailSkeleton,
  EmptyState,
  ErrorState,
  Fields,
  FileTile,
  LiveBadge,
  PageHeader,
  StatusBadge,
  cx,
} from "../components/ui";

const ACTIONS = [
  {
    status: "approved",
    label: "Approve",
    tone: "success",
    icon: CheckCircle2,
    title: "Approve this property?",
    message: "Approving also marks its documents verified. The partner can then put it live.",
    success: "Property approved",
  },
  {
    status: "rejected",
    label: "Reject",
    tone: "danger",
    icon: XCircle,
    reasonRequired: true,
    title: "Reject this property?",
    message: "The partner sees the reason and can fix the listing and resubmit.",
    success: "Property rejected",
  },
  {
    status: "suspended",
    label: "Suspend",
    tone: "warning",
    icon: PauseCircle,
    reasonRequired: true,
    title: "Suspend this property?",
    message: "It disappears from search and stops taking new bookings.",
    success: "Property suspended",
    when: (current) => current !== "draft",
  },
  {
    status: "pending",
    label: "Move to pending",
    tone: "ghost",
    icon: RotateCcw,
    title: "Move back to pending?",
    message: "The property returns to the approval queue.",
    success: "Moved back to pending",
  },
];

function Gallery({ cover, images, name }) {
  const all = [...new Set([cover, ...(images || [])].filter(Boolean))];
  const [active, setActive] = useState(all[0]);
  useEffect(() => setActive(all[0]), [cover]); // eslint-disable-line react-hooks/exhaustive-deps
  if (all.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-[var(--ha-border)] bg-white text-sm text-[var(--ha-ink-faint)]">
        No photos uploaded
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--ha-border)] bg-white shadow-sm">
      <a href={active} target="_blank" rel="noopener noreferrer" className="block bg-slate-100" title="Open full size">
        <img src={active} alt={name} className="h-64 w-full object-cover sm:h-80" />
      </a>
      {all.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-2">
          {all.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(src)}
              className={cx(
                "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition",
                src === active ? "ring-[var(--ha-navy)]" : "ring-transparent opacity-80 hover:opacity-100",
              )}
              aria-label={`Photo ${i + 1}`}
            >
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              {src === cover && (
                <span className="absolute bottom-0 left-0 right-0 bg-[#0B1B3F]/70 text-center text-[9px] font-bold uppercase text-white">Cover</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chips({ items, empty = "None" }) {
  if (!items?.length) return <p className="text-sm text-[var(--ha-ink-faint)]">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-full border border-[var(--ha-border)] bg-[var(--ha-surface)] px-2.5 py-1 text-xs text-[var(--ha-ink-soft)]">
          {t}
        </span>
      ))}
    </div>
  );
}

function RoomTypes({ rooms }) {
  if (!rooms.length) return <EmptyState icon={BedDouble} title="No room types" message="The partner has not added any room types yet." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-[var(--ha-surface)] text-[11px] font-bold uppercase tracking-wide text-[var(--ha-ink-faint)]">
          <tr>
            <th className="px-4 py-3">Room type</th>
            <th className="px-4 py-3">Sold as</th>
            <th className="px-4 py-3">Occupancy</th>
            <th className="px-4 py-3">Inventory</th>
            <th className="px-4 py-3">Price / night</th>
            <th className="px-4 py-3">Weekend</th>
            <th className="px-4 py-3">Extra A / C</th>
            <th className="px-4 py-3">Meals</th>
            <th className="px-4 py-3">Active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ha-border)]">
          {rooms.map((r) => (
            <tr key={r._id} className="align-top">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {r.images?.[0] ? (
                    <a href={r.images[0]} target="_blank" rel="noopener noreferrer">
                      <img src={r.images[0]} alt="" loading="lazy" className="h-10 w-14 rounded-md object-cover" />
                    </a>
                  ) : null}
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ha-ink)]">{r.name}</p>
                    <p className="text-xs text-[var(--ha-ink-faint)]">
                      {[r.roomCategory && label(r.roomCategory), `${r.images?.length || 0} photos`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{label(r.inventoryType)}</td>
              <td className="px-4 py-3 tabular-nums text-[var(--ha-ink-soft)]">
                {r.baseAdults ?? "—"}A {r.baseChildren ?? 0}C
                <span className="block text-xs text-[var(--ha-ink-faint)]">
                  max {r.maxAdults ?? "—"}A {r.maxChildren ?? 0}C
                </span>
              </td>
              <td className="px-4 py-3 tabular-nums text-[var(--ha-ink-soft)]">
                {r.totalInventory ?? "—"}
                {r.inventoryType === "bed" && r.bedsPerRoom ? (
                  <span className="block text-xs text-[var(--ha-ink-faint)]">{r.bedsPerRoom} beds/room</span>
                ) : null}
              </td>
              <td className="px-4 py-3 tabular-nums">
                <span className="font-semibold text-[var(--ha-ink)]">{money(r.pricePerNight)}</span>
                {r.originalPrice ? <span className="block text-xs text-[var(--ha-ink-faint)] line-through">{money(r.originalPrice)}</span> : null}
              </td>
              <td className="px-4 py-3 tabular-nums text-[var(--ha-ink-soft)]">{money(r.weekendPrice)}</td>
              <td className="px-4 py-3 tabular-nums text-[var(--ha-ink-soft)]">
                {money(r.extraAdultPrice)} / {money(r.extraChildPrice)}
              </td>
              <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{label(r.mealPlan)}</td>
              <td className="px-4 py-3">
                <span className={cx("text-xs font-semibold", r.isActive === false ? "text-slate-500" : "text-emerald-700")}>
                  {r.isActive === false ? "No" : "Yes"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Documents({ propertyId, docs, fallbackRequired, onChanged }) {
  const [dialog, setDialog] = useState(null); // 'verified' | 'rejected'
  const list = Array.isArray(docs?.documents) ? docs.documents : [];
  const required = Array.isArray(docs?.requiredTypes) ? docs.requiredTypes : fallbackRequired;
  const uploaded = new Set(list.map((d) => d.type));
  const missing = required.filter((t) => !uploaded.has(t));
  const status = docs?.verificationStatus || "pending";

  const submit = async (remark) => {
    try {
      await hotelAdmin.verifyDocuments(propertyId, dialog, remark);
      toast.success(dialog === "verified" ? "Documents verified" : "Documents rejected");
      await onChanged();
    } catch (err) {
      toast.error(err?.message || "Could not update the documents");
      throw err;
    }
  };

  return (
    <Card
      title="Documents"
      actions={<StatusBadge status={status} />}
    >
      <div className="mb-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ha-ink-faint)]">Required for this property type</p>
        {required.length === 0 ? (
          <p className="text-sm text-[var(--ha-ink-faint)]">None</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {required.map((t) => {
              const ok = uploaded.has(t);
              return (
                <li
                  key={t}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                    ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200",
                  )}
                >
                  {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {label(t)}
                  {!ok && " — missing"}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--ha-border)] bg-[var(--ha-surface)] px-4 py-6 text-center text-sm text-[var(--ha-ink-faint)]">
          No documents uploaded.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((d, i) => (
            <div key={`${d.type}-${i}`} className="space-y-1">
              <FileTile url={d.fileUrl} title={d.name || label(d.type)} />
              <p className="px-1 text-[11px] text-[var(--ha-ink-faint)]">
                {label(d.type)}
                {d.isRequired ? " · required" : ""} · {formatDate(d.uploadedAt)}
              </p>
            </div>
          ))}
        </div>
      )}

      {docs?.adminRemark && (
        <p className="mt-4 rounded-lg bg-[var(--ha-surface)] px-3 py-2 text-sm text-[var(--ha-ink-soft)]">
          <span className="font-semibold text-[var(--ha-ink)]">Admin remark:</span> {docs.adminRemark}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {status !== "verified" && (
          <Button tone="success" icon={FileCheck2} onClick={() => setDialog("verified")}>
            Verify documents
          </Button>
        )}
        {status !== "rejected" && (
          <Button tone="danger" icon={FileX2} onClick={() => setDialog("rejected")}>
            Reject documents
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog === "verified" ? "Verify these documents?" : "Reject these documents?"}
        message={
          dialog === "verified"
            ? missing.length
              ? `Still missing: ${missing.map(label).join(", ")}. Verify anyway?`
              : "All required documents are uploaded."
            : "The partner is asked to upload them again."
        }
        confirmLabel={dialog === "verified" ? "Verify" : "Reject"}
        tone={dialog === "verified" ? "success" : "danger"}
        reason
        reasonRequired={dialog === "rejected"}
        reasonLabel="Remark"
        onConfirm={submit}
        onClose={() => setDialog(null)}
      />
    </Card>
  );
}

function LiveToggle({ property, onChanged }) {
  const [open, setOpen] = useState(false);
  const next = !property.isLive;
  const canGoLive = property.status === "approved";

  const submit = async () => {
    try {
      await hotelAdmin.setLive(property._id, next);
      toast.success(next ? "Property is live" : "Property taken offline");
      await onChanged();
    } catch (err) {
      toast.error(err?.message || "Could not change live status");
      throw err;
    }
  };

  return (
    <Card title="Visibility">
      <div className="flex items-center justify-between gap-4">
        <div>
          <LiveBadge isLive={property.isLive} />
          <p className="mt-2 text-xs text-[var(--ha-ink-faint)]">
            {canGoLive
              ? "Admin override of the partner's live switch."
              : "Only an approved property can be live."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(property.isLive)}
          aria-label="Live"
          disabled={!property.isLive && !canGoLive}
          onClick={() => setOpen(true)}
          className={cx(
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            property.isLive ? "bg-emerald-600" : "bg-slate-300",
          )}
        >
          <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", property.isLive ? "translate-x-6" : "translate-x-1")} />
        </button>
      </div>
      <ConfirmDialog
        open={open}
        title={next ? "Put this property live?" : "Take this property offline?"}
        message={next ? "It appears in search and can take bookings." : "It disappears from search. Existing bookings are not affected."}
        confirmLabel={next ? "Go live" : "Take offline"}
        tone={next ? "success" : "warning"}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      />
    </Card>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useLoad(() => hotelAdmin.property(id), [id]);
  const [catalogue, setCatalogue] = useState(null);
  useEffect(() => {
    getCatalogue().then(setCatalogue).catch(() => {});
  }, []);

  const back = <BackLink to="/admin/hotel/properties">Properties</BackLink>;
  const property = data?.property;

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Property" back={back} />
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      </div>
    );
  }
  if (loading && !property) return <div className="mx-auto max-w-6xl"><DetailSkeleton /></div>;
  if (!property) return null;

  const partner = data?.partner;
  const rooms = Array.isArray(data?.roomTypes) ? data.roomTypes : [];
  const amenityLabel = Object.fromEntries((catalogue?.amenities || []).map((a) => [a.key, a.label]));
  const fallbackRequired = catalogue?.requiredDocuments?.[property.propertyType] || [];
  const td = property.typeDetails || {};
  const coords = property.location?.coordinates;
  const policy = property.cancellationPolicy || {};

  const changeStatus = async (status, reason) => {
    await hotelAdmin.setPropertyStatus(id, status, reason);
    await reload();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {property.name}
            <StatusBadge status={property.status} />
            {property.status === "approved" && <LiveBadge isLive={property.isLive} />}
          </span>
        }
        subtitle={`${label(property.propertyType)} · ${[property.address?.area, property.address?.city].filter(Boolean).join(", ") || "No city"} · updated ${formatDate(property.updatedAt)}`}
        actions={<StatusActions current={property.status} actions={ACTIONS} onChange={changeStatus} disabled={loading} />}
      />

      {property.rejectionReason && ["rejected", "suspended"].includes(property.status) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">{label(property.status)} reason:</span> {property.rejectionReason}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Gallery cover={property.coverImage} images={property.images} name={property.name} />

          <Card title="Details">
            {property.shortDescription && <p className="mb-2 font-semibold text-[var(--ha-ink)]">{property.shortDescription}</p>}
            {property.description && <p className="mb-4 whitespace-pre-line text-sm text-[var(--ha-ink-soft)]">{property.description}</p>}
            <Fields
              rows={[
                ["Type", label(property.propertyType)],
                td.hotelCategory && ["Category", label(td.hotelCategory)],
                td.starRating && ["Star rating", `${td.starRating} star`],
                td.resortType && ["Resort type", label(td.resortType)],
                td.pgType && ["PG for", label(td.pgType)],
                td.hostelType && ["Hostel for", label(td.hostelType)],
                td.hostLivesOnProperty != null && ["Host lives on property", td.hostLivesOnProperty ? "Yes" : "No"],
                ["Suitability", label(property.suitability)],
                ["Contact", property.contactNumber],
                ["Check-in / out", `${property.checkInTime || "—"} / ${property.checkOutTime || "—"}`],
                ["Starting price", money(property.startingPrice)],
                [
                  "Rating",
                  property.totalReviews ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      {Number(property.avgRating || 0).toFixed(1)} ({property.totalReviews})
                    </span>
                  ) : (
                    "No reviews"
                  ),
                ],
                ["Slug", property.slug],
                ["Created", formatDate(property.createdAt, true)],
              ]}
            />
          </Card>

          <Card title="Location">
            <div className="flex items-start gap-2 text-sm text-[var(--ha-ink)]">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ha-saffron)]" />
              <span>{fullAddress(property.address)}</span>
            </div>
            {Array.isArray(coords) && coords.length === 2 && (
              <a
                href={`https://www.google.com/maps?q=${coords[1]},${coords[0]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--ha-navy)] hover:underline"
              >
                {Number(coords[1]).toFixed(5)}, {Number(coords[0]).toFixed(5)} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {property.nearbyPlaces?.length > 0 && (
              <ul className="mt-3 grid gap-1 text-sm text-[var(--ha-ink-soft)] sm:grid-cols-2">
                {property.nearbyPlaces.map((n, i) => (
                  <li key={`${n.name}-${i}`}>
                    {n.name} <span className="text-[var(--ha-ink-faint)]">· {label(n.type)} · {n.distanceKm} km</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Amenities & rules">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ha-ink-faint)]">Amenities</p>
            <Chips items={(property.amenities || []).map((k) => amenityLabel[k] || label(k))} />
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ha-ink-faint)]">House rules</p>
            {property.houseRules?.length ? (
              <ul className="list-inside list-disc space-y-1 text-sm text-[var(--ha-ink-soft)]">
                {property.houseRules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--ha-ink-faint)]">None</p>
            )}
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ha-ink-faint)]">Cancellation policy</p>
            <p className="text-sm text-[var(--ha-ink-soft)]">
              {label(policy.type)}
              {policy.type && policy.type !== "non_refundable"
                ? ` · free until ${policy.freeCancelHours ?? "—"}h before check-in, then ${policy.refundPercentAfter ?? 0}% refund`
                : ""}
            </p>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Partner">
            {partner ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ha-ink)]">{partner.name || "Unnamed"}</p>
                    <p className="text-sm tabular-nums text-[var(--ha-ink-soft)]">{partner.phone}</p>
                    {partner.email && <p className="truncate text-sm text-[var(--ha-ink-soft)]">{partner.email}</p>}
                  </div>
                  {partner.status && <StatusBadge status={partner.status} />}
                </div>
                {partner.status && partner.status !== "approved" && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    The partner is not approved yet.
                  </p>
                )}
                <Link
                  to={`/admin/hotel/partners/${partner._id || property.partnerId}`}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--ha-navy)] hover:underline"
                >
                  View partner <ChevronRight className="h-4 w-4" />
                </Link>
              </>
            ) : (
              <p className="text-sm text-[var(--ha-ink-faint)]">Partner not found.</p>
            )}
          </Card>

          <LiveToggle property={property} onChanged={reload} />

          <Card title="At a glance">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-[var(--ha-ink-soft)]">Photos</span>
                <span className="font-semibold tabular-nums">{(property.images || []).length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-[var(--ha-ink-soft)]">Room types</span>
                <span className="font-semibold tabular-nums">{rooms.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-[var(--ha-ink-soft)]">Total inventory</span>
                <span className="font-semibold tabular-nums">{rooms.reduce((a, r) => a + (Number(r.totalInventory) || 0), 0)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-[var(--ha-ink-soft)]">Documents</span>
                <span className="font-semibold">{label(data?.documents?.verificationStatus || "pending")}</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <Card title={`Room types (${rooms.length})`} bodyClassName="p-0">
        <RoomTypes rooms={rooms} />
      </Card>

      <Documents propertyId={id} docs={data?.documents} fallbackRequired={fallbackRequired} onChanged={reload} />
    </div>
  );
}
