#!/usr/bin/env bash
# =============================================================================
# deploy-prod.sh — the ONE documented way to deploy Growimo to production.
# =============================================================================
#
# Chain:  build (+ fail-closed pre-deploy gate)  ->  vercel deploy
#
#   bash deploy-prod.sh
#
# The gate (scripts/prod-bundle-gate.sh) runs inside build-vercel.sh as step
# [4/4]; because build-vercel.sh uses `set -e`, a red gate makes it exit non-zero
# and the `&&` below never reaches the deploy line. That is the whole point: a
# bundle carrying the Clerk *development* key (or a missing production key) can no
# longer be shipped. See clerk-gate3-krise-diagnose-2026-10-11/KRISE-REPORT.md.
#
# REQUIRED ENV (the gate needs the production Clerk publishable key, because the
# repo .env still contains the dev key and Vite gives process.env precedence):
#
#   export VITE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuZ3Jvd2ltby5hcHAk
#
# Runtime env (DATABASE_URL, OPENAI_API_KEY, CLERK_SECRET_KEY, STRIPE_* …) lives in
# Vercel Production and is NOT passed here — never put secrets on a command line.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"
umask 002

bash ./build-vercel.sh   # step [4/4] = fail-closed gate; aborts on a red gate

echo "==> deploying prebuilt bundle to production"
bunx vercel deploy --prebuilt --prod --yes
