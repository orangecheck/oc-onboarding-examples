// @orangecheck/me-client 0.53.2 dist/button.mjs (MIT), for offline mode only: live pages load button-auto.mjs from jsDelivr (base.html). Copy it again when you upgrade.
// node_modules/@orangecheck/mark/dist/index.mjs
var MARK_POINTS = {
  top: "0,3 2,2 6,4 14,0 16,1 6,6",
  left: "0,3 6,6 6,8 0,5",
  right: "6,6 16,1 16,3 6,8"
};
var MARK_VIEWBOX = "0 0 16 8";
var MARK_FACES = { top: "#FED8AB", left: "#FB933C", right: "#EA580B" };
var MARK_MONO_OPACITY = { top: 1, left: 0.6, right: 0.3 };
var MARK_TILE = {
  viewBox: "0 0 24 24",
  radius: 6.25,
  fill: "#0A0A0A",
  transform: "translate(4.25 8.1) scale(0.97)"
};
var ORDER = ["left", "right", "top"];
function opacity(face, flat) {
  return flat ? 1 : MARK_MONO_OPACITY[face];
}
function heightFor(variant, width) {
  if (variant === "tile") return width;
  const m = /^(-?[\d.]+)([a-z%]*)$/i.exec(width.trim());
  return m ? `${Number(m[1]) / 2}${m[2]}` : "auto";
}
var SVG_NS = "http://www.w3.org/2000/svg";
function markElement(doc, options = {}) {
  const variant = options.variant ?? "mono";
  if (variant !== "mono" && variant !== "brand" && variant !== "tile") throw new TypeError(`markElement: unknown variant ${String(variant)}`);
  const width = options.width ?? (variant === "tile" ? "1.25em" : "1.75em");
  const color = options.color ?? "currentColor";
  const el = (tag, attrs) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const svg = el("svg", {
    viewBox: variant === "tile" ? MARK_TILE.viewBox : MARK_VIEWBOX,
    width,
    height: heightFor(variant, width),
    "data-oc-mark": variant
  });
  if (options.className) svg.setAttribute("class", options.className);
  if (options.title) {
    svg.setAttribute("role", "img");
    const title = el("title", {});
    title.textContent = options.title;
    svg.append(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
  }
  const parent = variant === "tile" ? el("g", { transform: MARK_TILE.transform }) : svg;
  if (variant === "tile") svg.append(el("rect", { width: "24", height: "24", rx: String(MARK_TILE.radius), fill: MARK_TILE.fill }), parent);
  for (const face of ORDER) {
    const attrs = { points: MARK_POINTS[face] };
    if (variant === "mono") {
      attrs.fill = color;
      if (opacity(face, !!options.flat) !== 1) attrs["fill-opacity"] = String(opacity(face, !!options.flat));
    } else attrs.fill = MARK_FACES[face];
    parent.append(el("polygon", attrs));
  }
  return svg;
}

// src/own-options.ts
function inheritedKeys(opts, known) {
  return [...known].filter((k) => k in opts && !Object.prototype.hasOwnProperty.call(opts, k));
}

// src/popup.ts
var DEFAULT_POPUP_ORIGIN = "https://me.ochk.io";
var DEFAULT_POPUP_PATH = "/popup/signin";
var DEFAULT_FEATURES = "width=480,height=720,resizable=yes,scrollbars=yes";
var POPUP_OPTIONS = /* @__PURE__ */ new Set(["popupOrigin", "popupPath", "features", "signal"]);
function checkPopupOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("@orangecheck/me-client: signInWithOc: options must be an object");
  }
  const unknown = Object.keys(options).filter((k) => !POPUP_OPTIONS.has(k));
  if (unknown.length > 0) {
    throw new TypeError(
      `@orangecheck/me-client: signInWithOc: unknown option ${unknown.join(", ")}. It reads only ${[...POPUP_OPTIONS].join(", ")}.`
    );
  }
  const inherited = inheritedKeys(options, POPUP_OPTIONS);
  if (inherited.length > 0) {
    throw new TypeError(
      `@orangecheck/me-client: signInWithOc: option ${inherited.join(", ")} is inherited, not set by the caller`
    );
  }
}
function signInWithOcOutcome(options = {}) {
  checkPopupOptions(options);
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

// src/button.ts
var SIGN_IN_LABELS = {
  signIn: "Sign in with orangecheck",
  continue: "Continue with orangecheck",
  signUp: "Sign up with orangecheck"
};
var SIGN_IN_BUSY_LABEL = "Signing in\u2026";
var OUTCOME_COPY = {
  blocked: "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.",
  closed: "The sign-in window closed before you finished.",
  failed: "Sign-in didn't finish. Try again."
};
var MARKS = /* @__PURE__ */ new Set(["mono", "brand", "tile", false]);
var KEYS = /* @__PURE__ */ new Set(["onSignedIn", "onOutcome", "mark", "label", "busyLabel", "accessibleLabel", "appearance", "popup"]);
var NAMED = /(^|[^\p{L}\p{N}])orangecheck($|[^\p{L}\p{N}])/u;
function checkSignInOptions(options) {
  for (const key of Object.keys(options)) if (!KEYS.has(key)) throw new TypeError(`sign-in button: unknown option ${key}`);
  for (const key of inheritedKeys(options, KEYS)) throw new TypeError(`sign-in button: option ${key} is inherited, not set by the caller`);
  if (typeof options.onSignedIn !== "function") throw new TypeError("sign-in button: onSignedIn is required");
  const label = options.label ?? SIGN_IN_LABELS.signIn;
  if (label !== false && (typeof label !== "string" || !NAMED.test(label))) {
    throw new TypeError(`sign-in button: "${String(label)}" must say "orangecheck", lowercase, as written; see SIGN_IN_LABELS`);
  }
  const accessibleLabel = options.accessibleLabel ?? SIGN_IN_LABELS.signIn;
  if (!NAMED.test(accessibleLabel)) throw new TypeError(`sign-in button: accessibleLabel "${accessibleLabel}" must say "orangecheck"`);
  const busyLabel = options.busyLabel ?? SIGN_IN_BUSY_LABEL;
  if (typeof busyLabel !== "string" || !busyLabel.trim()) throw new TypeError("sign-in button: busyLabel must be words");
  const mark = options.mark ?? "mono";
  if (!MARKS.has(mark)) throw new TypeError(`sign-in button: unknown mark ${String(mark)}`);
  if (label === false && mark === false) throw new TypeError("sign-in button: with no label it needs the mark");
  const appearance = options.appearance ?? "inherit";
  if (appearance !== "inherit" && appearance !== "brand") throw new TypeError(`sign-in button: unknown appearance ${String(appearance)}`);
  return { label, mark, busyLabel, accessibleLabel, appearance };
}
function holdWidth(button) {
  const { width: was, minWidth: wasMin } = button.style;
  const width = button.getBoundingClientRect().width;
  if (width > 0) button.style.width = button.style.minWidth = `${width}px`;
  return () => {
    button.style.width = was;
    button.style.minWidth = wasMin;
  };
}
function enhanceSignInButton(button, options) {
  if (!button || button.tagName !== "BUTTON") throw new TypeError("sign-in button: pass a <button> element");
  const doc = button.ownerDocument;
  const own = (button.querySelector("[data-oc-label]")?.textContent ?? button.textContent ?? "").trim();
  const iconOnly = options.label === false || options.label === void 0 && button.getAttribute("data-label") === "none";
  const written = options.label === void 0 && !iconOnly && NAMED.test(own) ? own : options.label;
  const hinted = button.querySelector("[data-oc-mark]")?.getAttribute("data-oc-mark");
  const variant = options.mark === void 0 && hinted && MARKS.has(hinted) ? hinted : options.mark;
  const checked = checkSignInOptions({ ...options, mark: variant, label: iconOnly ? false : written });
  const { label, mark, appearance, busyLabel, accessibleLabel } = checked;
  const before = {
    nodes: [...button.childNodes],
    type: button.getAttribute("type"),
    aria: button.getAttribute("aria-label"),
    dataLabel: button.getAttribute("data-label")
  };
  if (!before.type) button.type = "button";
  button.setAttribute("data-oc-sign-in", "");
  button.setAttribute("data-appearance", appearance);
  const markEl = mark ? markElement(doc, { variant: mark }) : null;
  const text = doc.createElement("span");
  text.setAttribute("data-oc-label", "");
  if (label === false) {
    button.setAttribute("data-label", "none");
    button.setAttribute("aria-label", accessibleLabel);
    button.replaceChildren(markEl);
  } else {
    text.textContent = label;
    button.replaceChildren(...markEl ? [markEl] : [], text);
  }
  let busy = false;
  let release = null;
  const setBusy = (on) => {
    busy = on;
    if (on) {
      release = holdWidth(button);
      if (label !== false) text.textContent = busyLabel;
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-busy", "true");
    } else {
      if (label !== false) text.textContent = label;
      button.removeAttribute("aria-disabled");
      button.removeAttribute("aria-busy");
      release?.();
      release = null;
    }
  };
  const onClick = async (event) => {
    event.preventDefault();
    if (busy || button.disabled) return;
    const pending = signInWithOcOutcome(options.popup);
    setBusy(true);
    try {
      const outcome = await pending;
      options.onOutcome?.(outcome);
      if (outcome.status === "signed_in") await options.onSignedIn({ account: outcome.account, token: outcome.token });
    } finally {
      setBusy(false);
    }
  };
  button.addEventListener("click", onClick);
  return () => {
    button.removeEventListener("click", onClick);
    button.replaceChildren(...before.nodes);
    if (before.type === null) button.removeAttribute("type");
    for (const a of ["data-oc-sign-in", "data-appearance", "aria-disabled", "aria-busy"]) button.removeAttribute(a);
    if (before.aria === null) button.removeAttribute("aria-label");
    else button.setAttribute("aria-label", before.aria);
    if (before.dataLabel === null) button.removeAttribute("data-label");
    else button.setAttribute("data-label", before.dataLabel);
  };
}

export { OUTCOME_COPY, SIGN_IN_BUSY_LABEL, SIGN_IN_LABELS, checkSignInOptions, enhanceSignInButton, holdWidth };
