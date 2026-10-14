import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  MapPin,
  PencilLine,
  Phone,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import {
  BASE_PATH,
  CANCELLATION_LABELS,
  DOCUMENT_LABELS,
  SUITABILITY_LABELS,
  TYPE_DETAIL_FIELDS,
  labelOf,
  typeMeta,
} from "../lib/constants";
import { formatDate, money, useCatalogue } from "../lib/utils";
import { Button, Card, InlineError, LinkButton, Skeleton, StatusChip, cx, useConfirm } from "../components/ui";
import { RoomTypeCard } from "../wizard/RoomTypes";
import { LiveToggle } from "./Properties";

function Section({ title, step, id, children, action }) {
  return (
    <Card className="p-5 md:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {action ||
          (step && (
            <Link
              to={`${BASE_PATH}/properties/${id}/edit?step=${step}`}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-[#0B2A6F] hover:bg-blue-50"
            >
              <PencilLine className="h-4 w-4" /> Edit
            </Link>
          ))}
      </div>
      {children}
    </Card>
  );
}

const STATUS_NOTE = {
  draft: { icon: PencilLine, tone: "border-slate-200 bg-white text-slate-700", text: "Finish setting up and submit it for review." },
  pending: { icon: Clock3, tone: "border-amber-200 bg-amber-50 text-amber-900", text: "KSG is reviewing this property, usually within 1–2 working days." },
  approved: { icon: CheckCircle2, tone: "border-green-200 bg-green-50 text-green-800", text: "Approved. Turn on Live to show it to guests." },
  rejected: { icon: XCircle, tone: "border-rose-200 bg-rose-50 text-rose-800", text: "KSG asked for changes before approval." },
  suspended: { icon: XCircle, tone: "border-zinc-300 bg-zinc-50 text-zinc-800", text: "Suspended by KSG. Contact support for details." },
};

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isApproved } = usePartner();
  const { catalogue } = useCatalogue();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    setError("");
    partnerApi
      .get(`/partner/properties/${id}`)
      .then((d) => setData({ property: d?.property || d, roomTypes: d?.roomTypes || [], documents: d?.documents || null }))
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await partnerApi.post(`/partner/properties/${id}/submit`);
      const updated = res?.property || res;
      setData((d) => ({ ...d, property: updated?._id ? updated : { ...d.property, status: "pending", rejectionReason: "" } }));
      toast.success("Submitted for review");
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Delete this property?",
      message: `${data.property.name} will be removed from KSG Stays. This cannot be undone from the portal. Properties with upcoming bookings cannot be deleted.`,
      confirmLabel: "Delete property",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await partnerApi.del(`/partner/properties/${id}`);
      toast.success("Property deleted");
      navigate(`${BASE_PATH}/properties`, { replace: true });
    } catch (e) {
      toast.error(e.message);
      setDeleting(false);
    }
  };

  if (error && !data) {
    return (
      <div className="space-y-4">
        <Link to={`${BASE_PATH}/properties`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Properties
        </Link>
        <InlineError message={error} onRetry={load} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  const p = data.property || {};
  const meta = typeMeta(p.propertyType);
  const TypeIcon = meta.icon;
  const note = STATUS_NOTE[p.status] || STATUS_NOTE.draft;
  const NoteIcon = note.icon;
  const rooms = data.roomTypes.filter((r) => r.isActive !== false);
  const docs = data.documents?.documents || [];
  const gallery = [p.coverImage, ...(p.images || []).filter((u) => u !== p.coverImage)].filter(Boolean);
  const details = (TYPE_DETAIL_FIELDS[p.propertyType] || [])
    .map((f) => {
      const v = p.typeDetails?.[f.key];
      if (v === undefined || v === "" || v === null) return null;
      const shown =
        f.kind === "stars" ? `${v} star` : f.kind === "toggle" ? (v ? "Yes" : "No") : f.options?.find(([k]) => k === v)?.[1] || v;
      return [f.label, shown];
    })
    .filter(Boolean);
  const amenityLabel = (key) => (catalogue?.amenities || []).find((a) => a.key === key)?.label || key;
  const canSubmit = ["draft", "rejected"].includes(p.status);

  return (
    <div>
      <Link to={`${BASE_PATH}/properties`} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Properties
      </Link>

      {/* hero */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          <div className="grid gap-1 bg-slate-100 md:grid-cols-[2fr_1fr]">
            <div className="aspect-[16/9] md:aspect-auto md:h-72">
              {gallery[0] && <img src={gallery[0]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="hidden grid-rows-2 gap-1 md:grid">
              {[gallery[1], gallery[2]].map((u, i) =>
                u ? <img key={i} src={u} alt="" className="h-full max-h-[142px] w-full object-cover" /> : <div key={i} className="bg-slate-100" />,
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between md:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={p.status} />
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-[#0B2A6F]">
                  <TypeIcon className="h-3.5 w-3.5" /> {meta.label}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#071A47]">{p.name}</h1>
              <p className="mt-1 flex items-start gap-1 text-sm text-slate-500">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {p.address?.fullAddress || [p.address?.line1, p.address?.area, p.address?.city].filter(Boolean).join(", ") || "No address yet"}
              </p>
              {p.startingPrice > 0 && (
                <p className="mt-2 text-sm text-slate-600">
                  From <span className="font-semibold text-slate-900">{money(p.startingPrice)}</span> / night
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 md:flex-col md:items-end">
              <LiveToggle
                property={p}
                partnerApproved={isApproved}
                onChange={(next) => setData((d) => ({ ...d, property: next }))}
              />
              {p.status === "approved" && (
                <LinkButton to={`${BASE_PATH}/inventory?propertyId=${p._id}`} variant="secondary" size="sm" icon={CalendarRange}>
                  Inventory calendar
                </LinkButton>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* status */}
      <div className={cx("mt-4 flex flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center", note.tone)}>
        <NoteIcon className="hidden h-6 w-6 shrink-0 sm:block" />
        <div className="min-w-0 flex-1 text-sm">
          <p>{note.text}</p>
          {p.status === "rejected" && p.rejectionReason && <p className="mt-1 font-semibold">Reason: {p.rejectionReason}</p>}
        </div>
        {canSubmit && (
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`${BASE_PATH}/properties/${p._id}/edit?step=review`} variant="secondary" size="sm">
              Review checklist
            </LinkButton>
            <Button size="sm" icon={Send} onClick={submit} loading={submitting}>
              {p.status === "rejected" ? "Resubmit" : "Submit for review"}
            </Button>
          </div>
        )}
      </div>
      {submitError && (
        <div className="mt-3">
          <InlineError message={submitError} />
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Section title="About" step="basics" id={p._id}>
          <p className="text-sm font-medium text-slate-800">{p.shortDescription}</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{p.description || "No description yet."}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-medium text-slate-800">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-slate-500">Best for</dt>
              <dd className="font-medium text-slate-800">{labelOf(SUITABILITY_LABELS, p.suitability)}</dd>
            </div>
            {p.contactNumber && (
              <div>
                <dt className="text-xs text-slate-500">Guest contact</dt>
                <dd className="flex items-center gap-1 font-medium text-slate-800">
                  <Phone className="h-3.5 w-3.5" /> {p.contactNumber}
                </dd>
              </div>
            )}
          </dl>
        </Section>

        <Section title="Location" step="location" id={p._id}>
          <p className="text-sm text-slate-700">
            {[p.address?.line1, p.address?.area, p.address?.city, p.address?.state, p.address?.pincode].filter(Boolean).join(", ") ||
              "Not set"}
          </p>
          {Array.isArray(p.location?.coordinates) && (p.location.coordinates[0] || p.location.coordinates[1]) ? (
            <a
              href={`https://www.google.com/maps?q=${p.location.coordinates[1]},${p.location.coordinates[0]}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#0B2A6F] hover:underline"
            >
              View pin on Google Maps <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {p.nearbyPlaces?.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-600">
              {p.nearbyPlaces.map((n, i) => (
                <li key={i}>
                  {n.name} · {n.distanceKm} km
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Photos (${gallery.length})`} step="photos" id={p._id}>
          {gallery.length === 0 ? (
            <p className="text-sm text-slate-500">No photos yet.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {gallery.slice(0, 8).map((u) => (
                <img key={u} src={u} alt="" className="aspect-square w-full rounded-lg object-cover" />
              ))}
            </div>
          )}
        </Section>

        <Section title="Amenities & policies" step="policies" id={p._id}>
          <div className="flex flex-wrap gap-1.5">
            {(p.amenities || []).length === 0 && <p className="text-sm text-slate-500">No amenities selected.</p>}
            {(p.amenities || []).map((a) => (
              <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {amenityLabel(a)}
              </span>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Check-in / out</dt>
              <dd className="font-medium text-slate-800">
                {p.checkInTime || "12:00"} / {p.checkOutTime || "11:00"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Cancellation</dt>
              <dd className="font-medium text-slate-800">
                {labelOf(CANCELLATION_LABELS, p.cancellationPolicy?.type || "moderate")}
                {p.cancellationPolicy?.freeCancelHours ? ` · free until ${p.cancellationPolicy.freeCancelHours}h before` : ""}
              </dd>
            </div>
          </dl>
          {p.houseRules?.length > 0 && (
            <ul className="mt-3 list-inside list-disc space-y-0.5 text-sm text-slate-600">
              {p.houseRules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section title={`Room types (${rooms.length})`} step="rooms" id={p._id}>
          {rooms.length === 0 ? (
            <p className="text-sm text-slate-500">No room types yet. Add at least one to submit.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {rooms.map((r) => (
                <RoomTypeCard key={r._id} room={r} />
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section title="Documents" step="documents" id={p._id}>
          {data.documents?.verificationStatus && (
            <p className="mb-3 text-sm">
              Verification:{" "}
              <span
                className={cx(
                  "font-semibold",
                  data.documents.verificationStatus === "verified"
                    ? "text-green-700"
                    : data.documents.verificationStatus === "rejected"
                      ? "text-rose-700"
                      : "text-amber-700",
                )}
              >
                {data.documents.verificationStatus}
              </span>
              {data.documents.adminRemark ? ` · ${data.documents.adminRemark}` : ""}
            </p>
          )}
          {docs.length === 0 ? (
            <p className="text-sm text-slate-500">No documents uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs.map((d, i) => (
                <li key={`${d.type}-${i}`} className="flex items-center gap-3 py-2.5">
                  <FileText className="h-5 w-5 shrink-0 text-[#0B2A6F]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{d.name || labelOf(DOCUMENT_LABELS, d.type)}</p>
                    {d.uploadedAt && <p className="text-xs text-slate-500">Uploaded {formatDate(d.uploadedAt)}</p>}
                  </div>
                  {d.isRequired && <span className="text-[11px] font-semibold uppercase text-slate-400">Required</span>}
                </li>
              ))}
            </ul>
          )}
          {(data.documents?.requiredTypes || []).some((t) => !docs.some((d) => d.type === t && d.fileUrl)) && (
            <p className="mt-3 text-sm text-amber-700">
              Missing:{" "}
              {data.documents.requiredTypes
                .filter((t) => !docs.some((d) => d.type === t && d.fileUrl))
                .map((t) => labelOf(DOCUMENT_LABELS, t))
                .join(", ")}
            </p>
          )}
        </Section>
      </div>

      <div className="mt-8 flex justify-end">
        <Button variant="dangerGhost" icon={Trash2} onClick={remove} loading={deleting}>
          Delete property
        </Button>
      </div>
      {confirmDialog}
    </div>
  );
}
