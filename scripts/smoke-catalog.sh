#!/usr/bin/env bash
# Catalog & Staff smoke tests — run while the dev server is up.
# Usage: bash scripts/smoke-catalog.sh
set -u

BASE="${BASE:-http://localhost:4000}"
ADMIN_EMAIL="admin@salonshop.app"
ADMIN_PASS="Admin123!"
BODY="$(mktemp)"
PASSED=0
FAILED=0

check() {
  if [ "$2" = "$3" ]; then
    echo "✅ $1 (got $3)"; PASSED=$((PASSED+1))
  else
    echo "❌ $1 — expected $2, got $3"; FAILED=$((FAILED+1))
  fi
}

req() { # method path [token] [json]
  local method=$1 path=$2 token=${3:-} json=${4:-}
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$json" ] && args+=(-H 'Content-Type: application/json' -d "$json")
  curl "${args[@]}"
}

jget() { # file path.to.field -> value
  node -e '
    const [file, path] = process.argv.slice(1);
    let o;
    try { o = JSON.parse(require("fs").readFileSync(file, "utf8")); }
    catch { console.log(""); process.exit(0); }
    const v = path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
    console.log(v === undefined || v === null ? "" : String(v));
  ' "$1" "$2"
}

jlen() { # file path.to.array -> length
  node -e '
    const [file, path] = process.argv.slice(1);
    let o;
    try { o = JSON.parse(require("fs").readFileSync(file, "utf8")); }
    catch { console.log("-1"); process.exit(0); }
    const v = path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
    console.log(Array.isArray(v) ? v.length : -1);
  ' "$1" "$2"
}

echo "── Public catalog ────────────────────────────"

CODE=$(req GET /api/catalog/categories)
check "GET categories → 200" 200 "$CODE"
NAILS_ID=$(jget "$BODY" "$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const n=o.data.find(c=>c.name==="Nails");
  console.log(n ? "data."+(o.data.indexOf(n))+".id" : "");
' "$BODY")")
[ -n "$NAILS_ID" ] && check "found seeded Nails category" yes yes || check "found seeded Nails category" yes no

CODE=$(req GET /api/catalog/services)
check "GET services → 200" 200 "$CODE"
TOTAL=$(jlen "$BODY" data)
[ "$TOTAL" -ge 6 ] && check "seeded services present ($TOTAL)" yes yes || check "seeded services present" yes no

CODE=$(req GET "/api/catalog/services?categoryId=$NAILS_ID")
check "filter by category → 200" 200 "$CODE"
ONLY_NAILS=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(o.data.every(s=>s.category.name==="Nails")?"yes":"no");
' "$BODY")
check "filtered list only contains Nails services" yes "$ONLY_NAILS"

echo "── Public staff ──────────────────────────────"

CODE=$(req GET /api/staff)
check "GET staff → 200" 200 "$CODE"
STAFF_COUNT=$(jlen "$BODY" data)
[ "$STAFF_COUNT" -ge 3 ] && check "seeded stylists listed ($STAFF_COUNT)" yes yes || check "seeded stylists listed" yes no
HAS_RATING=$([ -n "$(jget "$BODY" data.0.rating.count)" ] && echo yes || echo no)
check "staff cards include rating summary" yes "$HAS_RATING"

MARIA=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const m=o.data.find(s=>s.fullName==="Maria Chen");
  console.log(m?m.id:"");
' "$BODY")

CODE=$(req GET "/api/staff/$MARIA")
check "GET staff detail → 200" 200 "$CODE"
check "detail includes skills array" yes "$([ "$(jlen "$BODY" data.services)" -ge 1 ] && echo yes || echo no)"
check "detail includes portfolio array" yes "$([ "$(jlen "$BODY" data.portfolio)" -ge 1 ] && echo yes || echo no)"

CODE=$(req GET "/api/staff/$MARIA/portfolio")
check "GET portfolio → 200" 200 "$CODE"

CODE=$(req GET "/api/staff/00000000-0000-4000-8000-000000000000")
check "unknown stylist → 404" 404 "$CODE"

echo "── Admin guards ──────────────────────────────"

CODE=$(req GET /api/admin/catalog/services)
check "admin route without token → 401" 401 "$CODE"

STAMP=$(date +%s)
CODE=$(req POST /api/auth/register "" "{\"fullName\":\"Guard Tester\",\"email\":\"guard-$STAMP@example.com\",\"password\":\"Passw0rd!123\"}")
CUSTOMER_TOKEN=$(jget "$BODY" data.accessToken)

CODE=$(req GET /api/admin/catalog/services "$CUSTOMER_TOKEN")
check "admin route as customer → 403 forbidden" 403 "$CODE"

echo "── Admin catalog CRUD ────────────────────────"

CODE=$(req POST /api/auth/login "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(jget "$BODY" data.accessToken)
[ -n "$ADMIN_TOKEN" ] && check "admin login works" yes yes || check "admin login works" yes no

CODE=$(req POST /api/admin/catalog/categories "$ADMIN_TOKEN" '{"name":"Spa & Wellness","displayOrder":2}')
check "create category → 201" 201 "$CODE"
CAT_ID=$(jget "$BODY" data.id)

CODE=$(req POST /api/admin/catalog/categories "$ADMIN_TOKEN" '{"name":"Spa & Wellness"}')
check "duplicate category name → 409" 409 "$CODE"

CODE=$(req PATCH "/api/admin/catalog/categories/$CAT_ID" "$ADMIN_TOKEN" '{"name":"Spa & Relax"}')
check "rename category → 200" 200 "$CODE"

CODE=$(req POST /api/admin/catalog/services "$ADMIN_TOKEN" \
  "{\"categoryId\":\"$CAT_ID\",\"name\":\"Aromatherapy Massage\",\"description\":\"Full-body relaxation\",\"basePrice\":45,\"baseDurationMin\":60}")
check "create service → 201" 201 "$CODE"
SVC_ID=$(jget "$BODY" data.id)

CODE=$(req PATCH "/api/admin/catalog/services/$SVC_ID" "$ADMIN_TOKEN" '{"basePrice":50}')
check "update price → 200" 200 "$CODE"

CODE=$(req GET /api/catalog/services)
PRICE_SHOWN=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const svc=o.data.find(s=>s.id===process.argv[2]);
  console.log(svc&&Number(svc.basePrice)===50?"yes":"no");
' "$BODY" "$SVC_ID")
check "public list reflects new price" yes "$PRICE_SHOWN"

CODE=$(req DELETE "/api/admin/catalog/categories/$CAT_ID" "$ADMIN_TOKEN")
check "soft-delete category → 200" 200 "$CODE"

req GET /api/catalog/categories > /dev/null
GONE=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(o.data.some(c=>c.name==="Spa & Relax")?"still-visible":"hidden");
' "$BODY")
check "deleted category hidden from public" hidden "$GONE"

echo "── Admin staff management ────────────────────"

CODE=$(req POST /api/admin/staff "$ADMIN_TOKEN" \
  "{\"fullName\":\"Tom Nguyen\",\"email\":\"tom-$STAMP@salonshop.app\",\"password\":\"Stylist123!\",\"title\":\"Massage Therapist\",\"commissionRate\":42,\"workingHours\":[{\"weekday\":1,\"startMinute\":540,\"endMinute\":1020}]}")
check "create staff (user+profile+hours) → 201" 201 "$CODE"
TOM_ID=$(jget "$BODY" data.id)

CODE=$(req POST /api/admin/staff "$ADMIN_TOKEN" \
  "{\"fullName\":\"Tom Duplicate\",\"email\":\"tom-$STAMP@salonshop.app\",\"password\":\"Stylist123!\"}")
check "duplicate staff email → 409" 409 "$CODE"

req GET /api/staff > /dev/null
VISIBLE=$(node -e '
  const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(o.data.some(s=>s.fullName==="Tom Nguyen")?"yes":"no");
' "$BODY")
check "new stylist appears publicly" yes "$VISIBLE"

CODE=$(req PUT "/api/admin/staff/$TOM_ID/working-hours" "$ADMIN_TOKEN" \
  '{"hours":[{"weekday":2,"startMinute":600,"endMinute":1140},{"weekday":3,"startMinute":600,"endMinute":1140},{"weekday":4,"startMinute":600,"endMinute":1140},{"weekday":5,"startMinute":600,"endMinute":1140},{"weekday":6,"startMinute":600,"endMinute":1080}]}')
check "replace working hours → 200" 200 "$CODE"
check "new schedule has 5 days" 5 "$(jlen "$BODY" data)"

CODE=$(req PUT "/api/admin/staff/$TOM_ID/working-hours" "$ADMIN_TOKEN" \
  '{"hours":[{"weekday":1,"startMinute":900,"endMinute":500}]}')
check "invalid hours rejected → 422" 422 "$CODE"

CODE=$(req PATCH "/api/admin/staff/$TOM_ID" "$ADMIN_TOKEN" '{"isBookable":false}')
check "toggle isBookable → 200" 200 "$CODE"

BOOKABLE=$(req GET "/api/staff/$TOM_ID" >/dev/null; jget "$BODY" data.isBookable)
check "public detail reflects isBookable=false" false "$BOOKABLE"

CODE=$(req POST "/api/admin/staff/$TOM_ID/portfolio" "$ADMIN_TOKEN" \
  '{"imageUrl":"https://picsum.photos/seed/spa1/600/800","caption":"Calm setup"}')
check "add portfolio item → 201" 201 "$CODE"
ITEM_ID=$(jget "$BODY" data.id)

CODE=$(req DELETE "/api/admin/staff/portfolio/$ITEM_ID" "$ADMIN_TOKEN")
check "remove portfolio item → 200" 200 "$CODE"

rm -f "$BODY"
echo
echo "═══ Results: $PASSED passed, $FAILED failed ═══"
exit $((FAILED > 0 ? 1 : 0))
