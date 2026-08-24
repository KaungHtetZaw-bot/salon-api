#!/usr/bin/env bash
# Auth module smoke tests — run while the dev server is up.
# Usage: BASE=http://localhost:4000 bash scripts/smoke-auth.sh
set -u

BASE="${BASE:-http://localhost:4000}"
EMAIL="smoke-$(date +%s)@example.com"
PHONE="+1555$(date +%s)"   # unique per run — phone has a UNIQUE index
PASS="Passw0rd!123"
BODY="$(mktemp)"
PASSED=0
FAILED=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then
    echo "✅ $1 (got $3)"; PASSED=$((PASSED+1))
  else
    echo "❌ $1 — expected $2, got $3"; FAILED=$((FAILED+1))
  fi
}

post() { # path json -> http_code (response body in $BODY)
  curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE$1" \
    -H 'Content-Type: application/json' -d "$2"
}

get_auth() { # path token -> http_code
  curl -s -o "$BODY" -w '%{http_code}' "$BASE$1" -H "Authorization: Bearer $2"
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

REG_PAYLOAD="{\"fullName\":\"Smoke Tester\",\"email\":\"$EMAIL\",\"phone\":\"$PHONE\",\"password\":\"$PASS\"}"

echo "── Register ──────────────────────────────────"

CODE=$(post /api/auth/register "$REG_PAYLOAD")
check "register → 201" 201 "$CODE"
check "register auto-login returns accessToken" yes "$([ -n "$(jget "$BODY" data.accessToken)" ] && echo yes || echo no)"

ACCESS=$(jget "$BODY" data.accessToken)
REFRESH=$(jget "$BODY" data.refreshToken)

CODE=$(post /api/auth/register "$REG_PAYLOAD")
check "duplicate email → 409 conflict" 409 "$CODE"

CODE=$(post /api/auth/register '{"fullName":"X","email":"bad","password":"short"}')
check "invalid payload → 422 validation" 422 "$CODE"

echo "── Login ─────────────────────────────────────"

CODE=$(post /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"WrongPass123!\"}")
check "wrong password → 401" 401 "$CODE"

CODE=$(post /api/auth/login "{\"email\":\"nobody-$RANDOM@x.com\",\"password\":\"Whatever123!\"}")
check "unknown email → identical 401 (no enumeration)" 401 "$CODE"

CODE=$(post /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
check "login → 200" 200 "$CODE"
check "login returns tokens" yes "$([ -n "$(jget "$BODY" data.accessToken)" ] && [ -n "$(jget "$BODY" data.refreshToken)" ] && echo yes || echo no)"

echo "── /me ───────────────────────────────────────"

CODE=$(curl -s -o "$BODY" -w '%{http_code}' "$BASE/api/auth/me")
check "me without token → 401" 401 "$CODE"

CODE=$(get_auth /api/auth/me "$ACCESS")
check "me with token → 200" 200 "$CODE"
check "me returns the right email" "$EMAIL" "$(jget "$BODY" data.user.email)"

echo "── Refresh rotation ──────────────────────────"

CODE=$(post /api/auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
check "refresh → 200" 200 "$CODE"
NEW_REFRESH=$(jget "$BODY" data.refreshToken)
[ -n "$NEW_REFRESH" ] && [ "$NEW_REFRESH" != "$REFRESH" ] \
  && check "old token replaced by a new one" yes yes \
  || check "old token replaced by a new one" yes no

CODE=$(post /api/auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
check "REPLAY old token → 401 (reuse detected)" 401 "$CODE"

CODE=$(post /api/auth/refresh "{\"refreshToken\":\"$NEW_REFRESH\"}")
check "newer token also dead → whole session family revoked" 401 "$CODE"

echo "── Logout ────────────────────────────────────"

CODE=$(post /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
check "fresh login → 200" 200 "$CODE"
A4=$(jget "$BODY" data.accessToken)
R4=$(jget "$BODY" data.refreshToken)

CODE=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/auth/logout" \
  -H "Authorization: Bearer $A4" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$R4\"}")
check "logout → 200" 200 "$CODE"

CODE=$(post /api/auth/refresh "{\"refreshToken\":\"$R4\"}")
check "refresh after logout → 401" 401 "$CODE"

rm -f "$BODY"
echo
echo "═══ Results: $PASSED passed, $FAILED failed ═══"
exit $((FAILED > 0 ? 1 : 0))
