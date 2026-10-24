# guardian

A local, throwaway Fedimint federation of four guardians on Bitcoin regtest, run
with orangecheck's guardian kit,
[`oc-guardian`](https://github.com/orangecheck/oc-guardian-kit) 0.2.8. It is for
learning how a guardian runs: the kit, the key ceremony, consensus and a deposit.
Everything listens on 127.0.0.1, nothing joins any federation of orangecheck's,
and `down` stops all of it.

## Where the guardian path stands

orangecheck holds every role while the system is in testing, guardian seats
included. [ochk.app/custody](https://ochk.app/custody) shows who holds what, read
live. The operator program is not open yet, so no outside guardian can take a seat
today. When it opens, a real seat goes like this:

1. Install the kit and make an operator key (`oc-guardian init`).
2. Apply (`oc-guardian apply`, or email apply@ochk.io).
3. Claim a reserved seat on ochk.app with proof of that key.
4. Sign the federation's charter.
5. Run the key ceremony with the other guardians: the same commands as below.

This folder covers step 5 and what follows it, on your own machine.

## Requirements

- Linux on x86_64. The pinned fedimint binaries are built for it.
- bash, curl, python3, `ss`, `setsid` and coreutils. `gh` is optional; with it the
  script also checks the kit's build provenance.
- About 1 GB for the downloads.
- 50 free ports from `BASE_PORT` (28600 by default). They must sit below the
  kernel's ephemeral range (see `/proc/sys/net/ipv4/ip_local_port_range`), where
  any outgoing connection on the machine could take one. The script refuses a
  range that overlaps it.

## Run it

```sh
bash local-federation.sh up        # downloads, then about 2 minutes
bash local-federation.sh status    # each guardian: phase, peers, session count
bash local-federation.sh pegin     # optional: deposit 0.01 regtest BTC
bash local-federation.sh down      # stop everything this work dir started
```

Each takes a work directory as its second argument, `./.federation` by default.
Nothing is written outside it, except `gh`'s own attestation cache. A session lasts
about five minutes, so run `status` again after that to see the count go up.

To skip a download, point `BITCOIND` and `BITCOIN_CLI`, `OC_GUARDIAN`,
`FEDIMINTD_BUNDLE` and `FEDIMINT_CLI_BUNDLE` at copies you have already verified.
Every pinned sha256 is still checked.

## What `up` does

1. **Downloads and checks each binary against a pinned sha256**, each in its own
   new directory:
   - Bitcoin Core 31.1, also against its signed `SHA256SUMS`;
   - `oc-guardian` 0.2.8, also against its release `.sha256` and, with `gh`, its
     build provenance attestation;
   - `fedimintd` 0.11.4, installed by the kit itself (`oc-guardian fedimintd
     install`), which checks its own pin;
   - `fedimint-cli` 0.11.4, against GitHub's published digest.
2. **Starts bitcoind on regtest**, RPC on 127.0.0.1 only, with no peers, and mines
   101 blocks.
3. **Starts four guardians.** Each gets its own operator key
   (`oc-guardian init --key-file`) and runs under the kit
   (`oc-guardian fedimintd run`), with every port bound to 127.0.0.1.
4. **Runs the key ceremony with the kit's commands:**
   - `oc-guardian ceremony start` on each guardian, the leader with
     `--federation-name` and `--federation-size`. Each prints its setup code.
   - `oc-guardian ceremony add-peer --code …` with the other three codes.
   - `oc-guardian ceremony dkg` on all four.
   - `oc-guardian ceremony status` until each says RUNNING, then
     `oc-guardian ceremony finalize`, which prints the invite code.
5. **Joins a client** with `fedimint-cli join` and the invite code, and checks all
   four guardians name the same federation id.

## Where fedimint needs an extra step

These come from fedimint 0.11.4 itself, not the kit, and the script handles each
one in the open:

- **The pinned binaries are nix bundles.** On hosts that block unprivileged user
  namespaces, stock Ubuntu 23.10 and later among them, a bundle can't run as it
  is. The script unpacks it and runs the binary through the bundle's own loader
  (`bundle_wrapper.py`).
- **The client watches deposits only through an Esplora API**
  ([fedimint#7235](https://github.com/fedimint/fedimint/issues/7235)). `pegin`
  starts `esplora_stand_in.py`, a small stand-in over bitcoind's RPC that answers
  the few calls the client makes. It is a stand-in for regtest, not an Esplora:
  anything real runs [esplora](https://github.com/Blockstream/esplora) or
  [electrs](https://github.com/romanz/electrs).
- **fedimintd publishes its API address to public pkarr relays after the
  ceremony** unless `FM_PKARR_ENABLE=false`
  ([fedimint#8032](https://github.com/fedimint/fedimint/issues/8032)). The script
  always sets it, so a local federation stays local.

## Verify

Run `up`, `status`, `pegin`, then `status` again after five minutes, then `down`.
That is what proves this folder:

- `up` ends with all four guardians RUNNING under one federation id.
- `status` shows each guardian with its three peers connected, and the session
  count rising between runs.
- `pegin` ends with the client's balance (0.01 BTC, less the deposit fee) in notes.
- `down` ends with nothing listening on the federation's ports.

CI checks the script and the helpers on every push (`bash -n`, `shellcheck`,
`py_compile`). A whole federation is too heavy to run on every push.

## License

MIT, like the rest of this repo.
