import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Banknote, CheckCircle2, Crosshair, FileCheck2, Loader2, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH } from "../lib/constants";
import { compact, formatDate, last4Of, maskLast4, onlyDigits } from "../lib/utils";
import { Button, Card, InlineError, PageHeader, SectionTitle, StatusChip, TextField, cx } from "../components/ui";
import { FileUpload } from "../components/uploads";
import StatusBanner from "../components/StatusBanner";

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const GST_RE = /^\d{2}[A-Z0-9]{13}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fromPartner = (p = {}) => {
  const coords = p.address?.location?.coordinates;
  return {
    name: p.name || "",
    email: p.email || "",
    ownerName: p.kyc?.ownerName || "",
    aadhaarLast4: last4Of(p.kyc?.aadhaarNumberMasked),
    aadhaarFront: p.kyc?.aadhaarFront || "",
    aadhaarBack: p.kyc?.aadhaarBack || "",
    panNumber: p.kyc?.panNumber || "",
    panImage: p.kyc?.panImage || "",
    gstNumber: p.kyc?.gstNumber || "",
    gstCertificate: p.kyc?.gstCertificate || "",
    accountHolder: p.bank?.accountHolder || "",
    accountLast4: last4Of(p.bank?.accountNumberMasked),
    ifsc: p.bank?.ifsc || "",
    bankName: p.bank?.bankName || "",
    line: p.address?.line || "",
    city: p.address?.city || "",
    state: p.address?.state || "",
    pincode: p.address?.pincode || "",
    lat: Array.isArray(coords) ? coords[1] : undefined,
    lng: Array.isArray(coords) ? coords[0] : undefined,
    acceptTerms: Boolean(p.termsAcceptedAt),
  };
};

/** Errors for a full submission; `draft` only checks formats of what was typed. */
const validate = (f, { draft }) => {
  const e = {};
  const need = (key, msg) => {
    if (!draft && !String(f[key] || "").trim()) e[key] = msg;
  };
  need("name", "Enter your name");
  need("ownerName", "Enter the owner's name as on PAN");
  need("panNumber", "Enter your PAN");
  need("panImage", "Upload a photo of your PAN card");
  need("aadhaarFront", "Upload the front of your Aadhaar");
  need("aadhaarBack", "Upload the back of your Aadhaar");
  need("accountHolder", "Enter the account holder's name");
  need("ifsc", "Enter the IFSC");
  need("city", "Enter your city");
  if (f.name && f.name.trim().length < 2) e.name = "Name is too short";
  if (f.email && !EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email";
  if (f.panNumber && !PAN_RE.test(f.panNumber)) e.panNumber = "PAN looks like ABCDE1234F";
  if (f.gstNumber && !GST_RE.test(f.gstNumber)) e.gstNumber = "GSTIN is 15 characters, e.g. 22ABCDE1234F1Z5";
  if (f.gstNumber && !f.gstCertificate && !draft) e.gstCertificate = "Upload your GST certificate";
  if (f.ifsc && !IFSC_RE.test(f.ifsc)) e.ifsc = "IFSC looks like HDFC0001234";
  if (f.pincode && !/^\d{6}$/.test(f.pincode)) e.pincode = "Pincode is 6 digits";
  if (!draft && f.aadhaarLast4.length !== 4) e.aadhaarLast4 = "Enter the last 4 digits";
  if (!draft && f.accountLast4.length !== 4) e.accountLast4 = "Enter the last 4 digits";
  if (!draft && !f.acceptTerms) e.acceptTerms = "Accept the partner terms to continue";
  return e;
};

function MaskedLast4({ label, value, onChange, error, hint, required }) {
  return (
    <TextField
      label={label}
      required={required}
      hint={hint}
      error={error}
      value={value}
      onChange={(e) => onChange(onlyDigits(e.target.value, 4))}
      inputMode="numeric"
      maxLength={4}
      autoComplete="off"
      placeholder="1234"
      prefix={<span className="font-mono tracking-wider text-slate-400">XXXX XXXX</span>}
      inputClassName="pl-[6.5rem]! font-mono tracking-[0.3em]"
    />
  );
}

export default function Profile() {
  const navigate = useNavigate();
  const { partner, setPartner, loading, profileComplete } = usePartner();
  const [form, setForm] = useState(() => fromPartner(partner || {}));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState("");
  const [serverError, setServerError] = useState("");
  const [locating, setLocating] = useState(false);
  const [touched, setTouched] = useState(false);

  // Fill from the fresh profile once it arrives (unless the user already started typing).
  useEffect(() => {
    if (partner && !touched) setForm(fromPartner(partner));
  }, [partner, touched]);

  const set = (key) => (value) => {
    setTouched(true);
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };
  const input = (key, transform = (v) => v) => ({
    value: form[key],
    onChange: (e) => set(key)(transform(e.target.value)),
    error: errors[key],
  });

  const termsAlready = Boolean(partner?.termsAcceptedAt);

  const done = useMemo(
    () => ({
      basic: Boolean(form.name),
      kyc: Boolean(form.ownerName && form.panNumber && form.panImage && form.aadhaarFront && form.aadhaarBack),
      bank: Boolean(form.accountHolder && form.accountLast4.length === 4 && form.ifsc),
      address: Boolean(form.city),
      terms: form.acceptTerms,
    }),
    [form],
  );

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("lat")(Number(pos.coords.latitude.toFixed(6)));
        set("lng")(Number(pos.coords.longitude.toFixed(6)));
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Could not read your location. Allow location access and try again.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const save = async (draft) => {
    const found = validate(form, { draft });
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setServerError("Please fix the highlighted fields.");
      setTimeout(() => document.querySelector('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      return;
    }
    setServerError("");
    setSaving(draft ? "draft" : "submit");
    const f = form;
    const body = compact({
      name: f.name,
      email: f.email.toLowerCase(),
      kyc: {
        ownerName: f.ownerName,
        aadhaarNumberMasked: f.aadhaarLast4.length === 4 ? maskLast4(f.aadhaarLast4) : "",
        aadhaarFront: f.aadhaarFront,
        aadhaarBack: f.aadhaarBack,
        panNumber: f.panNumber,
        panImage: f.panImage,
        gstNumber: f.gstNumber,
        gstCertificate: f.gstCertificate,
      },
      bank: {
        accountHolder: f.accountHolder,
        accountNumberMasked: f.accountLast4.length === 4 ? maskLast4(f.accountLast4) : "",
        ifsc: f.ifsc,
        bankName: f.bankName,
      },
      address: {
        line: f.line,
        city: f.city,
        state: f.state,
        pincode: f.pincode,
        ...(Number.isFinite(f.lat) && Number.isFinite(f.lng) ? { lat: f.lat, lng: f.lng } : {}),
      },
      acceptTerms: f.acceptTerms && !termsAlready ? true : undefined,
    });
    try {
      const data = await partnerApi.put("/partner/me", body);
      const fresh = data?.partner || data;
      if (fresh) setPartner(fresh);
      setTouched(false);
      if (draft) {
        toast.success("Saved");
      } else {
        toast.success(partner?.status === "approved" ? "Profile updated" : "Submitted for review");
        navigate(BASE_PATH);
      }
    } catch (e) {
      setServerError(e.message);
      toast.error(e.message);
    } finally {
      setSaving("");
    }
  };

  if (loading && !partner) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your profile
      </div>
    );
  }

  const sections = [
    { key: "basic", label: "Your details", icon: UserRound },
    { key: "kyc", label: "KYC", icon: ShieldCheck },
    { key: "bank", label: "Bank", icon: Banknote },
    { key: "address", label: "Address", icon: MapPin },
    { key: "terms", label: "Terms", icon: FileCheck2 },
  ];

  return (
    <div>
      <PageHeader
        title={profileComplete ? "Profile" : "Set up your partner account"}
        subtitle="We verify every partner before their properties go live."
        action={partner && <StatusChip status={partner.status} kind="partner" />}
      />
      <div className="mb-6">
        <StatusBanner partner={partner} incomplete={!profileComplete} showAction={false} />
      </div>

      {/* progress strip */}
      <ol className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label="Profile sections">
        {sections.map(({ key, label, icon: Icon }) => (
          <li key={key}>
            <a
              href={`#sec-${key}`}
              className={cx(
                "flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition",
                done[key] ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {done[key] ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              {label}
            </a>
          </li>
        ))}
      </ol>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        className="space-y-5"
      >
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-5 md:p-6" id="sec-basic">
            <SectionTitle title="Your details" subtitle={`Signed in as +91 ${partner?.phone || ""}`} />
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Full name" required autoComplete="name" {...input("name")} />
              <TextField label="Email" optional type="email" autoComplete="email" {...input("email")} />
            </div>
          </Card>
        </motion.div>

        <Card className="p-5 md:p-6" id="sec-kyc">
          <SectionTitle
            title="KYC"
            subtitle="Documents are stored privately and only seen by the KSG verification team."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Owner name (as on PAN)"
              required
              {...input("ownerName")}
              className="md:col-span-2"
            />
            <TextField
              label="PAN number"
              required
              placeholder="ABCDE1234F"
              maxLength={10}
              autoCapitalize="characters"
              inputClassName="uppercase tracking-wider"
              {...input("panNumber", (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
            />
            <FileUpload
              label="PAN card photo"
              required
              folder="pan"
              value={form.panImage}
              onChange={set("panImage")}
              error={errors.panImage}
            />
            <MaskedLast4
              label="Aadhaar number (last 4 digits)"
              required
              hint="For your privacy we only keep the last 4 digits."
              value={form.aadhaarLast4}
              onChange={set("aadhaarLast4")}
              error={errors.aadhaarLast4}
            />
            <div className="hidden md:block" />
            <FileUpload
              label="Aadhaar front"
              required
              folder="aadhaar"
              value={form.aadhaarFront}
              onChange={set("aadhaarFront")}
              error={errors.aadhaarFront}
            />
            <FileUpload
              label="Aadhaar back"
              required
              folder="aadhaar"
              value={form.aadhaarBack}
              onChange={set("aadhaarBack")}
              error={errors.aadhaarBack}
            />
            <TextField
              label="GSTIN"
              optional
              placeholder="22ABCDE1234F1Z5"
              maxLength={15}
              inputClassName="uppercase tracking-wider"
              hint="Only if your business is GST registered."
              {...input("gstNumber", (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))}
            />
            <FileUpload
              label="GST certificate"
              required={Boolean(form.gstNumber)}
              optional={!form.gstNumber}
              folder="gst"
              value={form.gstCertificate}
              onChange={set("gstCertificate")}
              error={errors.gstCertificate}
            />
          </div>
        </Card>

        <Card className="p-5 md:p-6" id="sec-bank">
          <SectionTitle title="Bank account" subtitle="Where we send your payouts." />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Account holder name" required {...input("accountHolder")} />
            <MaskedLast4
              label="Account number (last 4 digits)"
              required
              hint="We never store your full account number here."
              value={form.accountLast4}
              onChange={set("accountLast4")}
              error={errors.accountLast4}
            />
            <TextField
              label="IFSC"
              required
              placeholder="HDFC0001234"
              maxLength={11}
              inputClassName="uppercase tracking-wider"
              {...input("ifsc", (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))}
            />
            <TextField label="Bank name" optional {...input("bankName")} />
          </div>
        </Card>

        <Card className="p-5 md:p-6" id="sec-address">
          <SectionTitle title="Your address" subtitle="Your business or residential address for verification." />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Address" optional className="md:col-span-2" autoComplete="street-address" {...input("line")} />
            <TextField label="City" required autoComplete="address-level2" {...input("city")} />
            <TextField label="State" optional autoComplete="address-level1" {...input("state")} />
            <TextField
              label="Pincode"
              optional
              inputMode="numeric"
              maxLength={6}
              autoComplete="postal-code"
              {...input("pincode", (v) => onlyDigits(v, 6))}
            />
            <div className="flex items-end">
              <Button variant="secondary" onClick={useMyLocation} loading={locating} icon={Crosshair} className="w-full md:w-auto">
                {Number.isFinite(form.lat) ? `Pinned ${form.lat}, ${form.lng}` : "Use my location"}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-5 md:p-6" id="sec-terms">
          <SectionTitle title="Partner terms" />
          {termsAlready ? (
            <p className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Accepted on {formatDate(partner.termsAcceptedAt)}
            </p>
          ) : (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={form.acceptTerms}
                onChange={(e) => set("acceptTerms")(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-slate-300 accent-[#FF7A00]"
                aria-invalid={Boolean(errors.acceptTerms) || undefined}
              />
              <span className="text-sm leading-6 text-slate-700">
                I confirm the details above are correct and I agree to the KSG partner terms, commission and
                cancellation policies, and the privacy policy.
                {errors.acceptTerms && (
                  <span role="alert" className="block text-xs text-rose-600">
                    {errors.acceptTerms}
                  </span>
                )}
              </span>
            </label>
          )}
        </Card>

        <div className="sticky bottom-20 z-10 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <InlineError message={serverError} />
          <div className={cx("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", serverError && "mt-3")}>
            <Button variant="secondary" onClick={() => save(true)} loading={saving === "draft"} disabled={Boolean(saving)}>
              Save progress
            </Button>
            <Button type="submit" loading={saving === "submit"} disabled={Boolean(saving)}>
              {partner?.status === "rejected"
                ? "Resubmit for review"
                : partner?.status === "approved"
                  ? "Save changes"
                  : "Save & submit for review"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
