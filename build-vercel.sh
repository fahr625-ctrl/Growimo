#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this site, then
# deploy it with:  bunx vercel deploy --prebuilt
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained file (deps + dynamic chunks inlined) in a
#    single render.func removes all tracing/detection risk. vercel-entry.ts adapts
#    the Node (req,res) launcher to the web fetch handler.
#
# ── FAIL-CLOSED PRE-DEPLOY GATE (since 2026-10-11) ───────────────────────────
# Step [1/5] runs scripts/typecheck-gate.sh (`tsc --noEmit`, since 2026-11-13)
# and step [5/5] runs scripts/prod-bundle-gate.sh on the freshly built bundle. If the
# production Clerk publishable key is missing, any dev key material / dev instance
# marker is present, or the owner-approved legacy-owner filter (criterion d, since
# 2026-10-26 a POSITIVE check) is missing from the bundle, the gate exits non-zero
# and this script aborts BEFORE the deploy. So the standard command
#     bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes
# can never ship a dev-wired client bundle again (Krise 2026-10-11: deployment
# site-ky4hj981r baked the dev key from the repo .env into the client bundle —
# see /home/team/shared/clerk-gate3-krise-diagnose-2026-10-11/KRISE-REPORT.md).
# A production build therefore needs the production key in process.env:
#     export VITE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuZ3Jvd2ltby5hcHAk
# (Vite's loadEnv() gives process.env precedence over the repo .env, which still
# holds the dev key — proven in clerk-gate3-optionA-2026-10-11/REPORT.md §1.)
# Not affected: the dev server (`vite dev`, port 3000, working site ctonew.app)
# and publish.sh (working-site path) — neither calls this script. go-live.sh does,
# so it is gated as well.
set -euo pipefail
cd "$(dirname "$0")"
umask 002

echo "[1/5] Typprüfung (fail-closed, Owner-Freigabe 2026-11-13)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install
# Der Ausfall vom 2026-11-13 war ein ReferenceError (channelErrors) — ein Fehler,
# den `tsc --noEmit` auf dem live gegangenen Commit 519f258 als TS2304 gemeldet
# hätte. Die Prüfung ist deshalb Pflicht: rot = kein Deploy. Details, inkl. der
# eingefrorenen Baseline der vorbestehenden Fehler, in scripts/typecheck-gate.sh.
if ! bash ./scripts/typecheck-gate.sh; then
  echo "" >&2
  echo "TYPPRÜFUNG ROT — Build verworfen, KEIN Deploy." >&2
  exit 1
fi

echo "[2/5] vite build (light — safe under the sandbox memory cap)"
bun run build

echo "[3/5] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[4/5] bundle SSR handler + deps into the render function"
bun build vercel-entry.ts --target node \
  --outfile .vercel/output/functions/render.func/index.mjs

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true, "maxDuration": 300 }
JSON

# ── sharp im Funktions-Artefakt (Phase 2, 2026-11-15, NICHT live) ────────────
# `sharp` ist ein natives Modul: das JavaScript wird vom bun-Bundle erfasst, das
# Native-Binding (@img/sharp-<platform>) kann aber NICHT in eine .mjs gebündelt
# werden. Ohne die Pakete im Funktionsordner findet die gebaute Funktion ihr
# Binding zur Laufzeit nicht — und zwar erst im Betrieb. Deshalb: kopieren UND
# fail-closed prüfen, sonst bricht der Build hier ab (kein Deploy).
#
# KORREKTUR 2026-11-15 (Befund aus dem Artefakt-Lauf außerhalb des Repos):
# Die erste Fassung kopierte `node_modules/@img/*` OHNE den Scope-Ordner und
# ließ `semver` / `detect-libc` weg. Im Repo fiel das nicht auf, weil Node die
# fehlenden Pakete aus `site/node_modules` eine Ebene höher nachlud — die Kopie
# außerhalb des Repos brach dagegen mit
#   "Cannot find package '@img/colour' imported from .../sharp/dist/colour.mjs"
# ab. Also: Scope-Struktur erhalten, Laufzeit-Abhängigkeiten mitkopieren, und
# die Prüfung in einer Kopie AUSSERHALB des Repos fahren (dort gibt es kein
# node_modules darüber, das stillschweigend aushilft).
rm -rf .vercel/output/functions/render.func/node_modules
mkdir -p .vercel/output/functions/render.func/node_modules/@img
cp -R node_modules/sharp .vercel/output/functions/render.func/node_modules/
cp -R node_modules/@img/. .vercel/output/functions/render.func/node_modules/@img/
for d in detect-libc semver; do
  [ -d "node_modules/$d" ] || { echo "sharp-Abhängigkeit $d fehlt in node_modules — Build verworfen." >&2; exit 1; }
  cp -R "node_modules/$d" .vercel/output/functions/render.func/node_modules/
done
echo "[4/5] sharp-Artefakt prüfen (fail-closed, außerhalb des Repos)"
sharp_proof_dir="$(mktemp -d "${TMPDIR:-/tmp}/growimo-sharp-proof.XXXXXX")"
cp -R .vercel/output/functions/render.func "$sharp_proof_dir/"
if ! ( cd "$sharp_proof_dir/render.func" && node --input-type=module -e '
  const { default: sharp } = await import("sharp");
  const v = sharp.versions || {};
  if (!v.sharp || !v.vips) { console.error("sharp-Versionen fehlen"); process.exit(3); }
  const svg = Buffer.from("<svg width=\"40\" height=\"40\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"40\" height=\"40\" fill=\"#0f766e\"/></svg>");
  const png = await sharp(svg).png().toBuffer();
  const meta = await sharp(png).metadata();
  if (meta.width !== 40 || meta.height !== 40) { console.error("Render-Maße falsch"); process.exit(4); }
  console.log("sharp " + v.sharp + " / libvips " + v.vips + " / PNG-Render ok (" + meta.width + "x" + meta.height + ")");
' ); then
  rm -rf "$sharp_proof_dir"
  echo "" >&2
  echo "SHARP IM FUNKTIONS-ARTEFAKT NICHT LADBAR — Build verworfen, KEIN Deploy." >&2
  echo "Geprüft wurde eine Kopie von render.func außerhalb des Repos (kein Repo-node_modules darüber)." >&2
  exit 1
fi
rm -rf "$sharp_proof_dir"
if ! find .vercel/output/functions/render.func/node_modules -name '*.node' -print -quit | grep -q .; then
  echo "KEIN NATIVES BINDING (*.node) im Funktions-Artefakt — Build verworfen, KEIN Deploy." >&2
  exit 1
fi
if ! grep -q 'sharp' .vercel/output/functions/render.func/index.mjs; then
  echo "GEBÜNDELTER HANDLER ENTHÄLT KEIN sharp — Build verworfen, KEIN Deploy." >&2
  exit 1
fi
# ── Cron-Registrierung im Build-Artefakt (Owner-Freigabe 2026-10-22) ─────────
# EINZIGE Quelle der Wahrheit fuer den 90-Tage-TTL-Cron (/api/cron/blob-ttl,
# "0 3 * * *") ist seit 2026-11-13 DIESE Datei: `vercel.json` fuehrt keinen
# crons-Eintrag mehr. Grund: Vercel fuehrt die crons aus vercel.json UND die
# crons aus .vercel/output/config.json zusammen — stand dieselbe Definition in
# beiden, brach der Deploy mit `duplicated_cron_job` ab (site-5gau5zl4s,
# 2026-11-12: "A duplicated cron job with the same schedule (0 3 * * *) and
# path (/api/cron/blob-ttl) was found. Please remove the duplicated entry.").
# `vercel deploy --prebuilt` wertet vercel.json ohnehin nicht aus, sondern
# ausschliesslich .vercel/output.
cat > .vercel/output/config.json <<'JSON'
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/render" }
  ],
  "crons": [
    { "path": "/api/cron/blob-ttl", "schedule": "0 3 * * *" }
  ]
}
JSON
# Fail-closed: der Cron muss GENAU EINMAL im Artefakt stehen — sonst Build
# abbrechen, statt einen Deploy ohne (oder mit doppeltem) Cron auszuliefern.
cron_hits="$(grep -o '/api/cron/blob-ttl' .vercel/output/config.json | wc -l | tr -d ' ')"
if [ "$cron_hits" != "1" ]; then
  echo "CRON-REGISTRIERUNG NICHT GENAU EINMAL in .vercel/output/config.json (${cron_hits} Treffer) — Build verworfen." >&2
  exit 1
fi

echo "[5/5] pre-deploy gate (fail-closed): Production-Clerk-Key + keine Dev-Marker"
if ! bash ./scripts/prod-bundle-gate.sh; then
  echo "" >&2
  echo "PRE-DEPLOY-GATE ROT — Build verworfen, KEIN Deploy. (.vercel/output bleibt liegen," >&2
  echo "aber jeder Deploy-Pfad laeuft durch build-vercel.sh und damit erneut durch den Gate.)" >&2
  exit 1
fi

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
