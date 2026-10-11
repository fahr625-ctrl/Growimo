#!/usr/bin/env bash
# =============================================================================
# prod-bundle-gate.sh — FAIL-CLOSED pre-deploy gate for Growimo production builds
# =============================================================================
#
# WHY THIS EXISTS (Krise 2026-10-11)
# ----------------------------------
# The production deployment `site-ky4hj981r` was built locally and baked the Clerk
# *DEVELOPMENT* publishable key from the repo `.env`
# (`pk_test_dG91Y2hpbmct…` -> instance `touching-catfish-43.clerk.accounts.dev`)
# into the client bundle. www.growimo.app therefore talked to the wrong Clerk
# instance: no production users, no owner recognition. The fix was a re-build with
# `export VITE_CLERK_PUBLISHABLE_KEY=<pk_live_…>` — Vite's loadEnv() prefers
# `process.env` over `.env`. Evidence:
#   /home/team/shared/clerk-gate3-krise-diagnose-2026-10-11/KRISE-REPORT.md
#   /home/team/shared/clerk-gate3-optionA-2026-10-11/REPORT.md
#
# This gate runs on the freshly built bundle (dist/ + .vercel/output/) *after* the
# build and *before* the deploy, and exits non-zero when anything dev-ish is found.
# build-vercel.sh calls it as its last step, therefore
#   bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes
# can never reach the deploy when the gate is red.
#
# THE `pk_test_` TRAP — READ BEFORE EDITING (cost us real time, see KRISE-REPORT §2
# and OPTION-A-REPORT §2): never test for the bare string `pk_test_`. The Clerk SDK
# ships the *constants* mb="pk_live_" / fT="pk_test_" (@clerk/shared) in EVERY
# bundle, dev or prod, and our own src/api/tracking.ts + src/api/beta.ts contain
# `pk.slice("pk_test_".length)`. A prefix check therefore fires on perfectly good
# production bundles: the known-good prod deployment `site-9m9iu13a2` has 1 such
# hit, the broken `site-ky4hj981r` has 2. Counting that literal says nothing about
# which instance a bundle talks to. The gate must match the DEV KEY *VALUE*
# (`pk_test_dG91Y2hpbmct…`, i.e. pk_test_ + base64("touching-")) and the dev
# INSTANCE marker (`touching-catfish-43`).
# Symmetrically, a bare `pk_live_` check is worthless (also a library constant), so
# criterion (a) extracts every `pk_live_<payload>` value and base64-decodes it.
#
# USAGE
#   bash scripts/prod-bundle-gate.sh                  # scan dist/ + .vercel/output
#   bash scripts/prod-bundle-gate.sh <dir> [<dir>…]   # scan explicit roots
#
# EXIT CODES
#   0  PASS  — production bundle clean, deploy allowed
#   1  FAIL  — dev key / dev marker / missing prod key, deploy refused
#   2  ERROR — nothing to scan (no dist/, no .vercel/output/)
#
# DELIBERATELY NO BYPASS. There is no flag that lets a red gate through. Removing or
# weakening this gate requires a reviewed commit. The one documented exception is
# the owner-id criterion (e), which can be downgraded to a warning with
#   GATE_OWNER_ID=warn bash scripts/prod-bundle-gate.sh
# should a future refactor legitimately move the owner id out of the client bundle.
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT" || exit 2

# ---- expectations (single source of truth for the gate) ---------------------
# Public values only. pk_live_… is a *publishable* key (meant to be shipped);
# no secret key material is read, written or logged anywhere in this script.
PROD_KEY_LITERAL="pk_live_Y2xlcmsuZ3Jvd2ltby5hcHAk"  # base64 payload = clerk.growimo.app$
PROD_KEY_DOMAIN='clerk.growimo.app'                   # decoded payload must contain this
DEV_KEY_VALUE="pk_test_dG91Y2hpbmct"                  # value prefix of OUR dev key (repo .env)
DEV_INSTANCE_EXACT="touching-catfish-43"              # dev Clerk instance
DEV_INSTANCE_ANY="touching-catfish"                   # any dev instance marker (superset guard)
OLD_OWNER_ID="user_3H2trJXHwzXmJF2XTGQ2PMEwjkD"       # dev-instance owner id — must be gone
NEW_OWNER_ID="user_3KQScMnVPi30zj12OTNSJluvNvK"       # production-instance owner id — required
GATE_OWNER_ID="${GATE_OWNER_ID:-require}"             # require | warn (see header)

# ---- scan roots -------------------------------------------------------------
ROOTS=()
if [ "$#" -gt 0 ]; then
  for a in "$@"; do ROOTS+=("$a"); done
else
  for d in dist .vercel/output; do
    [ -e "$d" ] && ROOTS+=("$d")
  done
fi

if [ "${#ROOTS[@]}" -eq 0 ]; then
  echo "GATE-FEHLER: kein Build gefunden (weder dist/ noch .vercel/output/)."
  echo "             Erst bauen (bash build-vercel.sh), dann den Gate laufen lassen."
  exit 2
fi

# ---- helpers ----------------------------------------------------------------
FAILS=0
DETAIL_FILE="$(mktemp)"
trap 'rm -f "$DETAIL_FILE"' EXIT

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }

# scan_hits_raw <fixed-pattern> : prints total occurrence count over ROOTS and
# writes the per-file proof string into $DETAIL_FILE ("[root: Nx in file,…]", from
# grep -l + grep -o|wc -l). A temp file is used because a global set inside a
# command substitution would be lost with the subshell.
scan_hits_raw() {
  local pat="$1" total=0 n r files joined detail=""
  for r in "${ROOTS[@]}"; do
    [ -e "$r" ] || continue
    n="$(grep -r -a -F -o -e "$pat" -- "$r" 2>/dev/null | wc -l | tr -d ' ')"
    [ -z "$n" ] && n=0
    total=$((total + n))
    if [ "$n" -gt 0 ]; then
      files="$(grep -r -a -F -l -e "$pat" -- "$r" 2>/dev/null | sort -u | tr '\n' ',')"
      joined="${files%,}"
      detail="${detail}${detail:+ }[$r: ${n}x in ${joined}]"
    fi
  done
  printf '%s' "$detail" > "$DETAIL_FILE"
  printf '%s' "$total"
}

# scan_hits <fixed-pattern> : sets globals HITS (count) and HITS_DETAIL (proof)
scan_hits() {
  HITS="$(scan_hits_raw "$@")"
  HITS_DETAIL="$(cat "$DETAIL_FILE")"
}

# collect every distinct pk_live_<payload> value (payload >= 16 chars) in ROOTS
collect_pk_live_values() {
  local r
  for r in "${ROOTS[@]}"; do
    [ -e "$r" ] || continue
    grep -r -a -h -o -E 'pk_live_[A-Za-z0-9_-]{16,}' -- "$r" 2>/dev/null
  done | sort -u
}

b64_decode() { # tolerant of missing padding
  local s="$1" pad=$(((4 - ${#1} % 4) % 4)) i=0
  while [ "$i" -lt "$pad" ]; do s="${s}="; i=$((i + 1)); done
  printf '%s' "$s" | base64 -d 2>/dev/null || true
}

HITS=0
HITS_DETAIL=""

# =============================================================================
echo "=============================================================="
echo " GROWIMO PRE-DEPLOY-GATE (fail-closed) — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo " Repo : $ROOT"
printf ' Roots:'; for r in "${ROOTS[@]}"; do printf ' %s' "$r"; done; echo
FCOUNT=0
for r in "${ROOTS[@]}"; do
  [ -d "$r" ] && FCOUNT=$((FCOUNT + $(find "$r" -type f | wc -l | tr -d ' ')))
done
printf ' Dateien im Scan: %s\n' "$FCOUNT"
echo "=============================================================="

# --- (a) PFLICHT: Production-Publishable-Key --------------------------------
echo "(a) PFLICHT: Production-Publishable-Key enthalten"
scan_hits "$PROD_KEY_LITERAL"; a_lit="$HITS"; a_lit_detail="$HITS_DETAIL"
scan_hits "$PROD_KEY_DOMAIN";  a_dom="$HITS"; a_dom_detail="$HITS_DETAIL"
decoded_hit=""
decoded_all=""
while IFS= read -r v; do
  [ -n "$v" ] || continue
  dec="$(b64_decode "${v#pk_live_}")"
  [ -n "$dec" ] || continue
  decoded_all="${decoded_all}${decoded_all:+ | }$dec"
  case "$dec" in
    *"$PROD_KEY_DOMAIN"*) decoded_hit="$dec" ;;
  esac
done < <(collect_pk_live_values)

if [ "$a_lit" -gt 0 ]; then
  pass "(a) Production-Key-Literal ${PROD_KEY_LITERAL} : ${a_lit} Treffer ${a_lit_detail}"
  [ -n "$decoded_hit" ] && pass "(a) pk_live_-Wert dekodiert zu '${decoded_hit}' (Production-Instanz bestaetigt)"
elif [ -n "$decoded_hit" ]; then
  pass "(a) Production-Key ueber dekodierten pk_live_-Wert belegt: '${decoded_hit}' (kein Literal-Match)"
elif [ "$a_dom" -gt 0 ]; then
  pass "(a) '${PROD_KEY_DOMAIN}' im Bundle: ${a_dom} Treffer ${a_dom_detail} (Fallback-Kriterium)"
else
  fail "(a) KEIN PRODUCTION-KEY im Bundle — weder '${PROD_KEY_LITERAL}', noch ein dekodierter pk_live_-Wert auf '${PROD_KEY_DOMAIN}', noch '${PROD_KEY_DOMAIN}'"
  [ -n "$decoded_all" ] && echo "        dekodierte pk_live_-Werte: ${decoded_all}"
fi

# --- (b) VERBOTEN: Dev-Key-WERT (nicht der pk_test_ Prefix!) ----------------
echo "(b) VERBOTEN: Dev-Key-WERT ${DEV_KEY_VALUE}… (NICHT der pk_test_ Prefix — Bibliothekskonstante)"
scan_hits "$DEV_KEY_VALUE"; b_hits="$HITS"; b_detail="$HITS_DETAIL"
if [ "$b_hits" -eq 0 ]; then
  pass "(b) Dev-Key-WERT nicht im Bundle: 0 Treffer"
else
  fail "(b) DEV-KEY-WERT im Bundle: ${b_hits} Treffer ${b_detail}"
fi

# --- (c) VERBOTEN: Dev-Clerk-Instanz-Marker ---------------------------------
echo "(c) VERBOTEN: Dev-Clerk-Instanz-Marker '${DEV_INSTANCE_EXACT}' / '${DEV_INSTANCE_ANY}'"
scan_hits "$DEV_INSTANCE_EXACT"; c1="$HITS"; c1_detail="$HITS_DETAIL"
if [ "$c1" -eq 0 ]; then
  pass "(c) '${DEV_INSTANCE_EXACT}' nicht im Bundle: 0 Treffer"
else
  fail "(c) '${DEV_INSTANCE_EXACT}' im Bundle: ${c1} Treffer ${c1_detail}"
fi
scan_hits "$DEV_INSTANCE_ANY"; c2="$HITS"; c2_detail="$HITS_DETAIL"
if [ "$c2" -eq 0 ]; then
  pass "(c2) '${DEV_INSTANCE_ANY}' (jede Dev-Instanz) nicht im Bundle: 0 Treffer"
else
  fail "(c2) '${DEV_INSTANCE_ANY}' im Bundle: ${c2} Treffer ${c2_detail}"
fi

# --- (d) VERBOTEN: alte Dev-Owner-ID ----------------------------------------
echo "(d) VERBOTEN: alte Dev-Owner-ID ${OLD_OWNER_ID}"
scan_hits "$OLD_OWNER_ID"; d_hits="$HITS"; d_detail="$HITS_DETAIL"
if [ "$d_hits" -eq 0 ]; then
  pass "(d) Dev-Owner-ID nicht im Bundle: 0 Treffer"
else
  fail "(d) DEV-OWNER-ID im Bundle: ${d_hits} Treffer ${d_detail}"
fi

# --- (e) PFLICHT: neue Production-Owner-ID ---------------------------------
echo "(e) PFLICHT: Production-Owner-ID ${NEW_OWNER_ID}"
scan_hits "$NEW_OWNER_ID"; e_hits="$HITS"; e_detail="$HITS_DETAIL"
if [ "$e_hits" -gt 0 ]; then
  pass "(e) Production-Owner-ID im Bundle: ${e_hits} Treffer ${e_detail}"
elif [ "$GATE_OWNER_ID" = "warn" ]; then
  echo "  WARN  (e) Production-Owner-ID fehlt (GATE_OWNER_ID=warn — bewusst herabgestuft)"
else
  fail "(e) Production-Owner-ID fehlt im Bundle: 0 Treffer (GATE_OWNER_ID=warn stuft das herab)"
fi

# =============================================================================
echo "--------------------------------------------------------------"
if [ "$FAILS" -eq 0 ]; then
  echo "GATE: GRUEN — Production-Bundle sauber, Deploy erlaubt."
  echo "=============================================================="
  exit 0
fi
echo ""
echo "ABBRUCH: Development-Key im Production-Bundle — Deploy verweigert"
echo "GATE: ROT — ${FAILS} Kriterium/Kriterien verletzt."
echo ""
echo "Behebung: Production-Build mit expliziter Build-Env erzeugen,"
echo "  export VITE_CLERK_PUBLISHABLE_KEY=${PROD_KEY_LITERAL}"
echo "  bash build-vercel.sh   # (baut neu und laesst diesen Gate erneut laufen)"
echo "=============================================================="
exit 1
