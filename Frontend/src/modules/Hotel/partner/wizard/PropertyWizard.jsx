import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, RotateCcw, Save } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH } from "../lib/constants";
import { store, useCatalogue } from "../lib/utils";
import { Button, Card, FullPageSpinner, InlineError, StatusChip, cx } from "../components/ui";
import { BasicsStep, LocationStep, PhotosStep, PoliciesStep, TypeStep } from "./steps";
import { RoomsStep } from "./RoomTypes";
import DocumentsStep, { documentsPayload } from "./DocumentsStep";
import ReviewStep from "./ReviewStep";
import { STEPS, emptyForm, hasErrors, payloadFor, propertyToForm, stepIndex, validateStep } from "./model";

const storageKey = (id) => `hotel_partner_wizard:${id || "new"}`;
const PROPERTY_STEPS = new Set(["type", "basics", "location", "photos", "policies"]);
// Fields whose change sends an approved property back to review (per the API contract).
const REVIEW_STEPS = new Set(["type", "basics", "location"]);

const sameAddress = (a = {}, b = {}) =>
  ["line1", "area", "city", "state", "pincode"].every((k) => String(a[k] || "").trim() === String(b[k] || "").trim());

/**
 * Drop review-sensitive fields that did not change, so re-saving an approved
 * property's step does not send it back to review for nothing.
 */
const withoutUnchanged = (body, p) => {
  if (!p || p.status !== "approved" || !body) return body;
  const out = { ...body };
  if (out.name !== undefined && out.name === p.name) delete out.name;
  if (out.propertyType !== undefined && out.propertyType === p.propertyType) delete out.propertyType;
  if (out.address && sameAddress(out.address, p.address)) delete out.address;
  const c = p.location?.coordinates;
  if (out.location && Array.isArray(c) && Number(c[0]) === out.location.lng && Number(c[1]) === out.location.lat) delete out.location;
  return out;
};

const docsFromServer =(documents) =>
  (documents?.documents || []).map((d) => ({ type: d.type, name: d.name || "", fileUrl: d.fileUrl }));

/**
 * One data-driven wizard for all six property types, for both new and existing
 * properties. A new property lives on this device until the basics step creates a
 * draft (POST); after that each step saves with PUT as the partner moves on. The
 * form and current step are also kept in localStorage, so leaving and coming back
 * resumes where the partner was.
 */
export default function PropertyWizard() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { partner } = usePartner();
  const { catalogue } = useCatalogue();

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState("");
  const [property, setProperty] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [docs, setDocs] = useState([]);
  const [docsMeta, setDocsMeta] = useState(null);
  const [form, setForm] = useState(() => (isNew ? store.get(storageKey())?.form || emptyForm(partner) : emptyForm(partner)));
  const [step, setStepState] = useState(() => {
    if (!isNew) return "basics";
    const saved = store.get(storageKey())?.step;
    return saved === "basics" ? "basics" : "type";
  });
  const [resumed, setResumed] = useState(() => isNew && Boolean(store.get(storageKey())?.form?.propertyType));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const direction = useRef(1);
  const top = useRef(null);

  const setStep = useCallback(
    (key) => {
      setStepState((prev) => {
        direction.current = stepIndex(key) >= stepIndex(prev) ? 1 : -1;
        return key;
      });
      setErrors({});
      if (!isNew) setSearch({ step: key }, { replace: true });
      setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    },
    [isNew, setSearch],
  );

  // ── load an existing property ──
  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    setLoadError("");
    try {
      const data = await partnerApi.get(`/partner/properties/${id}`);
      const p = data?.property || data;
      setProperty(p);
      setRoomTypes(data?.roomTypes || []);
      setDocsMeta(data?.documents || null);
      const local = store.get(storageKey(id));
      const useLocal = local?.form && local.base && local.base === p?.updatedAt;
      setForm(useLocal ? local.form : propertyToForm(p, partner));
      setDocs(useLocal && Array.isArray(local.docs) ? local.docs : docsFromServer(data?.documents));
      const wanted = search.get("step") || local?.step || (p?.status === "draft" ? "location" : "review");
      setStepState(STEPS.some((s) => s.key === wanted) ? wanted : "basics");
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
    // Loaded once per property; the step query is read on entry only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  // ── keep the wizard on this device ──
  useEffect(() => {
    if (loading || loadError) return;
    store.set(storageKey(id), { form, docs, step, base: property?.updatedAt || null });
  }, [form, docs, step, property?.updatedAt, id, loading, loadError]);

  const patch = useCallback((changes) => {
    setForm((f) => ({ ...f, ...changes }));
    setDirty(true);
    setErrors((e) => (Object.keys(e).length ? {} : e));
  }, []);
  const updateDocs = (next) => {
    setDocs(next);
    setDirty(true);
    setErrors({});
  };

  const requiredTypes = useMemo(() => {
    if (Array.isArray(docsMeta?.requiredTypes)) return docsMeta.requiredTypes;
    const base = catalogue?.requiredDocuments?.[form.propertyType] || [];
    return partner?.kyc?.gstNumber && !base.includes("gst_certificate") ? [...base, "gst_certificate"] : base;
  }, [docsMeta, catalogue, form.propertyType, partner]);

  const ctx = { roomTypes, docs, requiredTypes };

  /** Persist one step to the server. Returns "created" when a new draft was made. */
  const saveStep = async (key) => {
    if (PROPERTY_STEPS.has(key)) {
      if (isNew) {
        if (key !== "basics") return null;
        const data = await partnerApi.post("/partner/properties", payloadFor("basics", form));
        const created = data?.property || data;
        if (!created?._id) throw new Error("The draft could not be created. Please try again.");
        store.remove(storageKey());
        store.set(storageKey(created._id), { form, docs: [], step: "location", base: created.updatedAt || null });
        toast.success("Draft saved. You can finish it anytime.");
        navigate(`${BASE_PATH}/properties/${created._id}/edit?step=location`, { replace: true });
        return "created";
      }
      const data = await partnerApi.put(`/partner/properties/${id}`, withoutUnchanged(payloadFor(key, form), property));
      const updated = data?.property || data;
      if (updated?._id) setProperty(updated);
      setDirty(false);
      return null;
    }
    if (key === "documents" && !isNew) {
      const data = await partnerApi.put(`/partner/properties/${id}/documents`, documentsPayload(docs));
      if (data && typeof data === "object") setDocsMeta((m) => ({ ...(m || {}), ...data }));
      setDirty(false);
    }
    return null;
  };

  const next = async () => {
    const found = validateStep(step, form, ctx);
    if (hasErrors(found)) {
      setErrors(found);
      setTimeout(
        () => document.querySelector('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }),
        40,
      );
      return;
    }
    setSaving(true);
    try {
      const result = await saveStep(step);
      if (result === "created") return;
      const i = stepIndex(step);
      if (i < STEPS.length - 1) setStep(STEPS[i + 1].key);
    } catch (e) {
      setErrors({ _server: e.message });
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    const i = stepIndex(step);
    if (i > 0) setStep(STEPS[i - 1].key);
  };

  const jump = async (key) => {
    if (key === step) return;
    if (isNew && stepIndex(key) > stepIndex("basics")) return;
    if (isNew && key === "basics" && !form.propertyType) return;
    if (!isNew && dirty && (PROPERTY_STEPS.has(step) || step === "documents")) {
      setSaving(true);
      try {
        await saveStep(step);
      } catch (e) {
        setErrors({ _server: e.message });
        toast.error(e.message);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    setStep(key);
  };

  const saveAndExit = async () => {
    if (isNew) {
      toast.success("Saved on this device. Pick up where you left off anytime.");
      navigate(`${BASE_PATH}/properties`);
      return;
    }
    if (dirty && (PROPERTY_STEPS.has(step) || step === "documents")) {
      setSaving(true);
      try {
        await saveStep(step);
        toast.success("Saved");
      } catch (e) {
        setErrors({ _server: e.message });
        toast.error(e.message);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    navigate(`${BASE_PATH}/properties/${id}`);
  };

  const startOver = () => {
    store.remove(storageKey());
    setForm(emptyForm(partner));
    setStepState("type");
    setResumed(false);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const data = await partnerApi.post(`/partner/properties/${id}/submit`);
      const updated = data?.property || data;
      if (updated?._id) setProperty(updated);
      store.remove(storageKey(id));
      toast.success("Submitted! We'll review it within 1–2 working days.");
      navigate(`${BASE_PATH}/properties/${id}`, { replace: true });
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!catalogue || loading) return <FullPageSpinner />;
  if (loadError) {
    return (
      <div className="space-y-4">
        <Link to={`${BASE_PATH}/properties`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Properties
        </Link>
        <InlineError message={loadError} onRetry={load} />
      </div>
    );
  }

  const current = STEPS[stepIndex(step)];
  const idx = stepIndex(step);
  const activeRooms = roomTypes.filter((r) => r.isActive !== false);
  const typeLocked = !isNew && activeRooms.length > 0;
  const showApprovedWarning = property?.status === "approved" && REVIEW_STEPS.has(step);

  const content = {
    type: <TypeStep form={form} patch={patch} errors={errors} catalogue={catalogue} locked={typeLocked} />,
    basics: <BasicsStep form={form} patch={patch} errors={errors} catalogue={catalogue} />,
    location: <LocationStep form={form} patch={patch} errors={errors} />,
    photos: <PhotosStep form={form} patch={patch} errors={errors} />,
    policies: <PoliciesStep form={form} patch={patch} errors={errors} catalogue={catalogue} />,
    rooms: (
      <RoomsStep
        propertyId={id}
        propertyType={form.propertyType}
        roomTypes={roomTypes}
        setRoomTypes={setRoomTypes}
        catalogue={catalogue}
        errors={errors}
      />
    ),
    documents: (
      <DocumentsStep
        docs={docs}
        setDocs={updateDocs}
        requiredTypes={requiredTypes}
        errors={errors}
        verification={docsMeta ? { status: docsMeta.verificationStatus, remark: docsMeta.adminRemark } : null}
      />
    ),
    review: (
      <ReviewStep
        form={form}
        property={property}
        roomTypes={roomTypes}
        docs={docs}
        requiredTypes={requiredTypes}
        partner={partner}
        catalogue={catalogue}
        goTo={jump}
        onSubmit={submit}
        submitting={submitting}
        submitError={submitError}
      />
    ),
  }[step];

  return (
    <div ref={top} className="scroll-mt-20">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={isNew ? `${BASE_PATH}/properties` : `${BASE_PATH}/properties/${id}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" /> {isNew ? "Properties" : "Property"}
          </Link>
          <h1 className="truncate text-2xl font-bold tracking-tight text-[#071A47]">
            {isNew ? "Add a property" : form.name || "Edit property"}
          </h1>
        </div>
        {property?.status && <StatusChip status={property.status} />}
      </div>

      {resumed && isNew && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-[#0B2A6F]">
          <span>We restored the property you started earlier.</span>
          <button type="button" onClick={startOver} className="inline-flex items-center gap-1 font-semibold hover:underline">
            <RotateCcw className="h-4 w-4" /> Start over
          </button>
        </div>
      )}

      {/* stepper */}
      <nav aria-label="Wizard steps" className="mb-5">
        <div className="flex items-center justify-between text-xs text-slate-500 md:hidden">
          <span>
            Step {idx + 1} of {STEPS.length}
          </span>
          <span className="font-semibold text-slate-800">{current.label}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 md:hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#FF7A00] to-[#E85D04]"
            animate={{ width: `${((idx + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: 0.35 }}
          />
        </div>
        <ol className="hidden items-center gap-1 md:flex">
          {STEPS.map((s, i) => {
            const reachable = !isNew || i <= 1;
            const done = i < idx;
            const active = i === idx;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-1">
                <button
                  type="button"
                  onClick={() => reachable && jump(s.key)}
                  disabled={!reachable || saving}
                  aria-current={active ? "step" : undefined}
                  className={cx(
                    "flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-xs font-medium transition",
                    active ? "bg-[#0B2A6F] text-white" : done ? "text-[#0B2A6F] hover:bg-blue-50" : "text-slate-500 hover:bg-slate-100",
                    !reachable && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <span
                    className={cx(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      active ? "bg-[#FF7A00] text-white" : done ? "bg-[#0B2A6F] text-white" : "bg-slate-200 text-slate-600",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="truncate">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <span className={cx("h-px flex-1", i < idx ? "bg-[#0B2A6F]" : "bg-slate-200")} />}
              </li>
            );
          })}
        </ol>
      </nav>

      {showApprovedWarning && (
        <div className="mb-4 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>
            This property is approved. Changing its name, type, address or location sends it back to KSG for review, and it
            is hidden from guests until approved again.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 md:px-6">
          <h2 className="text-lg font-semibold text-slate-900">{current.title}</h2>
        </div>
        <div className="relative px-5 py-5 md:px-6 md:py-6">
          <AnimatePresence mode="wait" initial={false} custom={direction.current}>
            <motion.div
              key={step}
              custom={direction.current}
              initial={{ opacity: 0, x: 24 * direction.current }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * direction.current }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </div>
      </Card>

      {errors._server && (
        <div className="mt-4">
          <InlineError message={errors._server} />
        </div>
      )}

      {/* actions */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-2xl md:border md:shadow-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={back} disabled={idx === 0 || saving} icon={ArrowLeft} className="px-3">
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={saveAndExit} disabled={saving} icon={Save}>
            <span className="hidden sm:inline">Save &amp; exit</span>
            <span className="sm:hidden">Exit</span>
          </Button>
          {step !== "review" && (
            <Button onClick={next} loading={saving}>
              {isNew && step === "basics" ? "Save draft & continue" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
