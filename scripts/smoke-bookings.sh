#!/usr/bin/env bash
# Booking engine smoke tests — run while the dev server is up.
# Usage: bash scripts/smoke-bookings.sh
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

jhas() { # file path value -> yes/no  (array membership or substring)
  node -e '
    const [f,p,v]=process.argv.slice(1);
    try{
      const o=JSON.parse(require("fs").readFileSync(f,"utf8"));
      const t=p.split(".").reduce((a,k)=>a?.[k],o);
      const hit=Array.isArray(t)?t.map(String).includes(v):String(t??"")===v;
      console.log(hit?"yes":"no");
    }catch{console.log("no")}
  ' "$1" "$2" "$3"
}

jnot_has() {
  R=$(jhas "$1" "$2" "$3"); [ "$R" = "no" ] && echo yes || echo no
}

STAMP=$(date +%s)

echo "── Setup ─────────────────────────────────────"

DATE=$(node -e 'const d=new Date();do{d.setDate(d.getDate()+1)}while(d.getDay()===0);console.log(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)')
echo "   testing against date: $DATE"

# Idempotency: wipe this date's test appointments (and their loyalty rows)
# so the suite can run repeatedly against the same database.
if [ "${SKIP_CLEAN:-0}" != "1" ]; then
  docker exec salon-shop-db psql -U salon -d salon_shop -q -c \
    "DELETE FROM loyalty_transactions WHERE appointment_id IN (SELECT id FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59');
     DELETE FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59';" >/dev/null
fi

req GET "/api/catalog/services" >/dev/null
HAIRCUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.name==="Signature Haircut").id)' "$BODY")
BLOWOUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.name==="Blowout Styling").id)' "$BODY")

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Book Tester\",\"email\":\"booker-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
CTOKEN=$(jget "$BODY" data.accessToken)
[ -n "$CTOKEN" ] && check "customer registered" yes yes || check "customer registered" yes no

req POST /api/auth/login "" '{"email":"maria@salonshop.app","password":"Stylist123!"}' >/dev/null
MTOKEN=$(jget "$BODY" data.accessToken)

req POST /api/auth/login "" '{"email":"admin@salonshop.app","password":"Admin123!"}' >/dev/null
ATOKEN=$(jget "$BODY" data.accessToken)

req POST /api/auth/login "" '{"email":"sara@example.com","password":"Customer123!"}' >/dev/null
SARA_TOKEN=$(jget "$BODY" data.accessToken)
req GET /api/auth/me "$SARA_TOKEN" >/dev/null
SARA_ID=$(jget "$BODY" data.user.id)

echo "── Availability (public) ─────────────────────"

CODE=$(req GET "/api/bookings/availability?serviceId=$HAIRCUT&date=$DATE")
check "availability → 200" 200 "$CODE"
check "slot grid includes 11:00" yes "$(jhas "$BODY" data.slots 11:00)"

CODE=$(req GET "/api/bookings/availability?serviceId=$HAIRCUT&date=bad-date")
check "invalid date → 422" 422 "$CODE"

echo "── Create bookings ───────────────────────────"

CODE=$(req POST /api/bookings/appointments "$CTOKEN" \
  "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T11:00\"}")
check "book haircut 11:00 (auto-assign) → 201" 201 "$CODE"
check "status CONFIRMED" CONFIRMED "$(jget "$BODY" data.status)"
check "price snapshot = 25" "25" "$(jget "$BODY" data.priceCharged)"
APPT1=$(jget "$BODY" data.id)
ASSIGNED=$(jget "$BODY" data.staff.fullName)
check "stylist auto-assigned ($ASSIGNED)" yes "$([ -n "$ASSIGNED" ] && echo yes || echo no)"

CODE=$(req POST /api/bookings/appointments "$CTOKEN" \
  "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T11:00\"}")
check "exact double-book → 409" 409 "$CODE"

CODE=$(req POST /api/bookings/appointments "$CTOKEN" \
  "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T11:30\"}")
check "overlapping 11:30 → 409" 409 "$CODE"

CODE=$(req GET "/api/bookings/availability?serviceId=$HAIRCUT&date=$DATE")
check "11:00 gone from availability" yes "$(jnot_has "$BODY" data.slots 11:00)"
check "buffer respected: 11:45 also gone" yes "$(jnot_has "$BODY" data.slots 11:45)"
check "12:00 still offered" yes "$(jhas "$BODY" data.slots 12:00)"

echo "── Access control ────────────────────────────"

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Snoop Tester\",\"email\":\"snoop-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
SNOOP=$(jget "$BODY" data.accessToken)

CODE=$(req GET "/api/bookings/appointments/$APPT1" "$SNOOP")
check "stranger cannot view my booking → 403" 403 "$CODE"

CODE=$(req POST /api/bookings/walk-in "$CTOKEN" "{\"customerId\":\"$SARA_ID\",\"serviceId\":\"$BLOWOUT\",\"scheduledFor\":\"${DATE}T14:00\"}")
check "customer cannot create walk-in → 403" 403 "$CODE"

CODE=$(req GET "/api/bookings/schedule?date=$DATE" "$CTOKEN")
check "customer cannot view schedule → 403" 403 "$CODE"

echo "── Reschedule & cancel ───────────────────────"

CODE=$(req POST /api/bookings/appointments "$CTOKEN" \
  "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T16:00\"}")
APPT2=$(jget "$BODY" data.id)
check "second booking 16:00 → 201" 201 "$CODE"

CODE=$(req PATCH "/api/bookings/appointments/$APPT2/reschedule" "$CTOKEN" \
  "{\"scheduledFor\":\"${DATE}T17:00\"}")
check "reschedule 16:00 → 17:00" 200 "$CODE"

# Expected endsAt = salon-local 17:00 + 45min haircut, rendered as UTC ISO
EXPECT_END=$(node -e '
  const s=process.argv[1];
  const [dt,t]=s.split("T");
  const [Y,M,D]=dt.split("-").map(Number);
  const [h,m]=t.split(":").map(Number);
  console.log(new Date(Y,M-1,D,h,m+45).toISOString());
' "${DATE}T17:00")
check "endsAt moved correctly ($EXPECT_END)" yes "$(jhas "$BODY" data.endsAt "$EXPECT_END")"

req GET "/api/bookings/availability?serviceId=$HAIRCUT&date=$DATE" >/dev/null
check "old 16:00 slot released" yes "$(jhas "$BODY" data.slots 16:00)"

CODE=$(req PATCH "/api/bookings/appointments/$APPT2/cancel" "$ATOKEN" '{"reason":"salon closed early"}')
check "admin cancels customer booking → 200" 200 "$CODE"
check "cancelledBy ADMIN" ADMIN "$(jget "$BODY" data.cancelledBy)"

CODE=$(req PATCH "/api/bookings/appointments/$APPT2/cancel" "$CTOKEN" '{}')
check "cancel twice → 409" 409 "$CODE"

echo "── Walk-ins & staff tools ────────────────────"

CODE=$(req POST /api/bookings/walk-in "$MTOKEN" \
  "{\"customerId\":\"$SARA_ID\",\"serviceId\":\"$BLOWOUT\",\"scheduledFor\":\"${DATE}T14:00\"}")
check "staff walk-in for Sara → 201" 201 "$CODE"
check "source WALK_IN" WALK_IN "$(jget "$BODY" data.source)"
WALKIN1=$(jget "$BODY" data.id)

# 14:45 = previous walk-in end (14:30) + 15-min cleanup buffer
CODE=$(req POST /api/bookings/walk-in "$MTOKEN" \
  "{\"customerName\":\"Quick Guest\",\"phone\":\"+1555$STAMP\",\"serviceId\":\"$BLOWOUT\",\"scheduledFor\":\"${DATE}T14:45\"}")
check "guest walk-in (name only) → 201" 201 "$CODE"

CODE=$(req POST /api/bookings/walk-in "$MTOKEN" \
  "{\"customerId\":\"$SARA_ID\",\"serviceId\":\"$BLOWOUT\",\"scheduledFor\":\"${DATE}T14:10\"}")
check "walk-in into busy slot → 409" 409 "$CODE"

CODE=$(req GET "/api/bookings/schedule?date=$DATE" "$MTOKEN")
check "staff daily schedule → 200" 200 "$CODE"
check "schedule shows today's items" yes "$([ "$(jget "$BODY" data.summary.total)" -ge 2 ] && echo yes || echo no)"

echo "── Status lifecycle & loyalty ────────────────"

CODE=$(req PATCH "/api/bookings/appointments/$WALKIN1/status" "$MTOKEN" '{"status":"COMPLETED"}')
check "mark walk-in COMPLETED → 200" 200 "$CODE"

# Exactly-once per appointment — scoped to THIS visit so historic
# completions from earlier runs never skew the count.
EARNED=$(docker exec salon-shop-db psql -U salon -d salon_shop -tAc \
  "SELECT COUNT(*) FROM loyalty_transactions WHERE appointment_id='$WALKIN1' AND type='EARNED';")
check "loyalty +10 awarded exactly once" 1 "$EARNED"

CODE=$(req PATCH "/api/bookings/appointments/$WALKIN1/status" "$MTOKEN" '{"status":"CANCELLED","reason":"oops"}')
check "COMPLETED is terminal → 409" 409 "$CODE"

rm -f "$BODY"
echo
echo "═══ Results: $PASSED passed, $FAILED failed ═══"
exit $((FAILED > 0 ? 1 : 0))
