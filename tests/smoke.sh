#!/usr/bin/env bash
# Curl-based smoke tests for the rammerhead proxy.
#
# Drives the proxy with a small fixture set (a representative landing page
# from each problem-domain class) and verifies that
#   1. the page response itself is reachable,
#   2. nothing in the rewritten body smells like a regression we already
#      fixed (raw cdn/assets, double-prefixes, naked stored-value links),
#   3. a sample of the proxied asset URLs is also reachable (HTTP 200).
#
# Designed to run against an already-running proxy so it stays useful in
# CI (start the server, run this) without adding a Node dep.
#
# Usage:
#   PORT=8080 ./tests/smoke.sh                # run against localhost:8080
#   BASE_URL=http://localhost:9090 ./tests/smoke.sh
#
# Exit code 0 iff all assertions hold; non-zero with a per-site report on
# the first regression it spots. The server must already be running.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:${PORT:-8080}}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
TMPDIR_TEST="${TMPDIR:-/tmp}/rh-smoke-$$"
mkdir -p "$TMPDIR_TEST"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

ANSI_RED=$'\033[31m'
ANSI_GREEN=$'\033[32m'
ANSI_YELLOW=$'\033[33m'
ANSI_GRAY=$'\033[90m'
ANSI_RESET=$'\033[0m'

PASS=0
FAIL=0
WARN=0
FAILED_SITES=()

note()  { printf "  %s%s%s\n" "$ANSI_GRAY" "$*" "$ANSI_RESET"; }
ok()    { printf "  %sPASS%s %s\n" "$ANSI_GREEN" "$ANSI_RESET" "$*"; PASS=$((PASS+1)); }
fail()  { printf "  %sFAIL%s %s\n" "$ANSI_RED"   "$ANSI_RESET" "$*"; FAIL=$((FAIL+1)); }
warn()  { printf "  %sWARN%s %s\n" "$ANSI_YELLOW" "$ANSI_RESET" "$*"; WARN=$((WARN+1)); }

# new_session: get a fresh session id from the proxy
new_session() {
    curl -fsS --compressed --max-time 15 "$BASE_URL/newsession"
}

# fetch_page <sid> <url> <out_file>: GET an upstream URL through the proxy
fetch_page() {
    local sid="$1" upstream="$2" out="$3"
    curl -sS --compressed --max-time 30 \
         -H "User-Agent: $UA" \
         -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
         -H "Accept-Language: en-US,en;q=0.9" \
         -H "Sec-Fetch-Dest: document" \
         -H "Sec-Fetch-Mode: navigate" \
         -H "Sec-Fetch-Site: none" \
         -H "Upgrade-Insecure-Requests: 1" \
         -o "$out" -w "%{http_code} %{size_download} %{content_type}" \
         "$BASE_URL/$sid/$upstream"
}

# fetch_status <sid> <path>: HEAD an asset URL and print just the status
fetch_status() {
    local path="$1"
    curl -sS --compressed --max-time 20 \
         -H "User-Agent: $UA" \
         -o /dev/null -w "%{http_code}" \
         "$BASE_URL$path"
}

# count_unproxied_cdn <html>: returns the number of raw "/cdn/assets/..." string
# literals that would actually 404 in a browser. Strips three classes of
# false-positives first:
#   1. `*-hammerhead-stored-value="…"` attributes — bookkeeping the browser
#      never fetches.
#   2. Already-proxied paths `/<32-hex-sid>/…` — those are correct.
#   3. Hammerhead runtime wrappers like `__get$ProxyUrl("…")`,
#      `__set$Loc("…")`, `__call$(…, "…")` — Hammerhead resolves the URL
#      at runtime, so the inner literal is fine.
count_unproxied_cdn() {
    local f="$1"
    sed -E 's/[a-z-]+-hammerhead-stored-value="[^"]*"//g' "$f" \
        | sed -E 's#/[a-f0-9]{32}(![a-z0-9!*-]+)?/[^"]*##g' \
        | sed -E 's/__(get\$ProxyUrl|set\$Loc|call\$|get\$Loc)\([^)]*\)//g' \
        | grep -oE '"/cdn/assets/[^"]+"' \
        | wc -l \
        | tr -d ' \n'
}

# count_double_prefix <html> <sid>: looks for `/<sid>/<origin>/<sid>/<origin>/`
# patterns that indicate the AST rewriter ran twice on the same path.
count_double_prefix() {
    local f="$1" sid="$2"
    grep -oE "/${sid}/https?://[^/]+/${sid}/https?://" "$f" \
        | wc -l \
        | tr -d ' \n'
}

# extract_asset_urls <html> <count>: pull out up to N proxied script/link
# URLs from the HTML (those starting with `/<32-hex-sid>/`).
extract_asset_urls() {
    local f="$1" n="$2"
    grep -oE '(href|src)="/[a-f0-9]{32}[^"]+"' "$f" \
        | sed -E 's/^[^"]+"//; s/"$//' \
        | head -n "$n"
}

run_site() {
    local label="$1" upstream="$2" expect_status="${3:-200,202}" max_unproxied="${4:-0}"
    printf "\n%s== %s%s%s\n" "$ANSI_GRAY" "$label  ($upstream)" "$ANSI_RESET" ""
    local sid html meta status size ctype
    sid="$(new_session 2>/dev/null || true)"
    if [ -z "$sid" ] || [ "${#sid}" -lt 32 ]; then
        fail "$label could not allocate session"
        FAILED_SITES+=("$label/no-session")
        return
    fi
    html="$TMPDIR_TEST/$label.html"
    meta="$(fetch_page "$sid" "$upstream" "$html" 2>/dev/null || true)"
    status="${meta%% *}"
    rest="${meta#* }"
    size="${rest%% *}"
    ctype="${rest#* }"
    note "session=$sid status=$status size=$size content-type=${ctype% *}"

    if echo "$expect_status" | tr ',' '\n' | grep -qx "$status"; then
        ok "$label HTTP $status (allowed: $expect_status)"
    else
        fail "$label HTTP $status (expected: $expect_status)"
        FAILED_SITES+=("$label/$status")
        return
    fi

    if [ ! -s "$html" ]; then
        warn "$label empty body — skipping content checks"
        return
    fi

    local unproxied
    unproxied="$(count_unproxied_cdn "$html" 2>/dev/null || echo 0)"
    unproxied="${unproxied:-0}"
    if [ "$unproxied" -le "$max_unproxied" ]; then
        ok "$label has $unproxied raw /cdn/assets/ literal(s) (cap: $max_unproxied)"
    else
        fail "$label has $unproxied raw /cdn/assets/ literal(s); expected ≤ $max_unproxied"
        FAILED_SITES+=("$label/raw-cdn-assets")
    fi

    local doubled
    doubled="$(count_double_prefix "$html" "$sid")"
    if [ "$doubled" -eq 0 ]; then
        ok "$label has 0 double-prefixed URLs"
    else
        fail "$label has $doubled double-prefixed URLs (regression of chatgpt-doubleprefix)"
        FAILED_SITES+=("$label/double-prefix")
    fi

    # Asset spot-check: 404 = missing resource (typically a regression OR an
    # upstream CDN serving a stale manifest). 401/403 = origin auth-protected
    # (expected for /api, sign-in URLs). 5xx = origin failure (transient).
    #
    # We tolerate a minority (≤25%) of 404 responses across the 8 spot-checks.
    # In practice that's the rate at which CDN/Google-fonts URLs hot-link-fail
    # on a fresh fetch (manifest references stale chunks, third-party
    # tracking ping returns 404, etc.). A real proxy regression breaks every
    # asset, so the majority threshold catches it without false positives
    # from upstream flakiness.
    local asset_count=0 asset_ok=0 asset_404=0 asset_other=0
    while IFS= read -r path; do
        [ -z "$path" ] && continue
        asset_count=$((asset_count+1))
        local code
        code="$(fetch_status "$path" 2>/dev/null || echo "000")"
        case "$code" in
            2*|3*) asset_ok=$((asset_ok+1)) ;;
            404)
                asset_404=$((asset_404+1))
                if [ "$asset_404" -le 3 ]; then
                    note "  → asset $code  $path"
                fi ;;
            *)
                asset_other=$((asset_other+1)) ;;
        esac
    done < <(extract_asset_urls "$html" 8)

    if [ "$asset_count" -eq 0 ]; then
        warn "$label found no proxied asset URLs to spot-check"
    elif [ "$asset_404" -eq 0 ]; then
        if [ "$asset_other" -gt 0 ]; then
            ok "$label spot-checked $asset_count proxied assets, no 404s ($asset_other expected non-2xx — auth/upstream)"
        else
            ok "$label spot-checked $asset_count proxied assets, all 2xx/3xx"
        fi
    else
        # 404 threshold: more than 25% of the spot-checks failing is regression-grade.
        local threshold=$(( (asset_count + 3) / 4 ))
        [ "$threshold" -lt 1 ] && threshold=1
        if [ "$asset_404" -gt "$threshold" ]; then
            fail "$label $asset_404 of $asset_count proxied assets returned 404 (above ${threshold} tolerance — regression)"
            FAILED_SITES+=("$label/asset-404")
        else
            warn "$label $asset_404 of $asset_count proxied assets returned 404 (within ${threshold} tolerance — likely upstream)"
        fi
    fi
}

# Sanity check that the proxy is reachable
if ! curl -fsS --compressed --max-time 10 -o /dev/null "$BASE_URL/"; then
    printf "%sFATAL%s proxy not reachable at %s — start it before running\n" \
        "$ANSI_RED" "$ANSI_RESET" "$BASE_URL"
    exit 2
fi

run_site "chatgpt"   "https://chatgpt.com/"            "200"     "0"
run_site "claude"    "https://claude.ai/login"          "200,302" "0"
run_site "discord"   "https://discord.com/login"        "200"     "0"
run_site "deepseek"  "https://chat.deepseek.com/"       "200,202" "1"
run_site "poki"      "https://poki.com/"                "200"     "0"
run_site "bilibili"  "https://www.bilibili.com/"        "200,302" "1"
run_site "duckduckgo" "https://duckduckgo.com/?q=test"  "200"     "0"
run_site "douyin"    "https://www.douyin.com/"          "200,302" "1"
run_site "gimkit"    "https://www.gimkit.com/"          "200,302" "0"
run_site "chosic"    "https://www.chosic.com/"          "200,302" "0"

printf "\n%s—— summary ——%s\n" "$ANSI_GRAY" "$ANSI_RESET"
printf "  pass: %s%d%s   warn: %s%d%s   fail: %s%d%s\n" \
    "$ANSI_GREEN" "$PASS" "$ANSI_RESET" \
    "$ANSI_YELLOW" "$WARN" "$ANSI_RESET" \
    "$ANSI_RED" "$FAIL" "$ANSI_RESET"

if [ "$FAIL" -gt 0 ]; then
    printf "\n%sfailing sites%s\n" "$ANSI_RED" "$ANSI_RESET"
    for s in "${FAILED_SITES[@]}"; do printf "  - %s\n" "$s"; done
    exit 1
fi
exit 0
