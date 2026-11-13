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
# Step [4/4] runs scripts/prod-bundle-gate.sh on the freshly built bundle. If the
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

echo "[1/4] vite build (light — safe under the sandbox memory cap)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install
bun run build

echo "[2/4] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[3/4] bundle SSR handler + deps into the render function"
bun build vercel-entry.ts --target node \
  --outfile .vercel/output/functions/render.func/index.mjs

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true, "maxDuration": 300 }
JSON
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

echo "[4/4] pre-deploy gate (fail-closed): Production-Clerk-Key + keine Dev-Marker"
if ! bash ./scripts/prod-bundle-gate.sh; then
  echo "" >&2
  echo "PRE-DEPLOY-GATE ROT — Build verworfen, KEIN Deploy. (.vercel/output bleibt liegen," >&2
  echo "aber jeder Deploy-Pfad laeuft durch build-vercel.sh und damit erneut durch den Gate.)" >&2
  exit 1
fi

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
