import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, CalendarRange, IndianRupee, ShieldCheck } from "lucide-react";
import { hasPartnerSession, publicApi, savePartnerSession } from "../../shared/hotelApi";
import { BASE_PATH } from "../lib/constants";
import { onlyDigits } from "../lib/utils";
import { Button, InlineError, TextField, fadeUp } from "../components/ui";

const PERKS = [
  { icon: Building2, text: "List hotels, resorts, villas, homestays, hostels and PGs" },
  { icon: CalendarRange, text: "Control prices and availability night by night" },
  { icon: IndianRupee, text: "Reach KSG customers across your city" },
];

const HERO_IMG =
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1100&q=70&auto=format&fit=crop";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "otp") setTimeout(() => otpRef.current?.focus(), 250);
  }, [step]);

  if (hasPartnerSession() && step === "phone" && !busy) return <Navigate to={BASE_PATH} replace />;

  const digits = onlyDigits(phone, 10);

  const sendOtp = async (e) => {
    e?.preventDefault();
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await publicApi.post("/partner/auth/request-otp", { phone: digits });
      setDevOtp(data?.otp ? String(data.otp) : "");
      setOtp("");
      setStep("otp");
      setCooldown(30);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(otp)) {
      setError("Enter the 4 to 6 digit code we sent you.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await publicApi.post("/partner/auth/verify-otp", { phone: digits, otp, platform: "web" });
      if (!data?.accessToken) throw new Error("Could not sign you in. Try again.");
      savePartnerSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, partner: data.partner });
      const p = data.partner || {};
      const needsProfile = data.isNewPartner || !p.name || !p.termsAcceptedAt;
      const from = location.state?.from;
      navigate(needsProfile ? `${BASE_PATH}/profile` : from || BASE_PATH, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      {/* ── brand panel ── */}
      <section className="relative hidden overflow-hidden bg-[#071A47] lg:block">
        <img src={HERO_IMG} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B2A6F]/95 via-[#0B2A6F]/80 to-[#071A47]/95" />
        <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#FF7A00]/25 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF7A00] to-[#E85D04] shadow-lg">
              <Building2 className="h-6 w-6" />
            </span>
            <span className="text-xl font-bold tracking-tight">
              KSG <span className="text-[#FFB066]">Stays</span> Partner
            </span>
          </div>
          <div>
            <h1 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight xl:text-5xl">
              Fill more rooms with <span className="text-[#FF9A3D]">KSG</span>
            </h1>
            <p className="mt-4 max-w-md text-base leading-7 text-blue-100/90">
              One portal for your property, your rooms and your calendar. Sign in with your mobile number.
            </p>
            <ul className="mt-10 space-y-4">
              {PERKS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-[15px] text-blue-50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                    <Icon className="h-5 w-5 text-[#FF9A3D]" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <p className="flex items-center gap-2 text-sm text-blue-200/80">
            <ShieldCheck className="h-4 w-4 text-[#16A34A]" /> Verified partners only. Your documents stay private.
          </p>
        </div>
      </section>

      {/* ── form ── */}
      <section className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/partner" className="inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> All partner types
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF7A00] to-[#E85D04] text-white shadow">
              <Building2 className="h-6 w-6" />
            </span>
            <span className="text-lg font-bold text-[#071A47]">KSG Stays Partner</span>
          </div>

          <AnimatePresence mode="wait">
            {step === "phone" ? (
              <motion.form key="phone" {...fadeUp} onSubmit={sendOtp} noValidate>
                <h2 className="text-2xl font-bold tracking-tight text-[#071A47]">Hotel &amp; homestay owners</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Sign in or register. New numbers go straight to setting up your account.
                </p>
                <TextField
                  className="mt-8"
                  label="Mobile number"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  prefix="+91"
                  placeholder="98765 43210"
                  value={digits}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={10}
                  autoFocus
                />
                <div className="mt-4">
                  <InlineError message={error} />
                </div>
                <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>
                  Get OTP <ArrowRight className="h-4 w-4" />
                </Button>
                <p className="mt-6 text-center text-xs text-slate-500">
                  By continuing you agree to KSG&apos;s partner terms and privacy policy.
                </p>
              </motion.form>
            ) : (
              <motion.form key="otp" {...fadeUp} onSubmit={verify} noValidate>
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setError("");
                  }}
                  className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
                >
                  <ArrowLeft className="h-4 w-4" /> Change number
                </button>
                <h2 className="text-2xl font-bold tracking-tight text-[#071A47]">Enter the code</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Sent by SMS to <span className="font-semibold text-slate-800">+91 {digits}</span>
                </p>
                <label htmlFor="hotel-otp" className="sr-only">
                  One-time code
                </label>
                <input
                  id="hotel-otp"
                  ref={otpRef}
                  value={otp}
                  onChange={(e) => setOtp(onlyDigits(e.target.value, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="• • • • • •"
                  className="mt-8 h-14 w-full rounded-xl border border-slate-300 text-center text-2xl font-semibold tracking-[0.6em] text-slate-900 placeholder:text-slate-300 focus:border-[#0B2A6F] focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
                {devOtp && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                    <BadgeCheck className="h-3.5 w-3.5 text-[#16A34A]" /> Test code: {devOtp}
                  </p>
                )}
                <div className="mt-4">
                  <InlineError message={error} />
                </div>
                <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>
                  Verify &amp; continue
                </Button>
                <p className="mt-5 text-center text-sm text-slate-500">
                  Didn&apos;t get it?{" "}
                  {cooldown > 0 ? (
                    <span>Resend in {cooldown}s</span>
                  ) : (
                    <button type="button" onClick={sendOtp} className="font-semibold text-[#E85D04] hover:underline">
                      Resend code
                    </button>
                  )}
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </section>
    </div>
  );
}
