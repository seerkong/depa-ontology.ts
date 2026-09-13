#!/usr/bin/env bash
# Smoke-test Ontology Workshop APIs against a running example-server.
# Exits non-zero on any failure.
#
# Usage:
#   API_BASE=http://127.0.0.1:4175 ./scripts/smoke-workshop-apis.sh
#
# Four checks (CRM happy path):
#   1. GET /api/demos
#   2. GET /api/demos/crm/projection
#   3. GET /api/demos/crm/objects/Opportunity
#   4. GET /api/demos/crm/objects/Opportunity/:id

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:4175}"
API_BASE="${API_BASE%/}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

need_cmd curl
need_cmd python3

curl_json() {
  local path="$1"
  local url="${API_BASE}${path}"
  local body http_code
  body="$(mktemp)"
  http_code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 60 "$url" || true)"
  if [[ "$http_code" != "200" ]]; then
    echo "--- response body ---" >&2
    cat "$body" >&2 || true
    rm -f "$body"
    fail "HTTP $http_code for $url"
  fi
  cat "$body"
  rm -f "$body"
}

echo "Workshop API smoke → ${API_BASE}"

# 1) demos list
demos_json="$(curl_json "/api/demos")"
echo "$demos_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
demos=d.get("demos") or []
assert isinstance(demos, list) and len(demos)>=1, "demos empty"
ids={x.get("id") for x in demos}
assert "crm" in ids, "crm demo missing"
print("OK 1/4 GET /api/demos (%d demos)" % len(demos))
'

# 2) CRM projection
proj_json="$(curl_json "/api/demos/crm/projection")"
echo "$proj_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("status")=="ok", d.get("error") or "projection not ok"
p=d.get("projection") or {}
types=p.get("types") or []
rels=p.get("relations") or []
assert len(types)>=6, "expected >=6 CRM types, got %d" % len(types)
assert len(rels)>=6, "expected >=6 CRM relations, got %d" % len(rels)
names={t.get("name") for t in types}
assert "Opportunity" in names and "Lead" in names
print("OK 2/4 GET /api/demos/crm/projection (types=%d relations=%d)" % (len(types), len(rels)))
'

# 3) CRM Opportunity list
list_json="$(curl_json "/api/demos/crm/objects/Opportunity")"
entity_id="$(echo "$list_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("status")=="ok", d.get("error") or "list not ok"
ents=d.get("entities") or []
assert len(ents)>=1, "Opportunity list empty"
# Prefer known demo id when present
ids=[e.get("id") for e in ents if e.get("id")]
pref="opp:acme-renew"
print(pref if pref in ids else ids[0])
')"
echo "$list_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ents=d.get("entities") or []
print("OK 3/4 GET /api/demos/crm/objects/Opportunity (%d entities)" % len(ents))
'

# 4) CRM Opportunity detail
detail_path="/api/demos/crm/objects/Opportunity/$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$entity_id")"
detail_json="$(curl_json "$detail_path")"
echo "$detail_json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("status")=="ok", d.get("error") or "detail not ok"
e=d.get("entity") or {}
assert e.get("id"), "entity.id missing"
assert e.get("typeName")=="Opportunity", "unexpected typeName"
assert isinstance(e.get("properties"), dict)
assert isinstance(e.get("outgoing"), list)
assert isinstance(e.get("incoming"), list)
print("OK 4/4 GET detail for %s" % e.get("id"))
'

echo "ALL GREEN — workshop APIs smoke passed"
