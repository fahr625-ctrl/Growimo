import { useEffect, useState } from "react";
import { useTranslation } from "~/i18n";

// Banner shown on the sign-in page when the user arrives right after
// registering for beta (URL contains ?beta=registered).
export default function BetaRegisteredNotice() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const beta = new URLSearchParams(window.location.search).get("beta");
      if (beta) setShow(true);
    } catch {}
  }, []);

  if (!show) return null;

  return (
    <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left">
      <p className="font-bold text-emerald-800">{t.beta_signin_notice_title}</p>
      <p className="mt-1 text-sm text-emerald-700">{t.beta_signin_notice_text}</p>
    </div>
  );
}
