// ─────────────────────────────────────────────────────────────────────────────
// /app/konto-loeschen — Selbstbedienungs-Kontolöschung (Owner 2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────
// Ablauf (Owner-Vorgabe):
//   1. Deutliche Warnseite: Datenverlust (Projekte, Bilder, gespeicherte
//      Inhalte, Kontingent unwiederbringlich) + Auswirkungen auf den
//      Abonnementvertrag.
//   2. Bestätigungswort-Eingabe (LOESCHEN).
//   3. Bei AKTIVEM bezahltem Abo: Auswahl „sofort" vs. „zum Ende des bezahlten
//      Zeitraums" mit erklärtem Unterschied. Ohne Abo: NUR der sofortige Weg.
//   4. Finale Bestätigung.
//
// Der Server prüft alles noch einmal (Flag, Session, Bestätigungswort, Modus) —
// die Prüfungen hier sind nur die bessere Fehlermeldung, nie die einzige.
// ─────────────────────────────────────────────────────────────────────────────
import { seoHead } from '~/lib/seo';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { getAccountDeletionInfo, deleteAccount } from '~/account/delete-account';

export const Route = createFileRoute('/app/konto-loeschen')({
  head: () => seoHead({ titleKey: 'meta_app_settings_title' }),
  component: DeleteAccountPage,
});

type Mode = 'immediate' | 'period_end';

function DeleteAccountPage() {
  return (
    <ProtectedRoute>
      <DeleteAccountContent />
    </ProtectedRoute>
  );
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function DeleteAccountContent() {
  const { t, locale } = useTranslation();
  const { signOut } = useClerk();

  const [info, setInfo] = useState<Awaited<ReturnType<typeof getAccountDeletionInfo>> | null>(
    null,
  );
  const [infoError, setInfoError] = useState(false);
  const [mode, setMode] = useState<Mode>('immediate');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<
    { scheduled: boolean; scheduledFor: string | null } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    getAccountDeletionInfo()
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        // Ohne Abo gibt es nur den sofortigen Weg (keine irreführende Auswahl).
        if (!res.options.includes('period_end')) setMode('immediate');
      })
      .catch(() => {
        if (!cancelled) setInfoError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccount({ data: { confirmation: word, mode } });
      setDone({ scheduled: result.scheduled, scheduledFor: result.scheduledFor });
      if (!result.scheduled) {
        // Konto ist weg → Session beenden und zur Startseite.
        try {
          await signOut();
        } catch {
          // Ignorieren: die Clerk-Seite existiert ohnehin nicht mehr.
        }
        window.location.href = '/';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/LOESCHEN|Bestätigung/i.test(message)) setError(t.account_delete_error_mismatch);
      else if (/nicht freigeschaltet|disabled/i.test(message)) setError(t.account_delete_error_disabled);
      else setError(message || t.account_delete_error_generic);
    } finally {
      setBusy(false);
    }
  }, [mode, signOut, t, word]);

  // ── Zustände vor dem Formular ──────────────────────────────────────────────
  if (done) {
    return (
      <div className="mx-auto max-w-2xl animate-fadeIn">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h1 className="text-xl font-extrabold text-emerald-900">
            {done.scheduled
              ? t.account_delete_scheduled_title
              : t.account_delete_done_title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-emerald-800">
            {done.scheduled
              ? t.account_delete_scheduled_body.replace(
                  '%s',
                  formatDate(done.scheduledFor, locale),
                )
              : t.account_delete_done_body}
          </p>
          <Link
            to="/app/settings"
            className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200"
          >
            {t.account_delete_back_settings}
          </Link>
        </div>
      </div>
    );
  }

  if (infoError) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          {t.account_delete_error_generic}
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    );
  }

  if (!info.enabled) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h1 className="text-xl font-extrabold text-gray-900">
            {t.account_delete_disabled_title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            {t.account_delete_disabled_body}
          </p>
          <Link
            to="/app/settings"
            className="mt-5 inline-flex rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm"
          >
            {t.account_delete_back_settings}
          </Link>
        </div>
      </div>
    );
  }

  const options = info.options;
  const lossLabels: Record<string, string> = {
    projects_and_content: t.account_delete_loss_projects_and_content,
    generated_images: t.account_delete_loss_generated_images,
    saved_preferences: t.account_delete_loss_saved_preferences,
    usage_and_history: t.account_delete_loss_usage_and_history,
    generation_quota: t.account_delete_loss_generation_quota,
    account_access: t.account_delete_loss_account_access,
  };
  const noticeLabels: Record<string, string> = {
    subscription_ends_immediately: t.account_delete_notice_subscription_ends_immediately,
    subscription_ends_at_period_end: t.account_delete_notice_subscription_ends_at_period_end,
    access_ends_immediately: t.account_delete_notice_access_ends_immediately,
    access_until_period_end: t.account_delete_notice_access_until_period_end,
    no_prorated_refund: t.account_delete_notice_no_prorated_refund,
  };
  const wordOk = word.trim().toUpperCase() === info.confirmationWord.toUpperCase();
  const canSubmit = wordOk && !busy;

  return (
    <div className="mx-auto max-w-2xl animate-fadeIn">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900">{t.account_delete_title}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.account_delete_subtitle}</p>
      </div>

      {/* ── 1. Warnung: Datenverlust ──────────────────────────────────────── */}
      <section className="mb-5 rounded-2xl border-2 border-red-200 bg-red-50/60 p-5">
        <h2 className="text-base font-bold text-red-900">{t.account_delete_warning_heading}</h2>
        <p className="mt-1 text-sm leading-relaxed text-red-800">
          {t.account_delete_warning_intro}
        </p>
        <ul className="mt-3 space-y-1.5" data-testid="account-delete-loss-list">
          {info.lossItems.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-red-900">
              <span aria-hidden="true" className="mt-0.5">✕</span>
              <span>{lossLabels[item] ?? item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 1b. Abo-Auswirkung ────────────────────────────────────────────── */}
      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-bold text-gray-900">
          {t.account_delete_subscription_heading}
        </h2>
        {info.hasActivePaidSubscription ? (
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            {t.account_delete_subscription_active.replace(
              '%s',
              formatDate(info.currentPeriodEnd, locale),
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            {t.account_delete_no_subscription}
          </p>
        )}
      </section>

      {/* ── 2. Variante: nur bei aktivem Abo zwei Wege ─────────────────────── */}
      {options.length > 1 ? (
        <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-bold text-gray-900">{t.account_delete_mode_heading}</h2>
          <div className="mt-3 space-y-3" data-testid="account-delete-mode-options">
            <label
              className={`flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition-all ${
                mode === 'immediate' ? 'border-red-400 bg-red-50/40' : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="deletion-mode"
                value="immediate"
                checked={mode === 'immediate'}
                onChange={() => setMode('immediate')}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">
                  {t.account_delete_mode_immediate_label}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">
                  {t.account_delete_mode_immediate_desc}
                </span>
                <span className="mt-1 block space-y-0.5 text-xs leading-relaxed text-gray-500">
                  {info.modeNotices.immediate.map((n) => (
                    <span key={n} className="block">
                      · {noticeLabels[n] ?? n}
                    </span>
                  ))}
                </span>
              </span>
            </label>
            <label
              className={`flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition-all ${
                mode === 'period_end' ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="deletion-mode"
                value="period_end"
                checked={mode === 'period_end'}
                onChange={() => setMode('period_end')}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">
                  {t.account_delete_mode_period_end_label.replace(
                    '%s',
                    formatDate(info.currentPeriodEnd, locale),
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">
                  {t.account_delete_mode_period_end_desc}
                </span>
                <span className="mt-1 block space-y-0.5 text-xs leading-relaxed text-gray-500">
                  {info.modeNotices.period_end.map((n) => (
                    <span key={n} className="block">
                      · {noticeLabels[n] ?? n}
                    </span>
                  ))}
                </span>
              </span>
            </label>
          </div>
        </section>
      ) : (
        <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-bold text-gray-900">
            {t.account_delete_mode_immediate_label}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            {t.account_delete_mode_immediate_desc}
          </p>
        </section>
      )}

      {/* ── 3. Bestätigungswort ───────────────────────────────────────────── */}
      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-bold text-gray-900">{t.account_delete_confirm_heading}</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          {t.account_delete_confirm_hint.replace('%s', info.confirmationWord)}
        </p>
        <input
          type="text"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={t.account_delete_confirm_placeholder}
          aria-label={t.account_delete_confirm_heading}
          data-testid="account-delete-confirm-input"
          className="mt-3 w-full max-w-xs rounded-xl border border-gray-300 px-3 py-2 text-sm font-mono uppercase tracking-wider focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
        />
      </section>

      {error ? (
        <div
          role="alert"
          data-testid="account-delete-error"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {error}
        </div>
      ) : null}

      {/* ── 4. Finale Bestätigung ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          data-testid="account-delete-submit"
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? t.account_delete_submitting
            : mode === 'period_end'
              ? t.account_delete_submit_period_end
              : t.account_delete_submit}
        </button>
        <Link
          to="/app/settings"
          className="inline-flex rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm"
        >
          {t.account_delete_cancel}
        </Link>
      </div>
      <p className="mt-3 text-xs text-gray-400">{t.account_delete_irreversible}</p>
    </div>
  );
}
