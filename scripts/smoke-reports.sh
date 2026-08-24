#!/usr/bin/env bash
# Admin reports smoke tests. Usage: bash scripts/smoke-reports.sh
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

STAMP=$(date +%s)

echo "── Setup ─────────────────────────────────────"

CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Report Tester\",\"email\":\"report-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
CTOKEN=$(jget "$BODY" data.accessToken)
req GET /api/auth/me "$CTOKEN" >/dev/null
CID=$(jget "$BODY" data.user.id)

req POST /api/auth/login "" '{"email":"maria@salonshop.app","password":"Stylist123!"}' >/dev/null
MTOKEN=$(jget "$BODY" data.accessToken)
req POST /api/auth/login "" '{"email":"admin@salonshop.app","password":"Admin123!"}' >/dev/null
ATOKEN=$(jget "$BODY" data.accessToken)

req GET "/api/catalog/services" >/dev/null
HAIRCUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.name==="Signature Haircut").id)' "$BODY")
BLOWOUT=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.data.find(s=>s.name==="Blowout Styling").id)' "$BODY")

DATE=$(node -e 'const d=new Date();do{d.setDate(d.getDate()+1)}while(d.getDay()===0);console.log(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)')
docker exec salon-shop-db psql -U salon -d salon_shop -q -c \
  "DELETE FROM loyalty_transactions WHERE appointment_id IN (SELECT id FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59');
   DELETE FROM appointments WHERE scheduled_for >= '$DATE 00:00:00' AND scheduled_for < '$DATE 23:59:59';" >/dev/null
echo "   controlled test date: $DATE"

# Controlled activity: 2 completed (25 + 20), 1 cancelled
CODE=$(req POST /api/bookings/appointments "$CTOKEN" "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T11:00\"}")
A1=$(jget "$BODY" data.id)
CODE=$(req POST /api/bookings/walk-in "$MTOKEN" "{\"customerId\":\"$CID\",\"serviceId\":\"$BLOWOUT\",\"scheduledFor\":\"${DATE}T14:00\"}")
A2=$(jget "$BODY" data.id)
CODE=$(req POST /api/bookings/appointments "$CTOKEN" "{\"serviceId\":\"$HAIRCUT\",\"scheduledFor\":\"${DATE}T16:00\"}")
A3=$(jget "$BODY" data.id)
req PATCH "/api/bookings/appointments/$A1/status" "$MTOKEN" '{"status":"COMPLETED"}' >/dev/null
req PATCH "/api/bookings/appointments/$A2/status" "$MTOKEN" '{"status":"COMPLETED"}' >/dev/null
req PATCH "/api/bookings/appointments/$A3/cancel" "$ATOKEN" '{"reason":"test"}' >/dev/null

echo "── Guards ────────────────────────────────────"

CODE=$(curl -s -o "$BODY" -w '%{http_code}' "$BASE/api/admin/reports/overview")
check "overview without token → 401" 401 "$CODE"
CODE=$(req GET /api/admin/reports/overview "$CTOKEN")
check "overview as customer → 403" 403 "$CODE"

echo "── Overview ──────────────────────────────────"

CODE=$(req GET "/api/admin/reports/overview?from=$DATE&to=$DATE" "$ATOKEN")
check "overview (controlled day) → 200" 200 "$CODE"
check "revenue == 45" "45" "$(jget "$BODY" data.revenue)"
check "completed == 2" "2" "$(jget "$BODY" data.completedBookings)"
check "total bookings == 3" "3" "$(jget "$BODY" data.totalBookings)"
check "cancelled counted" yes "$(jcontains "$BODY" data.bookingsByStatus '"CANCELLED":1')"
check "avgTicket == 22.5" "22.5" "$(jget "$BODY" data.averageTicket)"

CODE=$(req GET /api/admin/reports/overview "$ATOKEN")
NEWCUST=$(jget "$BODY" data.newCustomers)
[ "${NEWCUST:-0}" -ge 1 ] && check "default range sees new customer ($NEWCUST)" yes yes || check "default range sees new customer" yes no

CODE=$(req GET "/api/admin/reports/overview?from=${DATE}&to=2020-01-01" "$ATOKEN")
check "reversed range → 422" 422 "$CODE"

echo "── Revenue series ────────────────────────────"

CODE=$(req GET "/api/admin/reports/revenue?from=$DATE&to=$DATE&groupBy=day" "$ATOKEN")
check "revenue series → 200" 200 "$CODE"
check "one day bucket" 1 "$(jget "$BODY" data.series.length)"
check "series revenue == 45" "45" "$(jget "$BODY" data.totalRevenue)"
check "series bookings == 3" "3" "$(jget "$BODY" data.totalBookings)"

CODE=$(req GET "/api/admin/reports/revenue?from=$DATE&to=$DATE&groupBy=month" "$ATOKEN")
check "month bucketing works" 1 "$(jget "$BODY" data.series.length)"

echo "── Top services ──────────────────────────────"

CODE=$(req GET "/api/admin/reports/top-services?from=$DATE&to=$DATE" "$ATOKEN")
check "top services → 200" 200 "$CODE"
check "haircut present w/ correct stats" yes "$(jcontains "$BODY" data.items '{"serviceId":"'$HAIRCUT'","name":"Signature Haircut","category":"Hair","bookings":1,"revenue":25}')"
check "blowout present" yes "$(jcontains "$BODY" data.items '"Blowout Styling"')"

SORTED=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const r=o.data.items.map(i=>i.revenue);
  console.log(r.every((v,i)=>i===0||r[i-1]>=v)?"yes":"no");
' "$BODY")
check "sorted by revenue desc" yes "$SORTED"

CODE=$(req GET "/api/admin/reports/top-services?from=$DATE&to=$DATE&limit=1" "$ATOKEN")
check "limit respected" 1 "$(jget "$BODY" data.items.length)"

echo "── Staff performance ─────────────────────────"

CODE=$(req GET "/api/admin/reports/staff-performance?from=$DATE&to=$DATE" "$ATOKEN")
check "staff performance → 200" 200 "$CODE"

MARIA_ROW=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const m=o.data.items.find(i=>i.fullName==="Maria Chen");
  console.log(m?JSON.stringify(m):"");

' "$BODY")
check "Maria row exists" yes "$([ -n "$MARIA_ROW" ] && echo yes || echo no)"
check "completed == 2" "2" "$(node -e 'console.log(JSON.parse(process.argv[1]).completedBookings)' "$MARIA_ROW")"
check "revenue == 45" "45" "$(node -e 'console.log(JSON.parse(process.argv[1]).revenue)' "$MARIA_ROW")"
check "commission @40% == 18" "18" "$(node -e 'console.log(JSON.parse(process.argv[1]).estimatedCommission)' "$MARIA_ROW")"
check "cancelled attributed == 1" "1" "$(node -e 'console.log(JSON.parse(process.argv[1]).cancelledBookings)' "$MARIA_ROW")"

UTIL=$(node -e 'console.log(JSON.parse(process.argv[1]).utilizationPct ?? -1)' "$MARIA_ROW")
[ "$UTIL" -ge 1 ] && [ "$UTIL" -le 100 ] && check "utilization sane ($UTIL%)" yes yes || check "utilization sane" yes no

rm -f "$BODY"
echo
echo "═══ Results: $PASSED passed, $FAILED failed ═══"
exit $((FAILED > 0 ? 1 : 0))
