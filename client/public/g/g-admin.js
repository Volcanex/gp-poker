/* g-system@1.2.0, vendored, do not edit. Update: node scripts/vendor.mjs from the g-system repo. */
/* g-admin overlay: the admin-only half of the g-admin contract
   (agents/g-admin-contract.md). Loaded by the stub in g-ui.js, only for a
   session the server verified, and never part of the public bundle.

   Three things, one job: get from noticing that something is wrong on a page
   to a ticket about it without leaving the page it is wrong on.

   - The bar says which project and page you are on, how many tickets are
     open, and switches modes.
   - Annotate mode pins elements and draws over them. It answers "which
     element" (selector, box, HTML) and "what about it" (strokes, note).
   - Edit mode selects an element and edits its spacing, alignment and type
     live, snapped to the host page's spacing scale. The changes accumulate
     as a pending list and are saved as one ticket carrying the edits.

   Nothing here writes to source, and nothing here calls an agent. It authors
   tickets; a baking agent applies them afterwards, guided by the note.

   Everything renders inside one shadow root so host styles and overlay styles
   cannot bleed either way. The host page is touched in exactly two reversible
   ways, both undone on exit: annotate mode locks scrolling (viewport-relative
   boxes would otherwise point at the wrong thing the moment the page moved),
   and edit mode writes inline styles on the selected element. */
(() => {
  if (window.__gAdmin) return;
  window.__gAdmin = true;

  const SELF = document.currentScript?.src || location.href;
  const KEY = "g-admin";
  const COMMAND = "https://command.gabrielpenman.com";
  const MAX_ELEMENTS = 8;
  const MAX_HTML = 10000;
  const MIN_POINT_GAP = 9; /* squared px between recorded stroke points */
  const SEVERITIES = ["critical", "major", "minor", "polish"];
  const KINDS = ["edit", "bug", "visual", "content", "idea"];
  const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48];
  const FALLBACK_SP = [4, 8, 12, 16, 24, 32, 48, 64];
  const FALLBACK_LH = [16, 20, 24, 28, 32];

  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || "";
  const base = (meta("g-admin-base") || "/api/gadmin").replace(/\/+$/, "");

  /* ------------------------------------------------------------------ api */

  function api(path, opts = {}) {
    return fetch(base + path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then((r) => {
      if (!r.ok) throw new Error(`g-admin api ${r.status}`);
      return r.status === 204 ? null : r.json();
    });
  }

  /* ------------------------------------------------------------ selectors */

  /* One part of a path: the tag, up to two classes, and nth-of-type only
     where the tag alone is ambiguous among its siblings. */
  function partFor(node, allClasses) {
    let part = node.tagName.toLowerCase();
    if (node.id) part += "#" + CSS.escape(node.id);
    const classes = [...node.classList];
    for (const c of allClasses ? classes : classes.slice(0, 2)) part += "." + CSS.escape(c);
    const parent = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    return part;
  }

  /* Findable, not pretty. An id ends the walk; otherwise the chain grows
     upwards until querySelectorAll says it is unique, to a depth of six. The
     baking agent resolves it against source with the HTML snapshot and the
     full dom_path, so ugly is fine and ambiguous is not. */
  function selectorFor(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement && parts.length < 6) {
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
      parts.unshift(partFor(node, false));
      const sel = parts.join(" > ");
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch { /* unescapable class */ }
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  /* The whole path, untruncated, every class kept: the selector may be a
     guess, this is the ground truth. */
  function domPathFor(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      parts.unshift(partFor(node, true));
      node = node.parentElement;
    }
    return "html > " + parts.join(" > ");
  }

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const snapshot = (el) => ({
    selector: selectorFor(el),
    dom_path: domPathFor(el),
    html: (el.outerHTML || "").slice(0, MAX_HTML),
    rect: rectOf(el),
  });

  /* --------------------------------------------------------------- scales */

  /* The spacing scale comes from the host page's :root, so a project that has
     re-tuned its steps snaps to its own. A page that never loaded g.css has
     no --sp-* at all, and then the g scale is the honest default. */
  function readScale(prefix, count, fallback) {
    const cs = getComputedStyle(document.documentElement);
    const out = [];
    for (let i = 1; i <= count; i++) {
      const px = parseFloat(cs.getPropertyValue(`--${prefix}-${i}`));
      if (!isNaN(px)) out.push({ token: `--${prefix}-${i}`, px });
    }
    return out.length ? out : fallback.map((px, i) => ({ token: `--${prefix}-${i + 1}`, px }));
  }
  const spacing = () => readScale("sp", 8, FALLBACK_SP);
  const lineHeights = () => readScale("lh", 5, FALLBACK_LH);

  /* Zero is on the grid and has no token, so it leads every spacing scale as a
     stop with a null name. On the scale and unnamed is not the same as off the
     scale, which is why the lookup returns the stop rather than the name. */
  const spacingStops = () => [{ token: null, px: 0 }, ...spacing()];
  const stopAt = (stops, px) => stops.find((s) => Math.abs(s.px - px) < 0.5);
  const tokenAt = (stops, px) => stopAt(stops, px)?.token ?? null;

  function stepAlong(stops, px, dir) {
    const values = stops.map((s) => s.px);
    if (dir > 0) return values.find((v) => v > px + 0.5) ?? values[values.length - 1];
    return [...values].reverse().find((v) => v < px - 0.5) ?? values[0];
  }

  /* ---------------------------------------------------------- shadow root */

  const host = document.createElement("g-admin");
  host.setAttribute("data-g-admin", "");
  const shadow = host.attachShadow({ mode: "open" });
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = new URL("g-admin.css", SELF).href;
  shadow.append(sheet);

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  /* The overlay follows the host page's theme and density: the token layer in
     g-admin.css is scoped to :host, so the attributes have to be here too. */
  function mirrorTheme() {
    for (const attr of ["data-theme", "data-density"]) {
      const v = document.documentElement.getAttribute(attr);
      if (v == null) host.removeAttribute(attr);
      else host.setAttribute(attr, v);
    }
  }
  new MutationObserver(mirrorTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme", "data-density"],
  });
  mirrorTheme();

  /* ------------------------------------------------------------------ bar */

  const bar = el("div", "ga-bar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Admin");
  const who = el("div", "ga-who");
  who.append(el("span", "ga-project", meta("g-admin-project") || location.hostname));
  who.append(el("span", "ga-page", location.pathname));
  const modes = el("div", "g-segmented g-segmented-sm");
  const modeInputs = {};
  for (const [value, label] of [["annotate", "Annotate"], ["edit", "Edit"], ["off", "Off"]]) {
    const lab = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = "ga-mode";
    input.value = value;
    input.checked = value === "off";
    lab.append(input, el("span", null, label));
    modes.append(lab);
    modeInputs[value] = input;
    input.addEventListener("change", () => { if (input.checked) setMode(value); });
    /* Off is the resting state, so the radio is already checked and change
       never fires for the one control that has to work from rest. */
    if (value === "off") input.addEventListener("click", () => setMode("off"));
  }
  const countLink = el("a", "ga-count");
  countLink.href = COMMAND + "/tickets";
  countLink.target = "_blank";
  countLink.rel = "noreferrer";
  const countLabel = el("span", null, "Tickets");
  const countBadge = el("span", "badge badge-plain num");
  countBadge.hidden = true;
  countLink.append(countLabel, countBadge);
  const commandLink = el("a", null, "Command centre");
  commandLink.href = COMMAND;
  commandLink.target = "_blank";
  commandLink.rel = "noreferrer";
  bar.append(who, modes, el("span", "ga-spacer"), countLink, commandLink);

  const hint = el("div", "ga-hint");
  hint.hidden = true;
  let hintTimer;
  function say(text, sticky) {
    clearTimeout(hintTimer);
    hint.textContent = text;
    hint.hidden = !text;
    if (text && !sticky) hintTimer = setTimeout(() => { hint.hidden = true; }, 3200);
  }

  function refreshCount() {
    api("/tickets?status=open").then((list) => {
      /* The contract says a list; a server that wraps it is still answering
         the same question, and guessing wrong here would blank the badge. */
      const n = (Array.isArray(list) ? list : list?.tickets || []).length;
      countBadge.textContent = String(n);
      countBadge.hidden = n === 0;
    }).catch(() => { countBadge.hidden = true; });
  }

  /* ---------------------------------------------------------------- stage */

  const stage = el("div", "ga-stage");
  stage.hidden = true;
  const canvas = el("canvas", "ga-canvas");
  canvas.setAttribute("aria-hidden", "true");
  const boxes = el("div", "ga-boxes");
  const hit = el("div", "ga-hit");
  stage.append(canvas, boxes, hit);

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function place(node, rect, inset = 2) {
    node.style.left = rect.x - inset + "px";
    node.style.top = rect.y - inset + "px";
    node.style.width = rect.w + inset * 2 + "px";
    node.style.height = rect.h + inset * 2 + "px";
  }

  /* The topmost element that belongs to the page: everything of ours lives in
     the shadow root, so skipping it is one containment check. */
  function elementUnder(x, y) {
    for (const node of document.elementsFromPoint(x, y) || []) {
      if (node === host || shadow.contains(node)) continue;
      if (node === document.body || node === document.documentElement) continue;
      return node;
    }
    return null;
  }

  let scrollLock = null;
  function lockScroll(on) {
    const root = document.documentElement;
    if (on && !scrollLock) {
      scrollLock = { root: root.style.overflow, body: document.body.style.overflow };
      root.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else if (!on && scrollLock) {
      root.style.overflow = scrollLock.root;
      document.body.style.overflow = scrollLock.body;
      scrollLock = null;
    }
  }

  /* ------------------------------------------------------------- composer */

  const panel = el("div", "card ga-panel");
  panel.hidden = true;
  const tools = el("div", "ga-tools");
  const toolSeg = el("div", "g-segmented g-segmented-sm");
  const toolInputs = {};
  for (const [value, label] of [["pin", "Pin"], ["pen", "Draw"]]) {
    const lab = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = "ga-tool";
    input.value = value;
    input.checked = value === "pin";
    lab.append(input, el("span", null, label));
    toolSeg.append(lab);
    toolInputs[value] = input;
    input.addEventListener("change", () => { if (input.checked) stage.dataset.tool = value; });
  }
  const undoBtn = el("button", "btn btn-sm btn-tertiary", "Undo stroke");
  undoBtn.type = "button";
  tools.append(toolSeg, el("span", "ga-spacer"), undoBtn);

  const noteField = el("label", "field");
  const noteInput = el("textarea", "textarea");
  noteInput.placeholder = "What is wrong here, and what should it be";
  noteField.append(el("span", "label", "Note"), noteInput);

  const pickers = el("div", "ga-pair");
  const kindSelect = el("select", "select");
  for (const k of KINDS) kindSelect.append(new Option(k[0].toUpperCase() + k.slice(1), k));
  const sevSelect = el("select", "select");
  for (const s of SEVERITIES) sevSelect.append(new Option(s[0].toUpperCase() + s.slice(1), s));
  sevSelect.value = "minor";
  /* .select draws its caret on the wrapper, not the control. */
  const wrapSelect = (control) => {
    const wrap = el("span", "select-wrap");
    wrap.append(control);
    return wrap;
  };
  const kindField = el("label", "field");
  kindField.append(el("span", "label", "Kind"), wrapSelect(kindSelect));
  const sevField = el("label", "field");
  sevField.append(el("span", "label", "Severity"), wrapSelect(sevSelect));
  pickers.append(kindField, sevField);

  const scopeSeg = el("div", "g-segmented g-segmented-sm");
  scopeSeg.setAttribute("data-block", "");
  const scopeInputs = {};
  for (const [value, label] of [["page", "This page"], ["site", "Site wide"]]) {
    const lab = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = "ga-scope";
    input.value = value;
    input.checked = value === "page";
    lab.append(input, el("span", null, label));
    scopeSeg.append(lab);
    scopeInputs[value] = input;
  }

  const counts = el("span", "hint");
  const error = el("span", "error");
  error.hidden = true;
  const actions = el("div", "ga-actions");
  const saveBtn = el("button", "btn btn-sm btn-primary", "Save ticket");
  saveBtn.type = "button";
  const cancelBtn = el("button", "btn btn-sm btn-tertiary", "Cancel");
  cancelBtn.type = "button";
  actions.append(saveBtn, el("span", "ga-spacer"), cancelBtn);
  panel.append(tools, noteField, pickers, scopeSeg, counts, error, actions);

  /* ------------------------------------------------------------- sidebar */

  const side = el("aside", "ga-side");
  side.hidden = true;
  side.setAttribute("aria-label", "Element inspector");
  const sideHead = el("div", "ga-side-head");
  const sideSel = el("div", "ga-sel");
  const sideDims = el("div", "ga-dims");
  sideHead.append(sideSel, sideDims);
  const sideBody = el("div", "ga-side-body");
  const paneStack = el("div", "g-pane-stack");
  sideBody.append(paneStack);
  const sideFoot = el("div", "ga-side-foot");
  const pendingCount = el("span", "hint", "No pending edits");
  const revertBtn = el("button", "btn btn-sm btn-tertiary", "Revert");
  revertBtn.type = "button";
  const saveEditsBtn = el("button", "btn btn-sm btn-primary", "Save edits");
  saveEditsBtn.type = "button";
  sideFoot.append(pendingCount, el("span", "ga-spacer"), revertBtn, saveEditsBtn);
  side.append(sideHead, sideBody, sideFoot);

  function pane(title, body) {
    const section = el("section", "g-pane");
    const head = el("button", "g-pane-title", title);
    head.type = "button";
    head.setAttribute("aria-expanded", "true");
    const bodyEl = el("div", "g-pane-body");
    bodyEl.append(body);
    section.append(head, bodyEl);
    paneStack.append(section);
    return bodyEl;
  }

  const wrap = el("div", "ga");
  wrap.append(bar, stage, hint, panel, side);
  shadow.append(wrap);

  /* ------------------------------------------------------------- annotate */

  const strokes = [];
  let drawing = null;
  let picked = [];
  const liveOutline = el("div", "ga-out");
  const liveTag = el("span", "ga-tag");
  liveOutline.append(liveTag);
  liveOutline.hidden = true;

  function redraw() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    /* A canvas cannot resolve a custom property, so the accent is read off the
       overlay root, which always has one whether or not the page does. */
    const cs = getComputedStyle(host);
    ctx.strokeStyle = cs.getPropertyValue("--accent-fill").trim() || cs.getPropertyValue("--text-primary").trim();
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (!stroke.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0][0], stroke[0][1]);
      for (const p of stroke.slice(1)) ctx.lineTo(p[0], p[1]);
      if (stroke.length === 1) ctx.lineTo(stroke[0][0] + 0.1, stroke[0][1]);
      ctx.stroke();
    }
  }

  function renderPicked() {
    boxes.replaceChildren();
    for (const target of picked) {
      const box = el("div", "ga-pick");
      place(box, target.rect);
      boxes.append(box);
    }
    if (mode === "annotate") boxes.append(liveOutline);
    counts.textContent = `${picked.length} of ${MAX_ELEMENTS} elements pinned, ${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}`;
    undoBtn.disabled = strokes.length === 0;
  }

  function annotatePointerDown(e) {
    hit.setPointerCapture(e.pointerId);
    if (stage.dataset.tool !== "pen") return;
    drawing = [[e.clientX, e.clientY]];
    strokes.push(drawing);
    redraw();
    renderPicked();
  }

  function annotatePointerMove(e) {
    if (stage.dataset.tool === "pen") {
      if (!drawing) return;
      const last = drawing[drawing.length - 1];
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      if (dx * dx + dy * dy < MIN_POINT_GAP) return;
      drawing.push([e.clientX, e.clientY]);
      redraw();
      return;
    }
    const node = elementUnder(e.clientX, e.clientY);
    liveOutline.hidden = !node;
    if (!node) return;
    place(liveOutline, rectOf(node));
    liveTag.textContent = selectorFor(node).split(" > ").pop();
  }

  function annotatePointerUp(e) {
    if (hit.hasPointerCapture(e.pointerId)) hit.releasePointerCapture(e.pointerId);
    if (stage.dataset.tool === "pen") { drawing = null; return; }
    const node = elementUnder(e.clientX, e.clientY);
    if (!node || picked.length >= MAX_ELEMENTS) return;
    const target = snapshot(node);
    if (picked.some((t) => t.selector === target.selector)) return;
    picked.push(target);
    renderPicked();
  }

  undoBtn.addEventListener("click", () => {
    strokes.pop();
    redraw();
    renderPicked();
  });

  /* ----------------------------------------------------------------- edit */

  let selected = null;
  const pending = new Map(); /* `${selector}|${prop}` -> edit record */
  const touched = new Map(); /* selector -> element */
  const editOutline = el("div", "ga-out");
  const editTag = el("span", "ga-tag");
  editOutline.append(editTag);
  const shades = { top: [], right: [], bottom: [], left: [] };

  function shadeBox(kind, rect, sides) {
    /* Four strips rather than one box with a hole: a strip is a rectangle, and
       four of them describe a margin or padding ring exactly. */
    const strips = [
      { x: rect.x - sides.left, y: rect.y - sides.top, w: rect.w + sides.left + sides.right, h: sides.top },
      { x: rect.x - sides.left, y: rect.y + rect.h, w: rect.w + sides.left + sides.right, h: sides.bottom },
      { x: rect.x - sides.left, y: rect.y, w: sides.left, h: rect.h },
      { x: rect.x + rect.w, y: rect.y, w: sides.right, h: rect.h },
    ];
    for (const s of strips) {
      if (s.w <= 0 || s.h <= 0) continue;
      const node = el("div", kind);
      node.style.left = s.x + "px";
      node.style.top = s.y + "px";
      node.style.width = s.w + "px";
      node.style.height = s.h + "px";
      boxes.append(node);
    }
  }

  const px = (v) => Math.round(parseFloat(v) || 0);

  function drawEditBoxes(node) {
    boxes.replaceChildren();
    if (!node || !node.isConnected) return;
    const rect = rectOf(node);
    const cs = getComputedStyle(node);
    const margin = { top: px(cs.marginTop), right: px(cs.marginRight), bottom: px(cs.marginBottom), left: px(cs.marginLeft) };
    const padding = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    shadeBox("ga-margin", rect, margin);
    shadeBox("ga-pad", { x: rect.x + padding.left, y: rect.y + padding.top, w: Math.max(0, rect.w - padding.left - padding.right), h: Math.max(0, rect.h - padding.top - padding.bottom) },
      { top: padding.top, right: padding.right, bottom: padding.bottom, left: padding.left });
    place(editOutline, rect);
    editTag.textContent = selectorFor(node).split(" > ").pop();
    boxes.append(editOutline);
    if (node === selected) {
      sideDims.textContent = `${rect.w} by ${rect.h}`;
    }
  }

  let hovered = null;
  let frame = 0;
  function scheduleRedrawBoxes() {
    /* Only edit mode owns the box layer. Annotate mode draws its own pins into
       it, and locking the scrollbar away fires a resize, so an unguarded
       redraw here wipes the pins the moment annotate mode opens. */
    if (mode !== "edit" || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawEditBoxes(hovered || selected);
      if (selected) refreshControls();
    });
  }

  function editPointerMove(e) {
    const node = elementUnder(e.clientX, e.clientY);
    if (node === hovered) return;
    hovered = node;
    drawEditBoxes(node);
  }

  function editPointerUp(e) {
    const node = elementUnder(e.clientX, e.clientY);
    if (!node) return;
    select(node);
  }

  function select(node) {
    selected = node;
    hovered = null;
    sideSel.textContent = selectorFor(node);
    side.hidden = false;
    drawEditBoxes(node);
    refreshControls();
  }

  /* An edit is recorded against the selector, because that is what a baking
     agent will look for. `from` is the computed value before we touched it,
     captured once: a second nudge must not record the first nudge as the
     original. */
  function applyEdit(node, prop, value, stops) {
    const selector = selectorFor(node);
    const key = `${selector}|${prop}`;
    if (!pending.has(key)) {
      const from = getComputedStyle(node).getPropertyValue(prop);
      pending.set(key, { selector, prop, from, to: from, token_from: stops ? tokenAt(stops, px(from)) : null, token_to: null });
      touched.set(selector, node);
    }
    const record = pending.get(key);
    record.to = value;
    record.token_to = stops ? tokenAt(stops, px(value)) : null;
    node.style.setProperty(prop, value);
    renderPending();
    scheduleRedrawBoxes();
  }

  function revertAll() {
    for (const record of pending.values()) {
      touched.get(record.selector)?.style.removeProperty(record.prop);
    }
    pending.clear();
    touched.clear();
    renderPending();
    scheduleRedrawBoxes();
  }

  const pendingList = el("div", "ga-pending");
  function renderPending() {
    const records = [...pending.values()];
    pendingCount.textContent = records.length === 0
      ? "No pending edits"
      : `${records.length} pending ${records.length === 1 ? "edit" : "edits"}`;
    saveEditsBtn.disabled = records.length === 0;
    revertBtn.disabled = records.length === 0;
    pendingList.replaceChildren();
    if (!records.length) {
      pendingList.append(el("span", "ga-empty", "Nothing changed yet. Edits land here as you make them."));
      return;
    }
    for (const record of records) {
      const row = el("div", "ga-edit");
      row.append(el("span", "ga-prop", record.prop));
      row.append(el("span", "ga-to", record.token_to || record.to));
      pendingList.append(row);
    }
  }

  /* A stepper row: minus, value, plus, and the token the value lands on. Off
     the scale is allowed and flagged in place rather than corrected. */
  function stepper(label, prop, getStops) {
    const row = el("div", "ga-row");
    row.append(el("span", "ga-key", label));
    const step = el("span", "ga-step");
    const down = el("button", "btn btn-sm btn-tertiary btn-icon", "−");
    down.type = "button";
    down.setAttribute("aria-label", `Decrease ${label.toLowerCase()}`);
    const value = el("input", "ga-val");
    value.inputMode = "numeric";
    value.setAttribute("aria-label", label);
    const up = el("button", "btn btn-sm btn-tertiary btn-icon", "+");
    up.type = "button";
    up.setAttribute("aria-label", `Increase ${label.toLowerCase()}`);
    const token = el("span", "ga-token");
    step.append(down, value, up, token);
    row.append(step);

    const commit = (next) => {
      if (!selected) return;
      applyEdit(selected, prop, Math.max(0, Math.round(next)) + "px", getStops());
      render();
    };
    down.addEventListener("click", () => commit(stepAlong(getStops(), current(), -1)));
    up.addEventListener("click", () => commit(stepAlong(getStops(), current(), 1)));
    value.addEventListener("change", () => commit(parseFloat(value.value)));

    const current = () => (selected ? px(getComputedStyle(selected).getPropertyValue(prop)) : 0);
    function render() {
      /* Scrolling re-reads every control, which must not overwrite a number
         somebody is halfway through typing. */
      if (shadow.activeElement === value) return;
      const now = current();
      value.value = String(now);
      const stop = stopAt(getStops(), now);
      token.textContent = stop ? (stop.token || "").replace("--", "") : "off scale";
      step.toggleAttribute("data-off", !stop);
    }
    return { row, render, nudge: (delta) => commit(current() + delta), step: (dir) => commit(stepAlong(getStops(), current(), dir)) };
  }

  /* A segmented toggle over a set of keyword values. */
  function toggles(label, prop, options) {
    const row = el("div", "ga-row");
    row.append(el("span", "ga-key", label));
    const seg = el("div", "g-segmented g-segmented-sm");
    seg.setAttribute("data-block", "");
    const inputs = {};
    for (const [value, text] of options) {
      const lab = el("label");
      const input = el("input");
      input.type = "radio";
      input.name = "ga-" + prop;
      input.value = value;
      lab.append(input, el("span", null, text));
      seg.append(lab);
      inputs[value] = input;
      input.addEventListener("change", () => { if (input.checked && selected) applyEdit(selected, prop, value, null); });
    }
    row.append(seg);
    return {
      row,
      render() {
        const now = selected ? getComputedStyle(selected).getPropertyValue(prop).trim() : "";
        for (const [value, input] of Object.entries(inputs)) input.checked = value === now;
      },
      setDisabled(off) {
        for (const input of Object.values(inputs)) input.disabled = off;
        seg.style.opacity = off ? "0.45" : "";
      },
    };
  }

  const marginBody = el("div");
  const paddingBody = el("div");
  const alignBody = el("div");
  const typeBody = el("div");

  const margins = {};
  const paddings = {};
  for (const side_ of ["top", "right", "bottom", "left"]) {
    const name = side_[0].toUpperCase() + side_.slice(1);
    margins[side_] = stepper(name, "margin-" + side_, spacingStops);
    paddings[side_] = stepper(name, "padding-" + side_, spacingStops);
    marginBody.append(margins[side_].row);
    paddingBody.append(paddings[side_].row);
  }

  const textAlign = toggles("Text", "text-align", [["left", "Left"], ["center", "Centre"], ["right", "Right"]]);
  const justify = toggles("Justify", "justify-content", [["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["space-between", "Between"]]);
  const alignItems = toggles("Align", "align-items", [["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["stretch", "Stretch"]]);
  const flexHint = el("span", "hint", "Justify and align apply to a flex or grid container.");
  alignBody.append(textAlign.row, justify.row, alignItems.row, flexHint);

  const fontSize = stepper("Size", "font-size", () => FONT_SIZES.map((v) => ({ token: null, px: v })));
  const lineHeight = stepper("Line", "line-height", lineHeights);
  typeBody.append(fontSize.row, lineHeight.row);

  pane("Margin", marginBody);
  pane("Padding", paddingBody);
  pane("Alignment", alignBody);
  pane("Type", typeBody);
  pane("Pending edits", pendingList);

  function refreshControls() {
    if (!selected) return;
    for (const s of [...Object.values(margins), ...Object.values(paddings), fontSize, lineHeight]) s.render();
    textAlign.render();
    justify.render();
    alignItems.render();
    const display = getComputedStyle(selected).display;
    const flexish = /flex|grid/.test(display);
    justify.setDisabled(!flexish);
    alignItems.setDisabled(!flexish);
    flexHint.hidden = flexish;
  }

  /* Arrow keys move the selected element by its margin: one pixel on its own,
     one step of the spacing scale with shift. The sidebar's own fields keep
     their keys. */
  function editKeys(e) {
    if (mode !== "edit" || !selected) return;
    const target = shadow.activeElement;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    const axis = { ArrowUp: [margins.top, -1], ArrowDown: [margins.top, 1], ArrowLeft: [margins.left, -1], ArrowRight: [margins.left, 1] }[e.key];
    if (!axis) return;
    e.preventDefault();
    const [control, dir] = axis;
    if (e.shiftKey) control.step(dir);
    else control.nudge(dir);
  }

  revertBtn.addEventListener("click", revertAll);

  /* ----------------------------------------------------------------- save */

  let composing = null; /* what the composer will post when it is not annotate */

  function openComposer(kind) {
    composing = kind;
    kindSelect.value = kind.kind;
    panel.hidden = false;
    tools.hidden = kind.kind === "edit";
    counts.textContent = kind.summary;
    noteInput.focus();
  }

  function closeComposer() {
    composing = null;
    panel.hidden = true;
    noteInput.value = "";
    error.hidden = true;
  }

  saveEditsBtn.addEventListener("click", () => {
    const records = [...pending.values()];
    if (!records.length) return;
    openComposer({
      kind: "edit",
      summary: `${records.length} ${records.length === 1 ? "edit" : "edits"} on ${touched.size} ${touched.size === 1 ? "element" : "elements"}`,
      elements: [...touched.values()].map(snapshot),
      edits: records.map(({ selector, prop, from, to, token_from, token_to }) => ({ selector, prop, from, to, token_from, token_to })),
      drawing: null,
    });
  });

  function ticketBody() {
    const shared = {
      scope: scopeInputs.site.checked ? "site" : "page",
      kind: kindSelect.value,
      severity: sevSelect.value,
      page: { url: location.href, path: location.pathname, title: document.title },
      viewport: {
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        theme: document.documentElement.getAttribute("data-theme") || "dark",
      },
      note: noteInput.value.trim(),
      source: "human",
    };
    if (composing) return { ...shared, elements: composing.elements, edits: composing.edits, drawing: composing.drawing };
    return {
      ...shared,
      elements: picked,
      edits: [],
      drawing: strokes.length ? canvas.toDataURL("image/png") : null,
    };
  }

  saveBtn.addEventListener("click", () => {
    if (!noteInput.value.trim()) {
      error.textContent = "The note is what a baking agent reads. Say what is wrong.";
      error.hidden = false;
      return;
    }
    saveBtn.disabled = true;
    error.hidden = true;
    api("/tickets", { method: "POST", body: ticketBody() }).then(() => {
      closeComposer();
      /* Saved edits go back to source state: the ticket is the record now, and
         a project that wants them to survive the reload links overrides.css. */
      const back = mode;
      leave();
      enter(back);
      say("Ticket saved. It is open in the command centre.");
      refreshCount();
    }).catch((err) => {
      console.warn("g-admin", err);
      error.textContent = "The ticket did not save. Nothing here is lost, so try again.";
      error.hidden = false;
    }).finally(() => { saveBtn.disabled = false; });
  });

  cancelBtn.addEventListener("click", () => {
    if (composing) { closeComposer(); return; }
    setMode("off");
  });

  /* ---------------------------------------------------------------- modes */

  let mode = "off";

  /* Put everything back the way the page had it. Pending edits go too: they
     are unsaved DOM mutations, and leaving them behind would make the page lie
     about itself the moment the mode is off. */
  function leave() {
    lockScroll(false);
    revertAll();
    stage.hidden = true;
    boxes.replaceChildren();
    panel.hidden = true;
    side.hidden = true;
    hint.hidden = true;
    strokes.length = 0;
    picked = [];
    drawing = null;
    selected = null;
    hovered = null;
    composing = null;
    noteInput.value = "";
    error.hidden = true;
    hit.onpointerdown = hit.onpointermove = hit.onpointerup = null;
  }

  function enter(next) {
    mode = next;
    modeInputs[next].checked = true;
    if (next === "annotate") {
      lockScroll(true);
      sizeCanvas();
      redraw();
      stage.dataset.tool = "pin";
      toolInputs.pin.checked = true;
      stage.hidden = false;
      panel.hidden = false;
      tools.hidden = false;
      kindSelect.value = "visual";
      sevSelect.value = "minor";
      renderPicked();
      hit.onpointerdown = annotatePointerDown;
      hit.onpointermove = annotatePointerMove;
      hit.onpointerup = annotatePointerUp;
      say("Click an element to pin it, or draw over the problem. Esc leaves.", true);
      return;
    }
    stage.hidden = false;
    hit.onpointermove = editPointerMove;
    hit.onpointerup = editPointerUp;
    sevSelect.value = "minor";
    renderPending();
    say("Click an element to select it. Arrow keys nudge it. Esc leaves.", true);
  }

  /* "Off" is not a fourth mode, it is leaving: the overlay goes away and the
     browser is disarmed, so the next page load is an ordinary one until
     somebody visits with ?gadmin=1 again. */
  function setMode(next) {
    if (next === mode && next !== "off") return;
    leave();
    if (next !== "off") { enter(next); return; }
    mode = "off";
    try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
    host.remove();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
    window.__gAdmin = false;
  }

  function onKey(e) {
    if (e.key === "Escape" && mode !== "off") {
      e.preventDefault();
      if (composing) { closeComposer(); return; }
      if (mode === "edit" && selected) { selected = null; side.hidden = true; boxes.replaceChildren(); return; }
      setMode("off");
      return;
    }
    editKeys(e);
  }
  function onResize() {
    if (mode === "annotate") { sizeCanvas(); redraw(); renderPicked(); }
    scheduleRedrawBoxes();
  }
  function onScroll() {
    if (mode === "edit") scheduleRedrawBoxes();
  }
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, true);

  /* --------------------------------------------------------------- mount */

  function mount() {
    document.body.append(host);
    /* The shipped pane behaviour lives in g-ui.js and only ever walks the root
       it is given, so the shadow root is just another root to it. It has to
       run after the panes exist, which is why mounting is last. */
    window.g?.init?.(shadow);
    renderPending();
    refreshCount();
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
