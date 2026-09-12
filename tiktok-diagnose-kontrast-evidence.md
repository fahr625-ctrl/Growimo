# Evidence: TikTok-Diagnose — Eingabe-Textfarbe kontrastreich (UI-/Kontrast-Fix)

**Datum:** 2026-09-12 · **Branch:** master · **Fix-Commit:** (siehe unten) · **Vorheriger Stand:** d75eb67

## Owner-Feedback (verbindlich, wortwörtlich)
> Die vom Nutzer eingegebenen Werte in den Feldern „Aufrufe (Views)", „Videolänge",
> „Durchschnittl. Wiedergabedauer", „Likes", „Kommentare", „Shares" und „Profilaufrufe"
> sind nach der Eingabe nahezu unsichtbar, weil die Textfarbe viel zu hell ist.

## 1. Root-Cause (klassen-genau)

Die 7 Diagnose-Felder werden über **eine** gemeinsame Helper-Funktion gerendert:
`metricInput(...)` in `src/routes/app/tiktok.tsx` (Zeile 652 ff., Commit e72c02d).
Das `<input>` hatte **keine Textfarb-Klasse**:

```
vorher (Zeile 669):
className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 ${
  issue ? 'border-red-400 bg-red-50 focus:ring-red-300' : 'border-gray-200 focus:ring-cyan-400'
}`}
```

Warum wird der Text dadurch hell/unsichtbar?

1. **Tailwind v4 Preflight** setzt für `input` `color: inherit` → die Eingabefarbe erbt
   von den Eltern-Elementen.
2. Die Diagnose-Karte (`src/routes/app/tiktok.tsx` Zeile 857) ist `bg-white` und hat selbst
   **keine** Textfarb-Klasse → die Eingabe erbt weiter bis `html, body`.
3. `src/styles/app.css` Zeile 6: `html, body { @apply bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100; }`
   — das Projekt nutzt Tailwind v4 mit **Default-Dark-Variante = `prefers-color-scheme: dark`
   (Media Query)**, kein Klassen-/Toggle-System (im gesamten `src/` kein `@custom-variant`,
   kein `darkMode`, kein `classList`-Toggle).
4. **Dark Mode aktiv (z. B. Android mit System-Dark-Mode):** `body` bekommt `text-gray-100`
   (sehr hell) → die Eingaben erben hellen Text auf weißer Karte (`bg-white`, kein `dark:bg-*`)
   → **eingegebene Werte nahezu unsichtbar.** Genau das beschriebene Owner-Feedback.

Projekt-Konvention bestätigt: Alle anderen weißen Karten-Inputs/-Selects in `tiktok.tsx`
setzen explizit `text-gray-900` **ohne** `dark:`-Variante (Zeilen 778, 801, 806, 820) — die
Karten bleiben in beiden Modi weiß, daher ist „dunkler Text auf Weiß" in beiden Modi korrekt.

## 2. Fix (klassen-genau, vorher → nachher)

Ein Change in der gemeinsamen Helper-Funktion `metricInput` korrigiert **alle 7 Felder**
(views, length, avgWatch = Pflicht; likes, comments, shares, profile = optional).

```
nachher (Zeile 669):
className={`w-full rounded-xl border px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 ${
  issue ? 'border-red-400 bg-red-50 focus:ring-red-300' : 'border-gray-200 focus:ring-cyan-400'
}`}
```

- **Eingabewert:** `text-gray-900` → dunkler, kontrastreicher Text auf hellem Feld
  (Karte/Feld bleiben `bg-white` in beiden Modi; deshalb bewusst **keine**
  `dark:text-gray-100`-Variante — die würde denselben Fehler im Dark-Mode reproduzieren).
- **Placeholder:** `placeholder:text-gray-400` → bleibt hell/grau.
- **Fokus unverändert:** `focus:ring-2` + `focus:ring-cyan-400` / `focus:ring-red-300` und
  alle Border-/bg-Klassen exakt wie vorher — nur `text-…` + `placeholder:text-…` ergänzt.

**Nicht verändert:** TikTok-Analyse, Prompts, Berechnungen, `diagnoseMetricIssues`,
Validierung, Button-Verhalten, Server-Calls, i18n-Strings (keine Textänderung),
andere Layouts, Phase-8.2-/Owner-Override-Code.

## 3. Gates

| Gate | Ergebnis |
|---|---|
| `npx tsc -p tsconfig.gate.json --noEmit` | Fehleranzahl = Baseline (60) — **0 neue** |
| i18n-Parität | unberührt: keine User-facing Textänderung in de/en |
| `bash build-vercel.sh` | EXIT 0 |

## 4. Commit & Deploy

- Commit: `fix(tiktok): Diagnose-Eingabe-Textfarbe kontrastreich (heller Placeholder bleibt, Fokus unverändert)` → `a2da53a`
- Evidence-Commit: `chore(evidence): tiktok-diagnose-kontrast-evidence` → `59aa73f`
- gepusht nach `origin/master` (`d75eb67..59aa73f`)
- Deploy: `bunx vercel deploy --prebuilt --prod --yes` → **Ready**
- **Deploy-URL:** https://site-ijxsreti3-growimo.vercel.app
- **www.growimo.app → HTTP 200** (curl -L, nach Deploy)

## 5. Bundle-Beleg (Production-Artifakt, Build aus diesem Commit)

- **Route-Code (JS):** `.vercel/output/static/assets/tiktok-D_gA20tX.js` enthält den
  Klassen-String `placeholder:text-gray-400` (grep-Treffer = 1) — der neue Code ist im
  Production-Client-Bundle der TikTok-Route.
- **Beweis „neu":** `git show e72c02d:src/routes/app/tiktok.tsx | grep -c placeholder:text-gray-400` → `0`
  (Klasse existierte vor diesem Fix in der TikTok-Route nicht).
- **CSS-Regeln:** `.vercel/output/static/assets/app-BIe7_lx7.css` enthält sowohl die
  `placeholder:text-gray-400::placeholder`- als auch die `.text-gray-900`-Regel
  (Tailwind v4 generiert Regeln nur für im Source auftauchende Klassen).
- Hinweis: Das SSR-Handler-Bundle `.vercel/output/functions/render.func/index.mjs` enthält
  die CSS-Regeln nicht inline (CSS wird als Static-Asset ausgeliefert — reguläres
  TanStack-Start-Layout); der Nachweis über die ausgelieferten Static-Assets ist der
  maßgebliche Beleg für das, was der Browser erhält.

## 6. Verifikationsstatus Android/Mobile + Desktop

- **Statisch (ohne Browser-Session) belegt:** Root-Cause ist reine CSS-Klasse;
  `text-gray-900` (#111827) auf `bg-white` = WCAG-AAA-Kontrast (~15,9:1) in beiden
  Color-Schemes, da Karte weiß bleibt. Dark-Mode-Rückfall `text-gray-100` ist jetzt
  **immer** von `text-gray-900` überschrieben (Spezifität: Utility-Klasse direkt am
  Element gewinnt gegen vererbte Body-Farbe).
- **Visuell:** Route `src/routes/app/tiktok.tsx` liegt hinter Auth (Beta-Gate). Ohne
  Browser-Session mit Login konnten die sieben Felder nicht screenshottet werden
  (identisch zur dokumentierten Praxis früherer Phasen: Prod-E2E nur über API-JWT möglich,
  UI nur statisch verifizierbar). Es existiert die Möglichkeit, den visuellen Check im
  Dev-/Auth-Kontext nachzuholen — siehe Owner-Selfcheck.

## 7. Owner-Selfcheck-Anleitung (mobil + Desktop)

1. www.growimo.app öffnen → einloggen (Beta-Konto) → App → **TikTok**.
2. Karte **„📊 Diagnose"** antippen → die 7 Felder erscheinen (Views, Videolänge,
   Durchschnittl. Wiedergabedauer, Likes, Kommentare, Shares, Profilaufrufe).
3. In **alle 7 Felder** Werte eintippen (Pflichtfelder: Views, Videolänge, Wiedergabedauer):
   Die getippten Werte müssen jetzt **dunkel und klar lesbar** auf weißem Feld erscheinen.
4. Placeholder (Beispieltext vor der Eingabe) darf hell/grau bleiben — das ist gewollt.
5. Feld antippen: Fokus-Ring (cyan/blau) muss weiterhin erscheinen.
6. **Bitte explizit auch auf Android/Handy testen** (dort trat der Fehler auf) —
   idealerweise mit aktiviertem System-Dark-Mode, da dort früher heller Text auf Weiß erschien.
7. Optional: Screenshot schicken für die Abnahme.

## 8. HTTP-Check Production

- `https://www.growimo.app` → **HTTP 200** (nach Deploy verifiziert)
- Live-Chunk-Check (Deployment): `/assets/tiktok-D_gA20tX.js` enthält `placeholder:text-gray-400` (grep=1) ✅
- Live-CSS-Check (Deployment): `/assets/app-BIe7_lx7.css` enthält die Regel
  `placeholder\:text-gray-400::placeholder{color:var(--color-gray-400)}` ✅