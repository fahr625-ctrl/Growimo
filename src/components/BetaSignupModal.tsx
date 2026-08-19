import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { isClerkConfigured } from "~/auth/middleware";
import { useTranslation } from "~/i18n";

export const BETA_SIGNUP_EVENT = "growimo:open-beta-signup";
export function openBetaSignup() { window.dispatchEvent(new Event(BETA_SIGNUP_EVENT)); }

export default function BetaSignupModal() {
  const { t } = useTranslation();
  // Guarded like the rest of the app: useAuth only when Clerk is configured.
  const { isSignedIn } = isClerkConfigured() ? useAuth() : { isSignedIn: false };
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const redirectTimer = useRef<number | null>(null);
  useEffect(() => { const handler = () => { setOpen(true); setSuccess(false); setError(""); }; window.addEventListener(BETA_SIGNUP_EVENT, handler); return () => { window.removeEventListener(BETA_SIGNUP_EVENT, handler); if (redirectTimer.current) clearTimeout(redirectTimer.current); }; }, []);
  if (!open) return null;
  const close = () => { if (!submitting) setOpen(false); };
  const goAfterSignup = () => { window.location.href = isSignedIn ? "/app" : "/app/sign-in?beta=registered"; };
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (!firstName.trim()) { setError(t.beta_form_error_required); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t.beta_form_error_email); return; }
    setSubmitting(true);
    try { const res = await fetch("/api/beta-signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ first_name: firstName.trim(), email: email.trim() }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "error"); setSuccess(true); redirectTimer.current = window.setTimeout(goAfterSignup, 1200); } catch { setError(t.beta_form_error_email); } finally { setSubmitting(false); }
  }
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><style>{`/* Growimo Beta-Form: nur Lesbarkeit der Eingabefelder (kein Layout-Eingriff) */
.beta-input{color:#1F2937 !important;caret-color:#1F2937;background-color:#fff;}
.beta-input::placeholder{color:#9CA3AF !important;opacity:1;}
.beta-input:-webkit-autofill,.beta-input:-webkit-autofill:hover,.beta-input:-webkit-autofill:focus{color:#1F2937 !important;-webkit-text-fill-color:#1F2937 !important;caret-color:#1F2937;-webkit-box-shadow:0 0 0 1000px #ffffff inset;box-shadow:0 0 0 1000px #ffffff inset;transition:background-color 9999999s ease-out 0s;`}</style>
    <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl sm:p-9">
      <button aria-label={t.common_close} onClick={close} className="absolute right-4 top-4 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">✕</button>
      {success ? <div className="py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">✓</div><h2 className="mt-5 text-2xl font-bold text-gray-900">{t.beta_form_success_title}</h2><p className="mt-3 text-gray-500">{t.beta_form_success_text}</p><button onClick={() => { if (redirectTimer.current) { clearTimeout(redirectTimer.current); redirectTimer.current = null; } goAfterSignup(); }} className="mt-7 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 font-semibold text-white">OK</button></div> : <><div className="mb-7 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-5 text-white"><h2 className="text-2xl font-bold">{t.beta_modal_title}</h2><p className="mt-2 text-sm text-blue-100">{t.beta_modal_subtitle}</p></div><form onSubmit={submit} className="space-y-5"><label className="block"><span className="text-sm font-semibold text-gray-700">{t.beta_form_firstname}</span><input autoFocus required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder={t.beta_form_firstname_placeholder} className="beta-input mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[#1F2937] outline-none placeholder-[#9CA3AF] focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><label className="block"><span className="text-sm font-semibold text-gray-700">{t.beta_form_email}</span><input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t.beta_form_email_placeholder} className="beta-input mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[#1F2937] outline-none placeholder-[#9CA3AF] focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>{error && <p className="text-sm text-red-600">{error}</p>}<button disabled={submitting} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3.5 font-semibold text-white shadow-lg disabled:opacity-60">{submitting ? t.beta_form_submitting : t.beta_form_submit}</button></form></>}
    </div></div>;
}
