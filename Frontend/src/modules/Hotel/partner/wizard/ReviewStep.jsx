import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Clock3, MapPin, PencilLine, Send } from "lucide-react";
import {
  BASE_PATH,
  CANCELLATION_LABELS,
  DOCUMENT_LABELS,
  SUITABILITY_LABELS,
  labelOf,
  typeMeta,
} from "../lib/constants";
import { Button, Card, InlineError, cx } from "../components/ui";
import { MIN_PHOTOS } from "./model";

function Row({ ok, label, detail, onFix, fixLabel = "Fix", to }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {ok ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[#16A34A]" />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cx("text-sm", ok ? "text-slate-700" : "font-medium text-slate-900")}>{label}</p>
        {detail && <p className="text-xs text-slate-500">{detail}</p>}
      </div>
      {!ok &&
        (to ? (
          <Link to={to} className="text-sm font-semibold text-[#E85D04] hover:underline">
            {fixLabel}
          </Link>
        ) : (
          onFix && (
            <button type="button" onClick={onFix} className="text-sm font-semibold text-[#E85D04] hover:underline">
              {fixLabel}
            </button>
          )
        ))}
    </li>
  );
}

function Section({ title, onEdit, children }) {
  return (
    <div className="border-t border-slate-100 py-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B2A6F] hover:underline"
        >
          <PencilLine className="h-3.5 w-3.5" /> Edit
        </button>
      </div>
      {children}
    </div>
  );
}

export default function ReviewStep({
  form,
  property,
  roomTypes,
  docs,
  requiredTypes,
  partner,
  catalogue,
  goTo,
  onSubmit,
  submitting,
  submitError,
}) {
  const active = roomTypes.filter((r) => r.isActive !== false);
  const uploaded = new Set(docs.filter((d) => d.fileUrl).map((d) => d.type));
  const missingDocs = (requiredTypes || []).filter((t) => !uploaded.has(t));
  const kycOk = Boolean(partner?.kyc?.ownerName && partner?.kyc?.panNumber);
  const meta = typeMeta(form.propertyType);
  const amenityLabel = (key) => (catalogue.amenities || []).find((a) => a.key === key)?.label || key;

  const checks = [
    { ok: Boolean(form.name && form.description && form.shortDescription), label: "Name and description", step: "basics" },
    { ok: Boolean(form.location && form.address?.city), label: "Address and map pin", step: "location" },
    {
      ok: form.photos.length >= MIN_PHOTOS,
      label: `At least ${MIN_PHOTOS} photos including a cover`,
      detail: `${form.photos.length} added`,
      step: "photos",
    },
    { ok: active.length > 0, label: "At least one room type", detail: `${active.length} added`, step: "rooms" },
    {
      ok: missingDocs.length === 0,
      label: "Required documents",
      detail: missingDocs.length ? `Missing: ${missingDocs.map((t) => labelOf(DOCUMENT_LABELS, t)).join(", ")}` : undefined,
      step: "documents",
    },
  ];
  const ready = checks.every((c) => c.ok) && kycOk;
  const status = property?.status;
  const canSubmit = ["draft", "rejected"].includes(status);

  return (
    <div className="space-y-5">
      {status === "rejected" && property?.rejectionReason && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-semibold">KSG asked for changes</p>
          <p className="mt-0.5">{property.rejectionReason}</p>
        </div>
      )}

      <Card className="p-4 md:p-5">
        <h3 className="text-sm font-semibold text-slate-900">Checklist</h3>
        <ul className="mt-1 divide-y divide-slate-100">
          {checks.map((c) => (
            <Row key={c.label} ok={c.ok} label={c.label} detail={c.detail} onFix={() => goTo(c.step)} />
          ))}
          <Row
            ok={kycOk}
            label="Your KYC (owner name and PAN)"
            detail={kycOk ? undefined : "Needed once for your account"}
            to={`${BASE_PATH}/profile`}
            fixLabel="Open profile"
          />
        </ul>
      </Card>

      <Card className="overflow-hidden">
        {form.coverImage || form.photos[0] ? (
          <div className="relative aspect-[21/9] bg-slate-100">
            <img src={form.coverImage || form.photos[0]} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent" />
            <div className="absolute bottom-3 left-4 right-4 text-white">
              <p className="text-xs font-medium opacity-90">{meta.label}</p>
              <p className="text-lg font-bold">{form.name}</p>
            </div>
          </div>
        ) : null}
        <div className="p-4 md:p-5">
          <Section title="Basics" onEdit={() => goTo("basics")}>
            {!(form.coverImage || form.photos[0]) && <p className="font-semibold text-slate-900">{form.name}</p>}
            <p className="text-sm text-slate-600">{form.shortDescription}</p>
            <p className="mt-1 text-xs text-slate-500">{labelOf(SUITABILITY_LABELS, form.suitability)}</p>
          </Section>
          <Section title="Location" onEdit={() => goTo("location")}>
            <p className="flex items-start gap-1.5 text-sm text-slate-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              {[form.address.line1, form.address.area, form.address.city, form.address.state, form.address.pincode]
                .filter(Boolean)
                .join(", ") || "Not set"}
            </p>
          </Section>
          <Section title="Photos" onEdit={() => goTo("photos")}>
            <div className="flex gap-2 overflow-x-auto">
              {form.photos.slice(0, 8).map((u) => (
                <img key={u} src={u} alt="" className="h-16 w-20 shrink-0 rounded-lg object-cover" />
              ))}
            </div>
          </Section>
          <Section title="Amenities & policies" onEdit={() => goTo("policies")}>
            <p className="text-sm text-slate-700">
              {form.amenities.length ? form.amenities.map(amenityLabel).join(" · ") : "No amenities selected"}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock3 className="h-3.5 w-3.5" /> Check-in {form.checkInTime} · Check-out {form.checkOutTime} ·{" "}
              {labelOf(CANCELLATION_LABELS, form.cancellationPolicy.type)} cancellation
            </p>
          </Section>
          <Section title="Rooms" onEdit={() => goTo("rooms")}>
            <p className="text-sm text-slate-700">
              {active.length ? active.map((r) => r.name).join(", ") : "No room types yet"}
            </p>
          </Section>
          <Section title="Documents" onEdit={() => goTo("documents")}>
            <p className="text-sm text-slate-700">
              {[...uploaded].map((t) => labelOf(DOCUMENT_LABELS, t)).join(", ") || "None uploaded"}
            </p>
          </Section>
        </div>
      </Card>

      <InlineError message={submitError} />

      {canSubmit ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Button size="lg" className="w-full" icon={Send} onClick={onSubmit} loading={submitting} disabled={!ready}>
            {status === "rejected" ? "Resubmit for review" : "Submit for review"}
          </Button>
          <p className="mt-2 text-center text-xs text-slate-500">
            {ready
              ? "KSG reviews new properties within 1–2 working days."
              : "Complete the checklist above to submit."}
          </p>
        </motion.div>
      ) : (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">
          {status === "pending"
            ? "This property is under review. Your changes are saved."
            : status === "approved"
              ? "This property is approved. Your changes are saved."
              : "Your changes are saved."}
        </p>
      )}
    </div>
  );
}
