#!/usr/bin/env bash
# Mobile-E2E Station 0: Login auf www.growimo.app im Mobile-Viewport (393x852, DPR 2).
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
mkdir -p "$SHOT"
TICKET=$(cat /tmp/autosave-ticket.txt)

ab() { agent-browser --session "$S" "$@"; }

echo "=== set viewport ==="
ab set viewport 393 852 2
ab set media light

echo "=== open sign-in ==="
ab open "https://www.growimo.app/app/sign-in?__clerk_ticket=${TICKET}"
sleep 14

echo "=== probe ==="
ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,uid:(window.Clerk&&window.Clerk.user&&window.Clerk.user.id)||null,bodyLen:t.length,cp:t.includes('verifying your browser')||t.includes('Failed to verify')||t.includes('Security Checkpoint')})})()"

echo "=== screenshot ==="
ab screenshot "$SHOT/m01-dashboard.png"
ab eval "JSON.stringify({vw:window.innerWidth,vh:window.innerHeight,dpr:window.devicePixelRatio})"
echo "LOGIN_DONE"
