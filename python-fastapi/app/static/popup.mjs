// @orangecheck/me-client 0.40.0 dist/popup.mjs (MIT), copied as the quickstart says. Copy it again when you upgrade.
// src/popup.ts
var DEFAULT_POPUP_ORIGIN = "https://me.ochk.io";
var DEFAULT_POPUP_PATH = "/popup/signin";
var DEFAULT_FEATURES = "width=480,height=720,resizable=yes,scrollbars=yes";
function signInWithOcOutcome(options = {}) {
  const popupOrigin = options.popupOrigin ?? DEFAULT_POPUP_ORIGIN;
  const popupPath = options.popupPath ?? DEFAULT_POPUP_PATH;
  const features = options.features ?? DEFAULT_FEATURES;
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ status: "failed" });
      return;
    }
    const url = new URL(popupPath, popupOrigin);
    url.searchParams.set("opener_origin", window.location.origin);
    const popup = window.open(url.toString(), "oc-signin", features);
    if (!popup) {
      resolve({ status: "blocked" });
      return;
    }
    popup.focus();
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(closedTimer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    };
    function settle(value) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (popup && !popup.closed) popup.close();
      } catch {
      }
      resolve(value);
    }
    function onMessage(event) {
      if (event.origin !== popupOrigin) return;
      if (event.source !== popup) return;
      const data = event.data;
      if (!data || data.type !== "oc-signin-success") return;
      if (!data.account || !data.token) {
        settle({ status: "failed" });
        return;
      }
      settle({ status: "signed_in", account: data.account, token: data.token });
    }
    function onAbort() {
      settle({ status: "aborted" });
    }
    window.addEventListener("message", onMessage);
    if (options.signal) {
      if (options.signal.aborted) {
        settle({ status: "aborted" });
        return;
      }
      options.signal.addEventListener("abort", onAbort);
    }
    const closedTimer = setInterval(() => {
      if (popup && popup.closed) settle({ status: "closed" });
    }, 500);
  });
}
async function signInWithOc(options = {}) {
  const outcome = await signInWithOcOutcome(options);
  return outcome.status === "signed_in" ? { account: outcome.account, token: outcome.token } : null;
}

export { signInWithOc, signInWithOcOutcome };
//# sourceMappingURL=popup.mjs.map
//# sourceMappingURL=popup.mjs.map