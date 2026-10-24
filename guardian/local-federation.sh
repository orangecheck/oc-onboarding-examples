#!/usr/bin/env bash
# A local, throwaway Fedimint federation of four guardians on Bitcoin regtest,
# run with orangecheck's guardian kit (oc-guardian). Everything listens on 127.0.0.1.
#
#   local-federation.sh up     [work-dir]   download, verify, start bitcoind and 4 guardians, run the DKG ceremony
#   local-federation.sh status [work-dir]   each guardian's phase and session count
#   local-federation.sh pegin  [work-dir]   deposit regtest coins through an Esplora STAND-IN (see esplora_stand_in.py)
#   local-federation.sh down   [work-dir]   stop every process this work dir started
#
# work-dir defaults to ./.federation. Nothing is written outside it (gh keeps its own attestation cache).
# BASE_PORT (default 28600) picks the ports BASE_PORT..BASE_PORT+49; each must be free, and below the
# kernel's ephemeral range, where any outgoing connection could take one.
# To skip a download, point these at binaries you have already verified:
#   BITCOIND, BITCOIN_CLI    Bitcoin Core's bitcoind and bitcoin-cli
#   OC_GUARDIAN              oc-guardian 0.2.8
#   FEDIMINTD_BUNDLE         the fedimintd 0.11.4 release file (its pinned sha256 is still checked)
#   FEDIMINT_CLI_BUNDLE      the fedimint-cli 0.11.4 release file (its pinned sha256 is still checked)
# PEGIN_BTC (default 0.01) is the amount pegin deposits.
set -euo pipefail

KIT_VERSION=0.2.8
KIT_REPO=orangecheck/oc-guardian-kit
KIT_TARGET=x86_64-unknown-linux-gnu
KIT_SHA256=4eba86436914094e7a6ea45ed9cfe8c51b2545e41cc1ec769de9e1e5f080445e
FEDIMINT_VERSION=0.11.4
# The kit pins this in install.rs; it matches GitHub's published digest.
FEDIMINTD_SHA256=52b36e81d7bab75c2e3f243566c1ad3dffe4978120d433cc96f1a5d51f62451a
# GitHub's published digest for the fedimint-cli-v0.11.4 release asset.
FEDIMINT_CLI_SHA256=6da5c9716ee02a43031bc575af9cc31fee3e5c9dea36992eb0ea0ba088ba0481
BITCOIN_VERSION=31.1
# From SHA256SUMS, whose signatures were checked against the guix.sigs builder keys.
BITCOIN_SHA256=b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e
FED_NAME=local-regtest
GUARDIANS=4

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-}"
WD="${2:-./.federation}"

die() { echo "error: $*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
need() { for c in "$@"; do command -v "$c" >/dev/null || die "this needs $c"; done; }
sha_ok() { [ -f "$1" ] && [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ]; }
get() { curl -fsSL --proto '=https' --tlsv1.2 --retry 2 -o "$2" "$1"; }
alive() { kill -0 "$1" 2>/dev/null; }
started_at() { sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20; }

ports() { P_RPC=$((BASE_PORT)) P_ESPLORA=$((BASE_PORT + 1)); }
gport() { echo $((BASE_PORT + 10 + 10 * $1 + $2)); }  # guardian i: +0 p2p, +1 api, +2 ui, +3 metrics

all_ports() {
  echo "$P_RPC $P_ESPLORA"
  for i in $(seq 0 $((GUARDIANS - 1))); do echo "$(gport "$i" 0) $(gport "$i" 1) $(gport "$i" 2) $(gport "$i" 3)"; done
}

check_ports_free() {
  local busy p lo hi
  if read -r lo hi </proc/sys/net/ipv4/ip_local_port_range 2>/dev/null; then
    [ $((BASE_PORT + 49)) -lt "$lo" ] || [ "$BASE_PORT" -gt "$hi" ] \
      || die "ports $BASE_PORT..$((BASE_PORT + 49)) overlap the ephemeral range $lo-$hi; pick a BASE_PORT below $((lo - 50))"
  fi
  busy="$(ss -Hltn | awk '{print $4}' | sed 's/.*://' | sort -u)"
  for p in $(all_ports); do
    ! grep -qx "$p" <<<"$busy" || die "port $p is in use; pick another BASE_PORT"
  done
}

# Run a command in its own session, log it, and record its pid (also its process group).
launch() {
  local name="$1" log="$2"; shift 2
  setsid "$@" >"$log" 2>&1 </dev/null &
  LAST_PID=$!
  echo "$name $LAST_PID $(started_at "$LAST_PID")" >>"$WD/pids"
}

wait_for() {  # seconds, pid that must stay alive (or -), description, command...
  local deadline=$((SECONDS + $1)) pid="$2" what="$3"; shift 3
  until "$@" >/dev/null 2>&1; do
    [ "$pid" = - ] || alive "$pid" || die "process $pid exited while waiting for $what (see $WD/logs)"
    [ $SECONDS -lt $deadline ] || die "timed out waiting for $what"
    sleep 2
  done
}

# ---------------------------------------------------------------- binaries

fetch_bitcoin() {
  if [ -n "${BITCOIND:-}" ]; then
    [ -n "${BITCOIN_CLI:-}" ] || die "set BITCOIN_CLI along with BITCOIND"
    return
  fi
  local dl="$WD/dl-bitcoin-core" x="$WD/x-bitcoin-core" tgz="bitcoin-$BITCOIN_VERSION-x86_64-linux-gnu.tar.gz"
  local base="https://bitcoincore.org/bin/bitcoin-core-$BITCOIN_VERSION"
  if ! sha_ok "$dl/$tgz" "$BITCOIN_SHA256" || [ ! -x "$x/bitcoin-$BITCOIN_VERSION/bin/bitcoind" ]; then
    say "downloading Bitcoin Core $BITCOIN_VERSION"
    rm -rf "$dl" "$x" && mkdir -p "$dl" "$x"
    get "$base/$tgz" "$dl/$tgz"
    get "$base/SHA256SUMS" "$dl/SHA256SUMS"
    sha_ok "$dl/$tgz" "$BITCOIN_SHA256" || die "$tgz does not match its pinned sha256"
    grep -qx "$BITCOIN_SHA256  $tgz" "$dl/SHA256SUMS" || die "SHA256SUMS does not list the pinned sha256"
    tar -xzf "$dl/$tgz" -C "$x" "bitcoin-$BITCOIN_VERSION/bin/bitcoind" "bitcoin-$BITCOIN_VERSION/bin/bitcoin-cli"
  fi
  BITCOIND="$x/bitcoin-$BITCOIN_VERSION/bin/bitcoind"
  BITCOIN_CLI="$x/bitcoin-$BITCOIN_VERSION/bin/bitcoin-cli"
  say "  bitcoind      $BITCOIN_SHA256 (sha256 of $tgz, listed in SHA256SUMS)"
}

fetch_kit() {
  if [ -z "${OC_GUARDIAN:-}" ]; then
    local dl="$WD/dl-oc-guardian" x="$WD/x-oc-guardian" tgz="oc-guardian-$KIT_TARGET.tar.gz"
    local base="https://github.com/$KIT_REPO/releases/download/v$KIT_VERSION"
    if ! sha_ok "$dl/$tgz" "$KIT_SHA256" || [ ! -x "$x/oc-guardian" ]; then
      say "downloading oc-guardian $KIT_VERSION"
      rm -rf "$dl" "$x" && mkdir -p "$dl" "$x"
      get "$base/$tgz" "$dl/$tgz"
      get "$base/$tgz.sha256" "$dl/$tgz.sha256"
      sha_ok "$dl/$tgz" "$KIT_SHA256" || die "$tgz does not match its pinned sha256"
      [ "$(cut -d' ' -f1 "$dl/$tgz.sha256")" = "$KIT_SHA256" ] || die "the release's .sha256 disagrees with the pin"
      if command -v gh >/dev/null; then
        gh attestation verify "$dl/$tgz" -R "$KIT_REPO" >"$dl/attestation.txt" 2>&1 \
          || die "gh attestation verify failed (see $dl/attestation.txt)"
        say "  oc-guardian   build provenance attestation verified (gh attestation verify)"
      else
        say "  oc-guardian   gh not found: the provenance attestation was not checked, only the sha256"
      fi
      tar -xzf "$dl/$tgz" -C "$x" oc-guardian
    fi
    OC_GUARDIAN="$x/oc-guardian"
    say "  oc-guardian   $KIT_SHA256 (sha256 of $tgz)"
  fi
  "$OC_GUARDIAN" --version | grep -qx "oc-guardian $KIT_VERSION" || die "$OC_GUARDIAN is not oc-guardian $KIT_VERSION"
}

# The pinned releases are nix bundles. Unpack one and write $WD/bin/<name>, which runs it.
unpack_bundle() {
  local bundle="$1" name="$2" x="$WD/x-$2"
  if [ ! -d "$x/dat/nix/store" ]; then
    rm -rf "$x" && mkdir -p "$x"
    (cd "$x" && sh "$bundle" --extract >/dev/null)
  fi
  mkdir -p "$WD/bin"
  python3 -I "$HERE/bundle_wrapper.py" "$x/dat/nix/store" "$name" "$WD/bin/$name"
  "$WD/bin/$name" --version | grep -qx "$name $FEDIMINT_VERSION" || die "$WD/bin/$name is not $name $FEDIMINT_VERSION"
}

fetch_fedimintd() {
  local bundle="${FEDIMINTD_BUNDLE:-}" dl="$WD/dl-fedimintd"
  if [ -z "$bundle" ]; then
    bundle="$dl/fedimintd"
    if ! sha_ok "$bundle" "$FEDIMINTD_SHA256"; then
      say "installing fedimintd $FEDIMINT_VERSION with the kit (pinned, hash-checked)"
      rm -rf "$dl" && mkdir -p "$dl"
      env -i PATH="$PATH" HOME="$HOME" NO_COLOR=1 "$OC_GUARDIAN" fedimintd install --version "$FEDIMINT_VERSION" --dir "$dl" >"$dl/install.log" 2>&1 \
        || die "oc-guardian fedimintd install failed (see $dl/install.log)"
    fi
  fi
  sha_ok "$bundle" "$FEDIMINTD_SHA256" || die "$bundle does not match the kit's pinned sha256"
  say "  fedimintd     $FEDIMINTD_SHA256 (the kit's pin)"
  unpack_bundle "$(realpath "$bundle")" fedimintd
}

fetch_fedimint_cli() {
  local bundle="${FEDIMINT_CLI_BUNDLE:-}" dl="$WD/dl-fedimint-cli"
  if [ -z "$bundle" ]; then
    bundle="$dl/fedimint-cli-v$FEDIMINT_VERSION"
    if ! sha_ok "$bundle" "$FEDIMINT_CLI_SHA256"; then
      say "downloading fedimint-cli $FEDIMINT_VERSION"
      rm -rf "$dl" && mkdir -p "$dl"
      get "https://github.com/fedimint/fedimint/releases/download/v$FEDIMINT_VERSION/fedimint-cli-v$FEDIMINT_VERSION" "$bundle"
    fi
  fi
  sha_ok "$bundle" "$FEDIMINT_CLI_SHA256" || die "$bundle does not match its pinned sha256"
  say "  fedimint-cli  $FEDIMINT_CLI_SHA256 (GitHub's published digest)"
  unpack_bundle "$(realpath "$bundle")" fedimint-cli
}

# ---------------------------------------------------------------- environments

# fedimintd publishes its API address to public pkarr relays after DKG unless this is false.
FM_ENV=(FM_PKARR_ENABLE=false NO_COLOR=1)

KIT=()
kit_env() {  # guardian index -> KIT=(env ... oc-guardian), the settings `fedimintd run` and `ceremony` read
  local i="$1" g="$WD/g$1"
  KIT=(env -i PATH="$PATH" HOME="$HOME" OC_GUARDIAN_CONFIG_DIR="$g/config" "${FM_ENV[@]}"
    OC_OPERATOR_ID="$(cat "$g/config/operator.id")"
    OC_OPERATOR_PUBKEY_HEX="$(cat "$g/config/operator.pub")"
    OC_FEDERATION_SLUG="$FED_NAME" OC_BITCOIN_NETWORK=regtest
    OC_BITCOIND_URL="http://127.0.0.1:$P_RPC" OC_BITCOIND_USERNAME=local OC_BITCOIND_PASSWORD="$(cat "$WD/rpcpass")"
    OC_PUBLIC_HOST=127.0.0.1 OC_P2P_PORT="$(gport "$i" 0)" OC_API_PORT="$(gport "$i" 1)" OC_UI_PORT="$(gport "$i" 2)"
    # Loopback binds keep the setup API off the network (README "Running fedimintd", second option).
    FM_BIND_P2P="127.0.0.1:$(gport "$i" 0)" FM_BIND_API="127.0.0.1:$(gport "$i" 1)"
    FM_BIND_METRICS="127.0.0.1:$(gport "$i" 3)" FM_DATA_DIR="$g/data"
    "$OC_GUARDIAN")
}
kit() { local i="$1"; shift; kit_env "$i"; "${KIT[@]}" "$@"; }

# The 0.11.4 client watches for deposits through an Esplora API only; pegin starts a stand-in for one.
cli_env() {
  CLI=(env -i PATH="$PATH" HOME="$HOME" "${FM_ENV[@]}" FM_CLIENT_DIR="$WD/client"
    FM_DEFAULT_BITCOIN_RPC_KIND=esplora FM_DEFAULT_BITCOIN_RPC_URL="http://127.0.0.1:$P_ESPLORA"
    "$WD/bin/fedimint-cli")
}
cli() { "${CLI[@]}" "$@" 2>>"$WD/logs/fedimint-cli.log"; }

btc() { "$BITCOIN_CLI" -datadir="$WD/bitcoind" "$@"; }

json() { python3 -I -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1:]: v=v[k]
print(v)' "$@"; }

load_state() {
  [ -f "$WD/state" ] || die "no federation in $WD; run up first"
  # shellcheck disable=SC1091
  . "$WD/state"
  ports; cli_env
}

# ---------------------------------------------------------------- up

up() {
  need curl sha256sum tar python3 ss setsid realpath od
  mkdir -p "$WD"
  WD="$(realpath "$WD")"
  if [ -f "$WD/pids" ]; then
    while read -r _ pid _; do alive "$pid" && die "$WD is already running (pid $pid); run down first"; done <"$WD/pids"
    rm -f "$WD/pids"
  fi
  [ ! -d "$WD/g0" ] || die "$WD holds an earlier federation; use a fresh work dir"
  BASE_PORT="${BASE_PORT:-28600}"
  ports; cli_env; check_ports_free
  mkdir -p "$WD/logs"
  trap '[ $? = 0 ] || [ ! -f "$WD/pids" ] || echo "up failed; stop what it started with: $0 down $WD" >&2' EXIT

  say "binaries (each download in its own new directory under $WD)"
  fetch_bitcoin; fetch_kit; fetch_fedimintd; fetch_fedimint_cli
  {
    echo "BASE_PORT=$BASE_PORT"
    printf 'BITCOIN_CLI=%q\nOC_GUARDIAN=%q\n' "$(realpath "$BITCOIN_CLI")" "$(realpath "$OC_GUARDIAN")"
  } >"$WD/state"
  BITCOIN_CLI="$(realpath "$BITCOIN_CLI")"

  say "bitcoind (regtest, rpc 127.0.0.1:$P_RPC, no p2p listener)"
  (umask 077 && head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$WD/rpcpass")
  mkdir -p "$WD/bitcoind"
  cat >"$WD/bitcoind/bitcoin.conf" <<EOF
regtest=1
[regtest]
server=1
txindex=1
listen=0
connect=0
dnsseed=0
fixedseeds=0
listenonion=0
fallbackfee=0.0002
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=$P_RPC
rpcuser=local
rpcpassword=$(cat "$WD/rpcpass")
EOF
  chmod 600 "$WD/bitcoind/bitcoin.conf"
  launch bitcoind "$WD/logs/bitcoind.log" "$BITCOIND" -datadir="$WD/bitcoind" -printtoconsole
  wait_for 60 "$LAST_PID" "bitcoind's RPC" btc getblockcount
  btc createwallet local >/dev/null
  btc generatetoaddress 101 "$(btc -rpcwallet=local getnewaddress)" >/dev/null
  say "  height $(btc getblockcount)"

  say "guardians"
  local i g gpids=()
  for i in $(seq 0 $((GUARDIANS - 1))); do
    g="$WD/g$i"
    mkdir -p "$g/config" "$g/data"
    (umask 077 && head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$g/password")
    env -i PATH="$PATH" HOME="$HOME" OC_GUARDIAN_CONFIG_DIR="$g/config" NO_COLOR=1 \
      "$OC_GUARDIAN" init --key-file "$g/operator.key" >"$WD/logs/g$i-init.log" 2>&1
    kit_env "$i"
    launch "guardian-g$i" "$WD/logs/g$i.log" "${KIT[@]}" fedimintd run --config "$WD/bin/fedimintd"
    gpids[i]=$LAST_PID
    say "  g$i  operator $(cat "$g/config/operator.id")  p2p :$(gport "$i" 0)  api :$(gport "$i" 1)  ui :$(gport "$i" 2)"
  done
  for i in $(seq 0 $((GUARDIANS - 1))); do
    wait_for 120 "${gpids[i]}" "g$i's setup API" phase_is "$i" "no local params yet"
  done

  say "DKG ceremony (oc-guardian ceremony start, add-peer, dkg, status, finalize)"
  local codes=() args=() pids=() j tag
  # fedimint derives the federation id from guardian names and API URLs; the tag keeps reruns from reusing one.
  tag="$(head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  for i in $(seq 0 $((GUARDIANS - 1))); do
    g="$WD/g$i"
    if [ "$i" = 0 ]; then args=(--leader --federation-name "$FED_NAME" --federation-size "$GUARDIANS"); else args=(); fi
    kit "$i" ceremony start --name "g$i-$tag" "${args[@]}" --password-file "$g/password" >>"$WD/logs/g$i-ceremony.log" 2>&1 \
      || die "ceremony start failed on g$i (see $WD/logs/g$i-ceremony.log)"
    codes[i]="$(json setup_code <"$g/data/oc-ceremony.json")"
  done
  for i in $(seq 0 $((GUARDIANS - 1))); do
    args=()
    for j in $(seq 0 $((GUARDIANS - 1))); do [ "$j" = "$i" ] || args+=(--code "${codes[j]}"); done
    kit "$i" ceremony add-peer "${args[@]}" --password-file "$WD/g$i/password" >>"$WD/logs/g$i-ceremony.log" 2>&1 \
      || die "ceremony add-peer failed on g$i (see $WD/logs/g$i-ceremony.log)"
  done
  # Every guardian starts DKG at about the same time; each waits for the others.
  for i in $(seq 0 $((GUARDIANS - 1))); do
    kit "$i" ceremony dkg --password-file "$WD/g$i/password" >>"$WD/logs/g$i-ceremony.log" 2>&1 &
    pids+=($!)
  done
  for i in $(seq 0 $((GUARDIANS - 1))); do
    wait "${pids[i]}" || die "ceremony dkg failed on g$i (see $WD/logs/g$i-ceremony.log)"
  done
  for i in $(seq 0 $((GUARDIANS - 1))); do
    wait_for 600 "${gpids[i]}" "g$i to finish DKG" phase_is "$i" "RUNNING"
  done
  local fid ids=()
  for i in $(seq 0 $((GUARDIANS - 1))); do
    kit "$i" ceremony finalize >>"$WD/logs/g$i-ceremony.log" 2>&1 || die "ceremony finalize failed on g$i"
    json invite_code <"$WD/g$i/data/oc-ceremony.json" >"$WD/g$i/invite"
    fid="$(cli dev decode invite-code "$(cat "$WD/g$i/invite")" | json federation_id)"
    ids+=("$fid")
    say "  g$i  RUNNING  federation id $fid"
  done
  [ "$(printf '%s\n' "${ids[@]}" | sort -u | wc -l)" = 1 ] || die "the guardians report different federation ids"
  cp "$WD/g0/invite" "$WD/invite"

  say "client (fedimint-cli join)"
  cli join "$(cat "$WD/invite")" >/dev/null || die "fedimint-cli join failed (see $WD/logs/fedimint-cli.log)"
  say "  joined $(cli info | json federation_id)"
  say "up: $GUARDIANS guardians in consensus. Invite code in $WD/invite. Next: status, pegin, down."
}

phase_is() { kit "$1" ceremony status 2>/dev/null | grep -q "phase .*$2"; }

# ---------------------------------------------------------------- status

status() {
  load_state
  say "federation $(cli info | json federation_id) · bitcoind height $(btc getblockcount)"
  local i line count prev="" now
  now="$(date -u +%H:%M:%SZ)"
  [ -f "$WD/sessions" ] && prev="$(cat "$WD/sessions")"
  : >"$WD/sessions.new"
  for i in $(seq 0 $((GUARDIANS - 1))); do
    line="$(kit "$i" fedimintd status --config "$WD/bin/fedimintd" 2>/dev/null | sed -n 's/^fedimintd · //p')"
    say "  g$i  ${line:-kit status gave no answer}"
    read -r server online peers flagged count < <(cli dev api --peer-id "$i" status | python3 -I -c '
import json, sys
v = json.load(sys.stdin)["value"]; f = v.get("federation") or {}
print(v["server"], f.get("peers_online", 0), len(f.get("status_by_peer", {})), f.get("peers_flagged", 0), f.get("session_count", "?"))
' 2>/dev/null || echo "unreachable 0 0 0 ?")
    say "      fedimintd: $server, $online of $peers peers connected, $flagged flagged, session count $count$(awk -v i="$i" '$1 == i {printf " (was %s at %s)", $2, $3}' <<<"$prev")"
    echo "$i $count $now" >>"$WD/sessions.new"
  done
  mv "$WD/sessions.new" "$WD/sessions"
}

# ---------------------------------------------------------------- pegin

pegin() {
  load_state
  [ -d "$WD/client" ] || die "no client in $WD; run up first"
  local amount="${PEGIN_BTC:-0.01}" addr tweak txid
  if ! curl -fsS "http://127.0.0.1:$P_ESPLORA/blocks/tip/height" >/dev/null 2>&1; then
    say "starting the Esplora STAND-IN on 127.0.0.1:$P_ESPLORA (bitcoind RPC behind it; not a real Esplora)"
    launch esplora-stand-in "$WD/logs/esplora-stand-in.log" \
      python3 -I "$HERE/esplora_stand_in.py" "$P_ESPLORA" "http://127.0.0.1:$P_RPC" local "$WD/rpcpass" "$WD/logs/esplora-stand-in-requests.log"
    wait_for 30 "$LAST_PID" "the Esplora stand-in" curl -fsS "http://127.0.0.1:$P_ESPLORA/blocks/tip/height"
  fi
  local deposit
  deposit="$(cli module wallet new-deposit-address)" || die "new-deposit-address failed (see $WD/logs/fedimint-cli.log)"
  addr="$(json address <<<"$deposit")"
  tweak="$(json tweak_idx <<<"$deposit")"
  txid="$(btc -rpcwallet=local sendtoaddress "$addr" "$amount")"
  say "sent $amount BTC to $addr (tweak $tweak) in $txid"
  # Guardians only count blocks older than the finality delay (10 on regtest), so bury the deposit.
  btc generatetoaddress 21 "$(btc -rpcwallet=local getnewaddress)" >/dev/null
  say "mined 21 blocks, height $(btc getblockcount); waiting for the federation to claim it"
  timeout 900 "${CLI[@]}" module wallet await-deposit --tweak-idx "$tweak" >/dev/null 2>>"$WD/logs/fedimint-cli.log" \
    || die "the deposit was not claimed within 15 minutes (see $WD/logs/fedimint-cli.log)"
  local info
  info="$(cli info)"
  say "balance $(json total_amount_msat <<<"$info") msat in $(json total_num_notes <<<"$info") notes"
}

# ---------------------------------------------------------------- down

down() {
  [ -d "$WD" ] || die "no work dir $WD"
  WD="$(realpath "$WD")"
  [ -f "$WD/pids" ] || { say "nothing recorded in $WD/pids"; return; }
  local name pid start left=()
  while read -r name pid start; do
    if { alive "$pid" && [ "$(started_at "$pid")" = "$start" ]; } || { ! alive "$pid" && kill -0 -- "-$pid" 2>/dev/null; }; then
      kill -TERM -- "-$pid" 2>/dev/null || true
      left+=("$pid")
      say "stopping $name (process group $pid)"
    fi
  done <"$WD/pids"
  local deadline=$((SECONDS + 30))
  for pid in "${left[@]}"; do
    while kill -0 -- "-$pid" 2>/dev/null && [ $SECONDS -lt $deadline ]; do sleep 1; done
    if kill -0 -- "-$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" 2>/dev/null || true
      say "killed process group $pid"
    fi
  done
  mv "$WD/pids" "$WD/pids.stopped"
  if [ -f "$WD/state" ]; then
    load_state
    local busy p open=()
    busy="$(ss -Hltn | awk '{print $4}' | sed 's/.*://' | sort -u)"
    for p in $(all_ports); do grep -qx "$p" <<<"$busy" && open+=("$p"); done
    [ ${#open[@]} = 0 ] || die "still listening: ${open[*]}"
    say "down: nothing listens on this federation's ports"
  fi
}

case "$CMD" in
  up) up ;;
  status) WD="$(realpath "$WD")"; status ;;
  pegin) WD="$(realpath "$WD")"; pegin ;;
  down) down ;;
  *) die "usage: $0 <up|status|pegin|down> [work-dir]" ;;
esac
