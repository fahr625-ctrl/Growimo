import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { ProtectedRoute } from "~/components/ProtectedRoute";
import { useTranslation } from "~/i18n";
import { OWNER_USER_ID } from "~/lib/tracking";
export const Route = createFileRoute("/app/beta-signups")({ component: BetaSignupsPage });
type Signup = { id: string; first_name: string; email: string; created_at: string; approved: boolean };
// ── Owner-only gate ──────────────────────────────────────────────────────────
// Same pattern as admin-tracking.tsx: non-owners get a lock screen, never the
// PII list (the API additionally enforces 401/403).
function BetaSignupsPage() {
  const { user } = useUser();
  const { t } = useTranslation();
  if (!user || user.id !== OWNER_USER_ID) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">{t.tracking_not_authorized}</h1>
          <p className="mt-2 text-sm text-gray-500">{t.tracking_not_authorized_desc}</p>
        </div>
      </div>
    );
  }
  return <ProtectedRoute><BetaSignupsContent /></ProtectedRoute>;
}
function BetaSignupsContent() { const { t } = useTranslation(); const [rows,setRows]=useState<Signup[]>([]); const [loading,setLoading]=useState(true); useEffect(()=>{ fetch("/api/beta-signups").then(r=>r.json()).then(d=>setRows(d.signups||[])).catch(()=>{}).finally(()=>setLoading(false)); },[]); return <div><div className="flex items-end justify-between"><div><h1 className="text-3xl font-bold text-gray-900">{t.beta_admin_title}</h1><p className="mt-2 text-gray-500">{t.beta_admin_count.replace("%d", String(rows.length))}</p></div></div><div className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">{!loading && rows.length===0 ? <p className="p-8 text-center text-gray-500">{t.beta_admin_empty}</p> : <table className="w-full text-left"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-6 py-4">{t.beta_admin_name}</th><th className="px-6 py-4">{t.beta_admin_email}</th><th className="px-6 py-4">{t.beta_admin_status}</th><th className="px-6 py-4">{t.beta_admin_date}</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map(r=><tr key={r.id}><td className="px-6 py-4 font-medium text-gray-900">{r.first_name}</td><td className="px-6 py-4 text-gray-600">{r.email}</td><td className="px-6 py-4">{r.approved ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">✓ {t.beta_admin_approved}</span> : <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">{t.beta_admin_pending}</span>}</td><td className="px-6 py-4 text-gray-500">{new Date(r.created_at).toLocaleString()}</td></tr>)}</tbody></table>}</div></div>; }
