#!/usr/bin/env bash
# Notifications module smoke tests. Usage: bash scripts/smoke-notifications.sh
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

jcontains() {
  node -e '
    const [f,p,v]=process.argv.slice(1);
    try{
      const o=JSON.parse(require("fs").readFileSync(f,"utf8"));
      const t=p.split(".").reduce((a,k)=>a?.[k],o);
      console.log(String(JSON.stringify(t)).includes(v)?"yes":"no");
    }catch{console.log("no")}
  ' "$1" "$2" "$3"
}

# Fire-and-forget notifications land a beat later — poll briefly.
wait_contains() { # token path value -> 0/1
  local token=$1 path=$2 val=$3 i
  for i in $(seq 1 20); do
    req GET /api/notifications "$token" >/dev/null
    [ "$(jcontains "$BODY" "$path" "$val")" = yes ] && return 0
    sleep 0.3
  done
  return 1
}

STAMP=$(date +%s)
FTOK="fcm-test-token-$STAMP-abcdefghijklmnop"

echo "── Setup ─────────────────────────────────────"

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Notif Tester\",\"email\":\"notif-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
CTOKEN=$(jget "$BODY" data.accessToken)
req GET /api/auth/me "$CTOKEN" >/dev/null
CID=$(jget "$BODY" data.user.id)

req POST /api/auth/login "" '{"email":"maria@salonshop.app","password":"Stylist123!"}' >/dev/null
MTOKEN=$(jget "$BODY" data.accessToken)
req POST /api/auth/login "" '{"email":"admin@salonshop.app","password":"Admin123!"}' >/dev/null
ATOKEN=$(jget "$BODY" data.accessToken)

req GET "/api/catalog/services" >/dev/null
HAIRCUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.name==="Signature Haircut").id)' "$BODY")

DATE=$(node -e 'const d=new Date();do{d.setDate(d.getDate()+1)}while(d.getDay()===0);console.log(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)')
docker exec salon-shop-db psql -U salon -d salon_shop -q -c \
  "DELETE FROM loyalty_transactions WHERE appointment_id IN (SELECT id FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59');
   DELETE FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59';" >/dev/null

echo "── Device registration ───────────────────────"

CODE=$(req POST /api/notifications/devices "$CTOKEN" "{\"fcmToken\":\"$FTOK\",\"platform\":\"ANDROID\"}")
check "register device → 201" 201 "$CODE"

CODE=$(req POST /api/notifications/devices "$CTOKEN" "{\"fcmToken\":\"$FTOK\",\"platform\":\"ANDROID\"}")
check "re-register same token → 201 (upsert)" 201 "$CODE"
req GET /api/notifications/devices "$CTOKEN" >/dev/null
check "still exactly one device row" 1 "$(jget "$BODY" data.length)"

CODE=$(req POST /api/notifications/devices "$CTOKEN" "{\"fcmToken\":\"another-token-$STAMP-qrstuvwxyz\",\"platform\":\"WINDOWS\"}")
check "invalid platform → 422" 422 "$CODE"

CODE=$(req PATCH /api/notifications/read-all "$CTOKEN")
check "baseline: mark-all-read → 200" 200 "$CODE"

echo "── Booking events trigger notifications ──────"

CODE=$(req POST /api/bookings/appointments "$CTOKEN" \
  "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T11:00\"}")
check "book haircut → 201" 201 "$CODE"
APPT1=$(jget "$BODY" data.id)

if wait_contains "$CTOKEN" data.items.0.title 'booked'; then check "booking notification arrives" yes yes; else check "booking notification arrives" yes no; fi
check "type=booking_created" yes "$(jcontains "$BODY" data.items.0.data.type booking_created)"
check "carries appointmentId" yes "$(jcontains "$BODY" data.items.0.data.appointmentId "$APPT1")"
check "unreadCount incremented" yes "$([ "$(jget "$BODY" data.unreadCount)" -ge 1 ] && echo yes || echo no)"

PUSHES=$(grep -c '\[push:simulated\]' /tmp/salon-server.log 2>/dev/null || echo 0)
[ "${PUSHES:-0}" -ge 1 ] && check "push dispatched to device ($PUSHES simulated sends)" yes yes || check "push dispatched to device" yes no

CODE=$(req PATCH "/api/bookings/appointments/$APPT1/cancel" "$ATOKEN" '{"reason":"emergency closing"}')
check "admin cancels → 200" 200 "$CODE"

if wait_contains "$CTOKEN" data.items.0.title 'cancelled'; then check "cancellation reaches customer" yes yes; else check "cancellation reaches customer" yes no; fi

CODE=$(req POST /api/bookings/appointments "$CTOKEN" \
  "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T16:00\"}")
APPT2=$(jget "$BODY" data.id)
req PATCH "/api/bookings/appointments/$APPT2/reschedule" "$CTOKEN" "{\"scheduledFor\":\"${DATE}T17:00\"}" >/dev/null

if wait_contains "$MTOKEN" data.items.0.title 'rescheduled'; then check "STAFF sees reschedule event" yes yes; else check "STAFF sees reschedule event" yes no; fi

echo "── Notification center ───────────────────────"

req GET /api/notifications "$CTOKEN" >/dev/null
FIRST_ID=$(jget "$BODY" data.items.0.id)
CODE=$(req PATCH "/api/notifications/$FIRST_ID/read" "$CTOKEN")
check "mark one read → 200" 200 "$CODE"
check "readAt stamped" yes "$([ -n "$(jget "$BODY" data.readAt)" ] && echo yes || echo no)"

CODE=$(req GET /api/notifications "$CTOKEN")
UNREAD_AFTER=$(jget "$BODY" data.unreadCount)
TOTAL_N=$(jget "$BODY" data.total)

CODE=$(req PATCH "/api/notifications/read-all" "$CTOKEN")
req GET /api/notifications "$CTOKEN" >/dev/null
check "read-all zeroes unread ($TOTAL_N total)" 0 "$(jget "$BODY" data.unreadCount)"

CODE=$(curl -s -o "$BODY" -w '%{http_code}' -X PATCH "$BASE/api/notifications/$FIRST_ID/read")
check "unauthenticated read-mark → 401" 401 "$CODE"

echo "── Isolation & cleanup ───────────────────────"

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Isol Tester\",\"email\":\"isol-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
SNOOP=$(jget "$BODY" data.accessToken)
req GET /api/notifications "$SNOOP" >/dev/null
LEAK=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(JSON.stringify(o.data.items).includes(process.argv[2])?"leaked":"clean");
' "$BODY" "$APPT1")
check "other users see none of my notifications" clean "$LEAK"

CODE=$(req DELETE /api/notifications/devices "$CTOKEN" "{\"fcmToken\":\"$FTOK\"}")
check "remove device → 200" 200 "$CODE"
req GET /api/notifications/devices "$CTOKEN" >/dev/null
check "device list empty" 0 "$(jget "$BODY" data.length)"

rm -f "$BODY"
echo
echo "═══ Results: $PASSED passed, $FAILED failed ═══"
exit $((FAILED > 0 ? 1 : 0))
