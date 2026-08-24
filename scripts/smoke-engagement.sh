#!/usr/bin/env bash
# Engagement module smoke tests (reviews, loyalty, rewards).
# Usage: bash scripts/smoke-engagement.sh   (server must be running)
set -u

BASE="${BASE:-http://localhost:4000}"
BODY="$(mktemp)"
PASSED=0
FAILED=0

check() {
  if [ "$2" = "$3" ]; then echo "✅ $1 (got $3)"; PASSED=$((PASSED+1));
  else echo "❌ $1 — expected $2, got $3"; FAILED=$((FAILED+1)); fi
}

req() {
  local method=$1 path=$2 token=${3:-} json=${4:-}
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$json" ] && args+=(-H 'Content-Type: application/json' -d "$json")
  curl "${args[@]}"
}

jget() {
  node -e '
    const [file, path] = process.argv.slice(1);
    let o;
    try { o = JSON.parse(require("fs").readFileSync(file, "utf8")); }
    catch { console.log(""); process.exit(0); }
    const v = path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
    console.log(v === undefined || v === null ? "" : String(v));
  ' "$1" "$2"
}

jcontains() { # file path substring -> yes/no
  node -e '
    const [f,p,v]=process.argv.slice(1);
    try{
      const o=JSON.parse(require("fs").readFileSync(f,"utf8"));
      const t=p.split(".").reduce((a,k)=>a?.[k],o);
      console.log(String(JSON.stringify(t)).includes(v)?"yes":"no");
    }catch{console.log("no")}
  ' "$1" "$2" "$3"
}

STAMP=$(date +%s)

echo "── Setup ─────────────────────────────────────"

# Distinct date (2+ days out, never Sunday) so we don't collide with
# other suites' slots; self-clean it first for repeatable runs.
DATE=$(node -e 'const d=new Date();d.setDate(d.getDate()+2);do{}while(false);while(d.getDay()===0)d.setDate(d.getDate()+1);console.log(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)')
docker exec salon-shop-db psql -U salon -d salon_shop -q -c \
  "DELETE FROM reviews WHERE appointment_id IN (SELECT id FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59');
   DELETE FROM loyalty_transactions WHERE appointment_id IN (SELECT id FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59');
   DELETE FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59';" >/dev/null
echo "   testing against date: $DATE"

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Engage Tester\",\"email\":\"engage-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
CTOKEN=$(jget "$BODY" data.accessToken)
req GET /api/auth/me "$CTOKEN" >/dev/null
CID=$(jget "$BODY" data.user.id)
check "customer registered" yes "$([ -n "$CID" ] && echo yes || echo no)"

req POST /api/auth/login "" '{"email":"maria@salonshop.app","password":"Stylist123!"}' >/dev/null
MTOKEN=$(jget "$BODY" data.accessToken)
req POST /api/auth/login "" '{"email":"admin@salonshop.app","password":"Admin123!"}' >/dev/null
ATOKEN=$(jget "$BODY" data.accessToken)

req GET "/api/catalog/services" >/dev/null
BLOWOUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.name==="Blowout Styling").id)' "$BODY")
req GET "/api/staff" >/dev/null
MARIA_ID=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.fullName==="Maria Chen").id)' "$BODY")

echo "── Completed visit (walk-in → COMPLETED) ─────"

CODE=$(req POST /api/bookings/walk-in "$MTOKEN" \
  "{\"customerId\":\"$CID\",\"serviceId\":\"$BLOWOUT\",\"scheduledFor\":\"${DATE}T13:00\"}")
check "walk-in created → 201" 201 "$CODE"
WID=$(jget "$BODY" data.id)

CODE=$(req PATCH "/api/bookings/appointments/$WID/status" "$MTOKEN" '{"status":"COMPLETED"}')
check "visit completed → 200" 200 "$CODE"

echo "── Loyalty balance & history ─────────────────"

CODE=$(req GET /api/loyalty/balance "$CTOKEN")
check "balance endpoint → 200" 200 "$CODE"
B=$(jget "$BODY" data.balance)
[ "$B" -ge 10 ] && check "points earned from visit (balance=$B)" yes yes || check "points earned from visit" yes no

CODE=$(req GET /api/loyalty/history "$CTOKEN")
check "history shows EARNED entry" yes "$(jcontains "$BODY" data.items '"type":"EARNED"')"

echo "── Reviews ────────────────────────────────────"

CODE=$(req POST /api/reviews "$CTOKEN" \
  "{\"appointmentId\":\"$WID\",\"rating\":5,\"comment\":\"Maria is a magician with a blowout!\"}")
check "review created → 201" 201 "$CODE"
RID=$(jget "$BODY" data.id)

CODE=$(req POST /api/reviews "$CTOKEN" "{\"appointmentId\":\"$WID\",\"rating\":4}")
check "duplicate review → 409" 409 "$CODE"

CODE=$(req POST /api/reviews "$CTOKEN" "{\"appointmentId\":\"$WID\",\"rating\":7}")
check "rating out of range → 422" 422 "$CODE"

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Snoop Guy\",\"email\":\"snoop5-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
SNOOP=$(jget "$BODY" data.accessToken)
CODE=$(req POST /api/reviews "$SNOOP" "{\"appointmentId\":\"$WID\",\"rating\":1,\"comment\":\"not mine\"}")
check "cannot review others' visit → 403" 403 "$CODE"

CODE=$(req GET "/api/reviews/staff/$MARIA_ID")
check "public review list → 200" 200 "$CODE"
check "review visible publicly" yes "$(jcontains "$BODY" data.items 'blowout')"
FIRST_NAME=$(jget "$BODY" data.items.0.customerFirstName)
check "privacy: first name only ($FIRST_NAME)" yes "$(node -e 'console.log(process.argv[1].trim().split(/\s+/).length===1?"yes":"no")' "$FIRST_NAME")"

CODE=$(req POST "/api/reviews/$RID/reply" "$MTOKEN" '{"reply":"Thank you! See you soon."}')
check "staff reply → 200" 200 "$CODE"
check "reply stored" "Thank you! See you soon." "$(jget "$BODY" data.staffReply)"

CODE=$(req POST "/api/reviews/$RID/reply" "$SNOOP" '{"reply":"fake reply"}')
check "outsider cannot reply → 403" 403 "$CODE"

CODE=$(req PATCH "/api/reviews/$RID" "$CTOKEN" '{"rating":4}')
check "author edits own rating → 200" 200 "$CODE"
check "edited to 4" "4" "$(jget "$BODY" data.rating)"

CODE=$(req DELETE "/api/reviews/$RID" "$SNOOP")
check "outsider cannot delete review → 403" 403 "$CODE"

echo "── Rewards & redemption ───────────────────────"

CODE=$(req GET /api/loyalty/rewards "$CTOKEN")
check "rewards list → 200" 200 "$CODE"
REWARD_COUNT=$(jget "$BODY" data.length 2>/dev/null || echo 0)
REWARD_COUNT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.length)' "$BODY")
[ "$REWARD_COUNT" -ge 3 ] && check "seeded rewards present ($REWARD_COUNT)" yes yes || check "seeded rewards present" yes no
FREE_HAIRCUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(r=>r.name==="Free Signature Haircut")?.id ?? "")' "$BODY")

CODE=$(req POST "/api/loyalty/rewards/$FREE_HAIRCUT/redeem" "$CTOKEN")
check "redeem without points → 409" 409 "$CODE"
check "helpful shortfall message" yes "$(jcontains "$BODY" message 'Not enough points')"

CODE=$(req POST /api/admin/loyalty/adjust "$CTOKEN" "{\"customerId\":\"$CID\",\"points\":9999}")
check "customer cannot adjust points → 403" 403 "$CODE"

CODE=$(req POST /api/admin/loyalty/adjust "$ATOKEN" "{\"customerId\":\"$CID\",\"points\":200,\"description\":\"Goodwill bonus\"}")
check "admin grants +200 → 201" 201 "$CODE"
check "newBalance reported = $((B+200))" "$((B+200))" "$(jget "$BODY" data.newBalance)"

CODE=$(req POST /api/admin/loyalty/adjust "$ATOKEN" "{\"customerId\":\"$CID\",\"points\":0}")
check "zero-point adjustment rejected → 422" 422 "$CODE"

CODE=$(req POST /api/admin/rewards "$ATOKEN" \
  '{"name":"Combo Special","pointsCost":50,"serviceId":"00000000-0000-4000-8000-00000000dead","discountPct":15}')
check "service+discount combo rejected → 422" 422 "$CODE"

CODE=$(req POST /api/admin/rewards "$ATOKEN" '{"name":"Combo Special","pointsCost":50,"discountPct":15}')
check "create reward → 201" 201 "$CODE"
COMBO=$(jget "$BODY" data.id)

CODE=$(req POST "/api/loyalty/rewards/$COMBO/redeem" "$CTOKEN")
check "redeem Combo (50pts) → 201" 201 "$CODE"
EXPECTED_LEFT=$(( B + 200 - 50 ))
check "remainingBalance = $EXPECTED_LEFT" "$EXPECTED_LEFT" "$(jget "$BODY" data.remainingBalance)"
VOUCHER=$(jget "$BODY" data.voucherId)

CODE=$(req GET /api/loyalty/redemptions "$CTOKEN")
check "my vouchers list → 200" 200 "$CODE"
check "voucher ISSUED" ISSUED "$(jget "$BODY" data.items.0.status)"

CODE=$(req PATCH "/api/loyalty/redemptions/$VOUCHER/use" "$MTOKEN")
check "staff marks voucher USED → 200" 200 "$CODE"
check "usedAt stamped" yes "$([ -n "$(jget "$BODY" data.usedAt)" ] && echo yes || echo no)"

CODE=$(req PATCH "/api/loyalty/redemptions/$VOUCHER/use" "$MTOKEN")
check "double-use blocked → 409" 409 "$CODE"

CODE=$(req POST "/api/loyalty/rewards/00000000-0000-4000-8000-00000000dead/redeem" "$CTOKEN")
check "unknown reward → 404" 404 "$CODE"

CODE=$(req DELETE "/api/admin/rewards/$COMBO" "$ATOKEN")
check "deactivate reward → 200" 200 "$CODE"

req GET /api/loyalty/rewards "$CTOKEN" >/dev/null
GONE=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(o.data.some(r=>r.id===process.argv[2])?"still-visible":"hidden");
' "$BODY" "$COMBO")
check "deactivated reward hidden from customers" hidden "$GONE"

CODE=$(req GET /api/loyalty/history "$CTOKEN")
check "history logs REDEEMED spend" yes "$(jcontains "$BODY" data.items '"type":"REDEEMED"')"

rm -f "$BODY"
echo
echo "═══ Results: $PASSED passed, $FAILED failed ═══"
exit $((FAILED > 0 ? 1 : 0))
