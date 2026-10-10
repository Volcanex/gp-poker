/* g-design@1.6.0, vendored, do not edit. Update: node scripts/vendor.mjs from the g-design repo. */
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
   cannot bleed either way. The host page is touched in exactly three
   reversible ways, all undone on exit: annotate mode locks scrolling
   (viewport-relative boxes would otherwise point at the wrong thing the moment
   the page moved), edit mode writes inline styles on the selected element, and
   it mirrors those edits into one stylesheet in the head so they survive a
   page that re-renders itself. */
(() => {
  if (window.__gAdmin) return;
  window.__gAdmin = true;

  const SELF = document.currentScript?.src || location.href;
  const KEY = "g-admin";
  const MAX_ELEMENTS = 8;
  const MAX_HTML = 10000;
  const MIN_POINT_GAP = 9; /* squared px between recorded stroke points */
  const SEVERITIES = ["critical", "major", "minor", "polish"];
  const KINDS = ["edit", "bug", "visual", "content", "idea"];
  const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48];
  const FALLBACK_SP = [4, 8, 12, 16, 24, 32, 48, 64];
  const FALLBACK_LH = [16, 20, 24, 28, 32];
  const XRAY_MAX = 1200; /* boxes painted in one pass before the walk gives up */
  const XRAY_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "BR"]);
  const GRID = 4;
  const GRID_TOL = 0.05;
  const CLICK_SLOP = 4; /* px between two clicks that still count as the same point */
  const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  /* The one edit with no CSS property behind it. It travels the same pending
     path as the rest; the contract already allows any prop string. */
  const TEXT_PROP = "text";

  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || "";
  const base = (meta("g-admin-base") || "/api/gadmin").replace(/\/+$/, "");
  /* The instance's g-command-web origin. Without it the ticket count is plain
     text and the "Command centre" link is left out. */
  const COMMAND = meta("g-command").replace(/\/+$/, "");

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

  /* The stop a measurement is closest to, near or not. A gap of 13px lands on
     no token, and "13, near sp-3" is still a sentence somebody can act on;
     how near it has to be before the name is worth printing is gapLine's
     decision, not this one's. */
  const nearestStop = (stops, value) =>
    stops.reduce((best, s) => (Math.abs(s.px - value) < Math.abs(best.px - value) ? s : best));

  /* The families the host page declares on its own :root, and only those: a
     font name typed in here would name something the design system does not
     have. The three g names are offered wherever they resolve, and a project
     that declares more gets those too, which is why this scans rather than
     states. */
  function fontTokens() {
    const cs = getComputedStyle(document.documentElement);
    const names = new Set(["--font-ui", "--font-mono", "--font-display"]);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name.startsWith("--font-") && !/size|weight|feature|variant/.test(name)) names.add(name);
    }
    return [...names]
      .map((token) => ({ token, value: cs.getPropertyValue(token).trim() }))
      .filter((f) => f.value);
  }
  /* Computed font-family quotes and spaces its list its own way, so two
     declarations are the same family when they name the same first font. */
  const firstFamily = (v) => (v.split(",")[0] || "").trim().replace(/^["']|["']$/g, "").toLowerCase();

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
    mirrorAccent();
  }

  /* A project that rebranded g-design did it by overriding the accent slot on
     its :root, and nothing else. The overlay carries the same token layer
     re-scoped to :host, where an inline custom property on the host element
     wins, so copying those five across is the whole of wearing the host's
     brand: primary buttons and the switch come out in it, greys and spacing
     stay g-design. A page that never rebranded resolves none of them and gets
     stock g. Read alongside the theme rather than once at boot, because a
     rebrand is allowed to name a different accent per theme. */
  function mirrorAccent() {
    const cs = getComputedStyle(document.documentElement);
    for (const token of ["--accent", "--accent-fill", "--accent-fill-hover", "--accent-fg", "--accent-edge"]) {
      const value = cs.getPropertyValue(token).trim();
      if (value) host.style.setProperty(token, value);
    }
  }
  /* The x-ray sheet is painted pixels, not styled nodes, so a theme change
     repaints the page around it and would leave it in the colours of the
     theme before. It watches the body for changes; the theme is on the root,
     and this is the only observer that sees it. The initial mirrorTheme call
     stays out of here: the x-ray state is declared further down the file. */
  new MutationObserver(() => { mirrorTheme(); scheduleXray(); }).observe(document.documentElement, {
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
  /* X-ray is not a fourth mode: it is a lens over whichever mode is on, so it
     is a switch beside the modes rather than another radio in them. */
  const xrayLabel = el("label", "choice ga-tool-toggle");
  const xraySwitch = el("input");
  xraySwitch.type = "checkbox";
  xraySwitch.className = "switch";
  xrayLabel.append(xraySwitch, el("span", null, "X-ray"));
  /* Text is a tool over edit mode for the same reason: it needs the
     selection, the pending list and the save button that edit mode owns, and
     a fourth radio would have to borrow all three. */
  const textLabel = el("label", "choice ga-tool-toggle");
  const textSwitch = el("input");
  textSwitch.type = "checkbox";
  textSwitch.className = "switch";
  textLabel.append(textSwitch, el("span", null, "Text"));

  const countLink = el("a", "ga-count");
  if (COMMAND) {
    countLink.href = COMMAND + "/tickets";
    countLink.target = "_blank";
    countLink.rel = "noreferrer";
  }
  const countLabel = el("span", null, "Tickets");
  const countBadge = el("span", "badge badge-plain num");
  countBadge.hidden = true;
  countLink.append(countLabel, countBadge);
  const commandLink = el("a", null, "Command centre");
  commandLink.href = COMMAND;
  commandLink.target = "_blank";
  commandLink.rel = "noreferrer";
  bar.append(who, modes, xrayLabel, textLabel, el("span", "ga-spacer"), countLink);
  if (COMMAND) bar.append(commandLink);

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
  /* The x-ray sheet is under the drawing and the boxes: it is the blueprint
     the other two layers annotate, and hundreds of boxes are one canvas
     rather than hundreds of nodes, which is what keeps layout out of it. */
  const xrayCanvas = el("canvas", "ga-xray");
  xrayCanvas.setAttribute("aria-hidden", "true");
  xrayCanvas.hidden = true;
  const canvas = el("canvas", "ga-canvas");
  canvas.setAttribute("aria-hidden", "true");
  const boxes = el("div", "ga-boxes");
  const hit = el("div", "ga-hit");
  stage.append(xrayCanvas, canvas, boxes, hit);

  function sizeCanvas(node = canvas) {
    const dpr = window.devicePixelRatio || 1;
    node.width = Math.round(window.innerWidth * dpr);
    node.height = Math.round(window.innerHeight * dpr);
  }

  function place(node, rect, inset = 2) {
    node.style.left = rect.x - inset + "px";
    node.style.top = rect.y - inset + "px";
    node.style.width = rect.w + inset * 2 + "px";
    node.style.height = rect.h + inset * 2 + "px";
  }

  /* Everything under a point that belongs to the page, topmost first:
     everything of ours lives in the shadow root, so skipping it is one
     containment check. The whole stack rather than the top of it, because a
     covered element is reachable only by naming the ones covering it. */
  function stackUnder(x, y) {
    return (document.elementsFromPoint(x, y) || []).filter((node) =>
      node !== host && !shadow.contains(node) && node !== document.body && node !== document.documentElement);
  }
  const elementUnder = (x, y) => stackUnder(x, y)[0] || null;

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

  /* ---------------------------------------------------------------- x-ray */

  /* Selection answers "what is this one". X-ray answers "what is all of it":
     every visible box painted at once, margin and padding in the two tints
     the box-model shading already uses, so a page reads as a blueprint and
     the thing that is wrong can be found by looking rather than by clicking.

     One canvas, one pass. Per-element decorations would put hundreds of nodes
     into the host page's layout, and the overlay's whole promise is that it
     changes no layout. */

  const legend = el("div", "ga-legend");
  legend.hidden = true;
  const legendCount = el("span", "ga-legend-count num");
  for (const [cls, label] of [["ga-sw-margin", "Margin"], ["ga-sw-pad", "Padding"], ["ga-sw-off", "Off grid"], ["ga-sw-depth", "Depth"]]) {
    const item = el("span", "ga-legend-item");
    item.append(el("i", "ga-sw " + cls), el("span", null, label));
    legend.append(item);
  }
  legend.append(legendCount);

  let xrayOn = false;

  /* Flat list of what the viewport can show, with the depth each box sits at.
     An element outside the viewport can still hold one inside it, so the walk
     descends through everything and only the painting is clipped. */
  function xrayScan() {
    const out = [];
    if (!document.body) return out;
    const vw = window.innerWidth, vh = window.innerHeight;
    const contentTop = (r, cs) => r.top + px(cs.borderTopWidth) + px(cs.paddingTop);
    const walk = (node, depth, parentCs, origin) => {
      for (const child of node.children) {
        if (out.length >= XRAY_MAX) return;
        if (child === host || XRAY_SKIP.has(child.tagName)) continue;
        if (child.classList.contains("sr-only") || child.hasAttribute("data-audit-skip")) continue;
        const cs = getComputedStyle(child);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
        const r = child.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) {
          out.push({ el: child, r, cs, depth, parentCs, origin });
        }
        /* Icons are glyphs, not layout: the svg box is painted, its geometry
           inside is not. Same call the rhythm audit makes. */
        if (!(child instanceof SVGElement)) walk(child, depth + 1, cs, contentTop(r, cs));
      }
    };
    const bodyCs = getComputedStyle(document.body);
    walk(document.body, 0, bodyCs, contentTop(document.body.getBoundingClientRect(), bodyCs));
    return out;
  }

  /* Off the 4px grid, by the same rules as scripts/rhythm-audit.mjs, and the
     same number: measured from the container's content box, not from the top
     of the page. The page number inherits every border above it, so on a
     bordered design it flags most of the screen and says nothing; the local
     number is the one somebody can act on. An element the layout centres or
     takes out of flow is not placed by its author, so it is never flagged. */
  const offGrid = (v) => {
    const r = Math.abs(v) % GRID;
    return Math.min(r, GRID - r) > GRID_TOL;
  };
  function placedByAuthor(item) {
    const { cs, parentCs } = item;
    if (cs.position === "absolute" || cs.position === "fixed") return false;
    if (cs.display === "inline") return false;
    if (!parentCs || !/flex|grid/.test(parentCs.display)) return true;
    const align = cs.alignSelf === "auto" ? parentCs.alignItems : cs.alignSelf;
    return !(align === "center" || align === "baseline" || align === "flex-end" || align === "end");
  }

  const strips = (x, y, w, h, s) => [
    [x - s.left, y - s.top, w + s.left + s.right, s.top],
    [x - s.left, y + h, w + s.left + s.right, s.bottom],
    [x - s.left, y, s.left, h],
    [x + w, y, s.right, h],
  ];

  function paintXray() {
    const ctx = xrayCanvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, xrayCanvas.width, xrayCanvas.height);
    if (!xrayOn) return;
    ctx.scale(dpr, dpr);

    /* A canvas cannot resolve a custom property, so every colour is read off
       the overlay root, which carries the token layer whether or not the host
       page does. The alphas match the two shading rules in g-admin.css. */
    const cs = getComputedStyle(host);
    const token = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const ink = token("--accent-edge", token("--text-primary", "#fff"));
    const marginInk = token("--warn-text", "#ffca16");
    const padInk = token("--chart-2", "#6e56cf");
    const offInk = token("--danger-text", "#ff9592");

    const items = xrayScan();
    let off = 0;
    for (const item of items) {
      const { r, cs: ecs, depth } = item;
      const margin = { top: px(ecs.marginTop), right: px(ecs.marginRight), bottom: px(ecs.marginBottom), left: px(ecs.marginLeft) };
      const padding = { top: px(ecs.paddingTop), right: px(ecs.paddingRight), bottom: px(ecs.paddingBottom), left: px(ecs.paddingLeft) };

      ctx.globalAlpha = 0.14;
      ctx.fillStyle = marginInk;
      for (const [x, y, w, h] of strips(r.x, r.y, r.width, r.height, margin)) {
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = padInk;
      const inner = { x: r.x + padding.left, y: r.y + padding.top, w: Math.max(0, r.width - padding.left - padding.right), h: Math.max(0, r.height - padding.top - padding.bottom) };
      for (const [x, y, w, h] of strips(inner.x, inner.y, inner.w, inner.h, padding)) {
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }

      /* Depth reads as weight: the outer boxes are the frame of the page and
         hold the eye, the inner ones recede rather than compete. */
      ctx.globalAlpha = Math.max(0.12, 0.62 - depth * 0.06);
      ctx.lineWidth = depth < 2 ? 1.5 : 1;
      ctx.strokeStyle = ink;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.max(1, Math.round(r.width) - 1), Math.max(1, Math.round(r.height) - 1));

      if (!placedByAuthor(item)) continue;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = offInk;
      ctx.lineWidth = 2;
      for (const edge of [r.top, r.bottom]) {
        if (!offGrid(edge - item.origin)) continue;
        off++;
        ctx.beginPath();
        ctx.moveTo(r.left, Math.round(edge) + 0.5);
        ctx.lineTo(r.right, Math.round(edge) + 0.5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const boxWord = items.length === 1 ? "box" : "boxes";
    legendCount.textContent = off
      ? `${items.length} ${boxWord}, ${off} off grid`
      : `${items.length} ${boxWord}`;
  }

  let xrayFrame = 0;
  function scheduleXray() {
    if (!xrayOn || xrayFrame) return;
    xrayFrame = requestAnimationFrame(() => { xrayFrame = 0; paintXray(); });
  }

  /* The page redrawing itself is the one repaint trigger that is not ours, and
     the overlay's own nodes are inside the host element, which is how they are
     told apart without a second observer. */
  const xrayWatch = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target === host || host.contains(record.target)) continue;
      scheduleXray();
      return;
    }
  });
  function watchXray(on) {
    if (on) xrayWatch.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    else xrayWatch.disconnect();
  }

  function setXray(on) {
    xrayOn = on;
    xraySwitch.checked = on;
    xrayCanvas.hidden = !on;
    legend.hidden = !on;
    if (!on) {
      watchXray(false);
      paintXray();
      return;
    }
    /* Off is not a mode, it is the overlay gone, so there is no stage to paint
       on. Edit mode is where a box found by looking becomes a box you can
       change, which is the reason to be looking. */
    if (mode === "off") setMode("edit");
    else {
      sizeCanvas(xrayCanvas);
      watchXray(true);
      paintXray();
    }
    say("X-ray on. Square brackets walk the layers, alt-click reaches what is underneath.", true);
  }
  xraySwitch.addEventListener("change", () => setXray(xraySwitch.checked));

  /* ----------------------------------------------------------------- help */

  /* Every binding in one place, because a tool driven by single letters that
     never says what they are is a tool nobody drives. Shift and slash opens
     it, and it is built from the shipped pane stack rather than a list of its
     own. */
  const HELP = [
    ["Modes", [
      ["a", "Annotate mode"],
      ["e", "Edit mode"],
      ["x", "X-ray lens"],
      ["t", "Text tool"],
      ["cmd shift k", "Show or hide the overlay"],
      ["esc", "Step out, and again to leave"],
    ]],
    ["Selection", [
      ["click", "Select the element"],
      ["alt click", "Select what is underneath it"],
      ["shift click", "Add it to the selection"],
      ["[", "Walk out to the container"],
      ["]", "Walk into the first child"],
      ["hover", "Measure the gap from the selection"],
      ["gap click", "Jump to the property that owns a gap"],
    ]],
    ["Editing", [
      ["arrows", "Nudge the margin by a pixel"],
      ["shift arrows", "Nudge it by one spacing step"],
      ["delete", "Hide the element"],
      ["m", "Margin pane"],
      ["p", "Padding pane"],
      ["shift /", "Show this sheet"],
    ]],
  ];

  const help = el("div", "ga-help");
  help.hidden = true;
  help.setAttribute("role", "dialog");
  help.setAttribute("aria-label", "Keyboard shortcuts");
  const helpScrim = el("div", "g-scrim");
  const helpCard = el("div", "card ga-help-card");
  const helpHead = el("div", "ga-help-head");
  const helpClose = el("button", "btn btn-sm btn-tertiary", "Close");
  helpClose.type = "button";
  helpHead.append(el("span", "ga-help-title", "Keyboard shortcuts"), el("span", "ga-spacer"), helpClose);
  const helpStack = el("div", "g-pane-stack");
  for (const [title, rows] of HELP) {
    const section = el("section", "g-pane");
    const head = el("button", "g-pane-title", title);
    head.type = "button";
    head.setAttribute("aria-expanded", "true");
    const body = el("div", "g-pane-body");
    for (const [keys, what] of rows) {
      const row = el("div", "ga-help-row");
      const keyList = el("span", "ga-help-keys");
      for (const key of keys.split(" ")) keyList.append(el("span", "kbd", key));
      row.append(keyList, el("span", "ga-help-what", what));
      body.append(row);
    }
    section.append(head, body);
    helpStack.append(section);
  }
  helpCard.append(helpHead, helpStack);
  help.append(helpScrim, helpCard);
  const closeHelp = () => { help.hidden = true; };
  const toggleHelp = () => { help.hidden = !help.hidden; };
  helpClose.addEventListener("click", closeHelp);
  helpScrim.addEventListener("click", closeHelp);

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
  /* Said in words rather than counted off the boxes: a multi-selection is the
     one state where the controls write somewhere the head is not pointing, and
     what the set has in common is the thing worth saying about it. */
  const sideMulti = el("div", "ga-multi");
  sideMulti.hidden = true;
  const sideShape = el("span");
  const selectAllBtn = el("button", "btn btn-sm btn-tertiary");
  selectAllBtn.type = "button";
  selectAllBtn.hidden = true;
  sideMulti.append(sideShape, selectAllBtn);
  const crumbs = el("nav", "ga-crumbs");
  crumbs.setAttribute("aria-label", "Ancestry");
  sideHead.append(sideSel, sideDims, sideMulti, crumbs);
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

  /* overscroll-behavior only contains a wheel while the body actually
     overflows; when the panes fit, the chain skips the panel and scrolls the
     page under the pointer. A devtools panel never does that, so the wheel
     is consumed here whether or not there is anywhere for it to go. */
  side.addEventListener("wheel", (e) => {
    e.preventDefault();
    sideBody.scrollTop += e.deltaY;
  }, { passive: false });

  function pane(title, body) {
    const section = el("section", "g-pane");
    const head = el("button", "g-pane-title", title);
    head.type = "button";
    head.setAttribute("aria-expanded", "true");
    const bodyEl = el("div", "g-pane-body");
    bodyEl.append(body);
    section.append(head, bodyEl);
    paneStack.append(section);
    return section;
  }

  const wrap = el("div", "ga");
  /* The legend is last so a CSS sibling rule can move it out from under the
     inspector; its z-index, not its position here, is what keeps it on top. */
  wrap.append(bar, stage, hint, panel, side, help, legend);
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
  let selectedSelector = ""; /* the durable name for it, for when the node is replaced */
  let extras = []; /* the rest of a multi-selection: {el, selector} */
  const pending = new Map(); /* `${selector}|${prop}` -> edit record */
  const touched = new Map(); /* selector -> element */
  const editOutline = el("div", "ga-out");
  const editTag = el("span", "ga-tag");
  editOutline.append(editTag);
  const shades = { top: [], right: [], bottom: [], left: [] };

  function shadeBox(kind, rect, sides, flash) {
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
      const node = el("div", flash ? kind + " ga-flash" : kind);
      node.style.left = s.x + "px";
      node.style.top = s.y + "px";
      node.style.width = s.w + "px";
      node.style.height = s.h + "px";
      boxes.append(node);
    }
  }

  const px = (v) => Math.round(parseFloat(v) || 0);

  /* Restarting an animation on an element that is already on screen takes all
     three steps: the class leaves, the layout is read, the class comes back. */
  function flash(node) {
    if (!node) return;
    node.classList.remove("ga-flash");
    void node.offsetWidth;
    node.classList.add("ga-flash");
  }

  /* The rest of a multi-selection, in the dashed box annotate mode already
     uses for an element that has been taken: same meaning, one less thing to
     learn. Every draw ends here, so the set stays visible while the pointer
     is somewhere else entirely. */
  function drawExtras(flashing) {
    for (const extra of extras) {
      const node = live(extra.el, extra.selector);
      if (!node) continue;
      extra.el = node;
      const rect = rectOf(node);
      if (!rect.w && !rect.h) continue;
      const box = el("div", flashing ? "ga-pick ga-pick-sel ga-flash" : "ga-pick ga-pick-sel");
      place(box, rect);
      boxes.append(box);
    }
  }

  function drawEditBoxes(node, flashing) {
    if (node === selected) {
      const fresh = live(selected, selectedSelector);
      if (fresh) { selected = fresh; node = fresh; }
    }
    boxes.replaceChildren();
    gapHits = [];
    if (!node || !node.isConnected) { drawExtras(flashing); return; }
    const rect = rectOf(node);
    /* Hidden, by an edit of ours or by the page itself. There is no box to
       draw, and a collapsed outline in the corner of the screen would be a
       lie about where the element is. */
    if (!rect.w && !rect.h) {
      if (node === selected) sideDims.textContent = "Hidden";
      drawExtras(flashing);
      return;
    }
    const cs = getComputedStyle(node);
    const margin = { top: px(cs.marginTop), right: px(cs.marginRight), bottom: px(cs.marginBottom), left: px(cs.marginLeft) };
    const padding = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    shadeBox("ga-margin", rect, margin, flashing);
    shadeBox("ga-pad", { x: rect.x + padding.left, y: rect.y + padding.top, w: Math.max(0, rect.w - padding.left - padding.right), h: Math.max(0, rect.h - padding.top - padding.bottom) },
      { top: padding.top, right: padding.right, bottom: padding.bottom, left: padding.left }, flashing);
    place(editOutline, rect);
    editTag.textContent = selectorFor(node).split(" > ").pop();
    boxes.append(editOutline);
    if (flashing) flash(editOutline);
    else editOutline.classList.remove("ga-flash");
    if (node === selected) {
      sideDims.textContent = `${rect.w} by ${rect.h}`;
    }
    drawExtras(flashing);
  }

  /* --------------------------------------------------------------- measure */

  /* Hovering with nothing selected asks "what is this box". Hovering with
     something selected asks "how far is it from this one", which is the
     question a spacing decision actually turns on and the one thing devtools
     will not answer. Two cases, and they are different questions: boxes that
     face each other across a gap get the gap, boxes that overlap (the usual
     one, an element inside its container) get the four edge offsets. */

  const measureOutline = el("div", "ga-out ga-out-ghost");
  const measureTag = el("span", "ga-tag");
  measureOutline.append(measureTag);

  /* The chips drawn by the last measurement, with the thunk that works out
     what owns each one. A thunk rather than an answer: the owner costs several
     computed-style reads and the pointer redraws this on every frame it
     moves, where a click happens once. */
  let gapHits = [];

  function gapLine(x, y, horizontal, dist, stops, owner) {
    if (dist < 0.5) return; /* touching edges: a zero-length line says nothing */
    const line = el("div", "ga-gap");
    line.style.left = x + "px";
    line.style.top = y + "px";
    line.style.width = (horizontal ? dist : 1) + "px";
    line.style.height = (horizontal ? 1 : dist) + "px";
    const round = Math.round(dist);
    const stop = nearestStop(stops, round);
    const off = Math.abs(stop.px - round);
    /* A stop is only worth naming when the gap is actually near it. A quarter
       of the stop's own value keeps 13 reading as a near miss on sp-3 and
       stops 109 claiming to be sp-8, which is the label saying nothing at the
       exact moment it should say "this is on nothing". */
    const near = off <= Math.max(2, stop.px * 0.25);
    const name = near ? (stop.token || "").replace("--", "") : "";
    line.toggleAttribute("data-off", off >= 0.5);
    const label = el("span", "ga-gap-val", name ? `${round} ${name}` : String(round));
    label.title = off < 0.5 ? `${round}px` : (name ? `${round}px, nearest ${name}` : `${round}px, off the spacing scale`);
    line.append(label);
    boxes.append(line);
    if (owner) gapHits.push({ label, owner });
  }

  function drawMeasure(a, b) {
    boxes.replaceChildren();
    gapHits = [];
    const ra = rectOf(a), rb = rectOf(b);
    place(editOutline, ra);
    editTag.textContent = selectorFor(a).split(" > ").pop();
    editOutline.classList.remove("ga-flash");
    place(measureOutline, rb);
    measureTag.textContent = selectorFor(b).split(" > ").pop();
    boxes.append(editOutline, measureOutline);

    const stops = spacingStops();
    /* Where to put the line: through the part the two boxes share, and
       through the selected box's own middle when they share nothing. */
    const mid = (a0, a1, b0, b1) => {
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      return hi > lo ? (lo + hi) / 2 : (a0 + a1) / 2;
    };
    const ax2 = ra.x + ra.w, ay2 = ra.y + ra.h, bx2 = rb.x + rb.w, by2 = rb.y + rb.h;
    if (Math.min(ax2, bx2) > Math.max(ra.x, rb.x) && Math.min(ay2, by2) > Math.max(ra.y, rb.y)) {
      /* Four edge offsets, which is the padding question asked from outside,
         so the owner is a container-and-child question wherever the DOM says
         one of these is inside the other. */
      const inside = a.contains(b) ? [a, b] : b.contains(a) ? [b, a] : null;
      const at = (side) => () => (inside ? insideOwner(inside[0], inside[1], side) : overlapOwner(a, b, side));
      const x = mid(ra.x, ax2, rb.x, bx2), y = mid(ra.y, ay2, rb.y, by2);
      gapLine(x, Math.min(ra.y, rb.y), false, Math.abs(ra.y - rb.y), stops, at("top"));
      gapLine(x, Math.min(ay2, by2), false, Math.abs(ay2 - by2), stops, at("bottom"));
      gapLine(Math.min(ra.x, rb.x), y, true, Math.abs(ra.x - rb.x), stops, at("left"));
      gapLine(Math.min(ax2, bx2), y, true, Math.abs(ax2 - bx2), stops, at("right"));
      return;
    }
    /* Two boxes facing each other across a gap: whichever comes first owns the
       facing side, unless the container is spacing them. */
    const y = mid(ra.y, ay2, rb.y, by2);
    if (rb.x >= ax2) gapLine(ax2, y, true, rb.x - ax2, stops, () => betweenOwner(a, b, "right"));
    else if (ra.x >= bx2) gapLine(bx2, y, true, ra.x - bx2, stops, () => betweenOwner(b, a, "right"));
    const x = mid(ra.x, ax2, rb.x, bx2);
    if (rb.y >= ay2) gapLine(x, ay2, false, rb.y - ay2, stops, () => betweenOwner(a, b, "bottom"));
    else if (ra.y >= by2) gapLine(x, by2, false, ra.y - by2, stops, () => betweenOwner(b, a, "bottom"));
  }

  /* --------------------------------------------------------- gap ownership */

  /* A measured gap is a number until you know which declaration produced it,
     and changing it is the reason to have measured. Clicking the chip answers
     that: it selects the element the gap belongs to, opens the pane the
     property lives in and flashes the row, which is the same walk a person
     would do by hand from the number.

     The precedence is the order the browser resolves these in, and the answer
     is never dressed up as more certain than it is: where a second declaration
     is also adding to the gap, the hint names it rather than leaving the first
     reading to look complete. */

  const FACING = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const axisRow = (side) => (side === "left" || side === "right" ? justify.row : alignItems.row);

  /* A gap between a child and the edge of what contains it. */
  function insideOwner(container, child, side) {
    const cs = getComputedStyle(container);
    const pad = px(cs.getPropertyValue("padding-" + side));
    const mar = px(getComputedStyle(child).getPropertyValue("margin-" + side));
    const childMargin = `${crumbLabel(child)}'s margin-${side}`;
    if (pad > 0) {
      return { el: container, pane: paddingPane, row: paddings[side].row,
        why: `That gap is ${crumbLabel(container)}'s padding-${side}${mar > 0 ? `, and ${childMargin} on top of it` : ""}.` };
    }
    if (mar > 0) {
      return { el: child, pane: marginPane, row: margins[side].row,
        why: `That gap is ${childMargin}. The container declares no padding on that side.` };
    }
    /* Nothing is declared on either box, so a flex or grid container placed
       the child there and the Alignment pane is where it moves. */
    if (/flex|grid/.test(cs.display)) {
      return { el: container, pane: alignPane, row: axisRow(side),
        why: `${crumbLabel(container)} places this one, so that gap is its alignment, or ${childMargin}.` };
    }
    return { el: container, pane: paddingPane, row: paddings[side].row,
      why: `Nothing declares that gap. The container's padding-${side} is where to put it, or ${childMargin}.` };
  }

  /* A gap between two boxes that face each other, first in document order
     first. */
  function betweenOwner(first, second, side) {
    const other = FACING[side];
    const firstMargin = px(getComputedStyle(first).getPropertyValue("margin-" + side));
    const secondMargin = px(getComputedStyle(second).getPropertyValue("margin-" + other));
    const parent = first.parentElement;
    if (parent && second.parentElement === parent) {
      const ps = getComputedStyle(parent);
      if (/flex|grid/.test(ps.display)) {
        const own = px(side === "left" || side === "right" ? ps.columnGap : ps.rowGap);
        if (own > 0) {
          return { el: parent, pane: alignPane, row: null,
            why: `This gap comes from the container's gap, on ${crumbLabel(parent)}${firstMargin || secondMargin ? ", with a margin added to it" : ""}.` };
        }
      }
    }
    /* The first box's facing margin is the usual answer, but naming a margin
       of zero while the other box declares exactly this gap is not a
       diagnosis, so the one that is actually there wins. */
    const takeSecond = !firstMargin && secondMargin > 0;
    const owner = takeSecond ? second : first;
    const ownSide = takeSecond ? other : side;
    const alt = takeSecond ? first : second;
    const altSide = takeSecond ? side : other;
    return { el: owner, pane: marginPane, row: margins[ownSide].row,
      why: `That gap is ${crumbLabel(owner)}'s margin-${ownSide}, or ${crumbLabel(alt)}'s margin-${altSide}.` };
  }

  /* Two boxes that overlap without one containing the other. Something placed
     them there, and on this shape it is nearly always a positioned box sitting
     on its inset, which the inspector has no control for: the margin pane is
     where it says so. */
  function overlapOwner(a, b, side) {
    const placed = [b, a].find((node) => /absolute|fixed/.test(getComputedStyle(node).position));
    if (!placed) return betweenOwner(a, b, side);
    return { el: placed, pane: marginPane, row: margins[side].row,
      why: `${crumbLabel(placed)} is positioned, so that offset is its ${side} inset, or a margin shifting it from there.` };
  }

  /* The chip under a point, with a few pixels of slop: the line is one pixel
     wide and the label is the part anybody aims at. */
  function gapAt(x, y) {
    for (const spot of gapHits) {
      const r = spot.label.getBoundingClientRect();
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) return spot;
    }
    return null;
  }

  function jumpToGap(owner) {
    if (!owner) return;
    stage.removeAttribute("data-gap");
    if (owner.el && owner.el !== currentTarget()) walkTo(owner.el);
    else { hovered = null; paintBoxes(); }
    focusPane(owner.pane);
    /* The same signal an applied edit gives, for the same reason: the pane it
       scrolled to holds eight rows and none of them moved. */
    flash(owner.row || owner.pane);
    say(owner.why);
  }

  /* One decision about what the box layer is showing, so the scheduled redraw
     and the pointer take the same path. */
  function paintBoxes(flashing) {
    if (mode === "edit" && selected && hovered && hovered !== selected && !textOn && hovered.isConnected) {
      const primary = currentTarget();
      if (primary) { drawMeasure(primary, hovered); drawExtras(false); return; }
    }
    drawEditBoxes(hovered || selected, flashing);
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
      paintBoxes();
      if (selected) refreshControls();
    });
  }

  function editPointerMove(e) {
    /* Reaching a gap chip means crossing the gap, and what is under a gap is
       not what was being measured, so the whole reading holds while the
       pointer is on a chip. Without that the chip walks away from the pointer
       on its way to it. */
    const spot = gapAt(e.clientX, e.clientY);
    stage.toggleAttribute("data-gap", !!spot);
    for (const other of gapHits) other.label.classList.toggle("ga-gap-on", other === spot);
    if (spot) return;
    /* The text tool outlines what it would take, which is the topmost element
       whose whole content is text, not the topmost element. */
    const node = textOn
      ? stackUnder(e.clientX, e.clientY).find(textish) || null
      : elementUnder(e.clientX, e.clientY);
    if (node === hovered) return;
    hovered = node;
    paintBoxes();
  }

  /* Clicking takes the topmost element, which is the one thing a click can
     mean. Clicking the same point again, or holding alt, takes the next one
     down the stack instead: that is the only way to reach an element another
     element covers, and covered is where the layout problems live. */
  function editPointerUp(e) {
    const spot = gapAt(e.clientX, e.clientY);
    if (spot) { jumpToGap(spot.owner()); return; }
    const stack = stackUnder(e.clientX, e.clientY);
    if (!stack.length) return;
    if (textOn) { startText(stack); return; }
    if ((e.shiftKey || e.metaKey || e.ctrlKey) && selected) { addToSelection(stack[0]); return; }
    const repeat = lastPoint && Math.abs(lastPoint.x - e.clientX) <= CLICK_SLOP && Math.abs(lastPoint.y - e.clientY) <= CLICK_SLOP;
    const at = selected ? stack.indexOf(selected) : -1;
    const next = (e.altKey || repeat) && at !== -1 ? stack[(at + 1) % stack.length] : stack[0];
    lastPoint = { x: e.clientX, y: e.clientY };
    trail = [];
    select(next);
    if (next !== stack[0]) say(`Selected the element under it, ${stack.indexOf(next) + 1} of ${stack.length} at this point.`);
  }

  function select(node) {
    selected = node;
    selectedSelector = selectorFor(node);
    /* A fresh selection is a fresh start: the walk trail and the rest of a
       multi-selection both belong to the selection they were made from. */
    extras = [];
    hovered = null;
    sideSel.textContent = selectedSelector;
    side.hidden = false;
    renderSelection();
    renderCrumbs();
    drawEditBoxes(node);
    refreshControls();
  }

  /* --------------------------------------------------------- multi-select */

  /* Shift adds. The first click stays the primary: the head, the crumbs, the
     box model and every number in the sidebar point at one element, and the
     controls write to all of them. Shift-clicking one that is already in the
     set takes it out again. */
  function addToSelection(node) {
    if (!node || node === selected) return;
    const selector = selectorFor(node);
    const at = extras.findIndex((x) => x.selector === selector);
    if (at !== -1) extras.splice(at, 1);
    else if (extras.length + 1 >= MAX_ELEMENTS) {
      say(`A ticket carries ${MAX_ELEMENTS} elements at most.`);
      return;
    } else extras.push({ el: node, selector });
    hovered = null;
    drawEditBoxes(selected);
    renderSelection();
    refreshControls();
  }

  /* What a multi-selection has in common is the thing worth knowing about it:
     three boxes that are all button.btn.btn-secondary are one class waiting to
     be changed, and three of three different tags are three separate edits
     that happen to be selected together. The signature is the tag every
     element shares plus the classes all of them carry, in the primary's own
     order, and null the moment the tags disagree. */
  function sharedSignature(nodes = selection()) {
    if (nodes.length < 2) return null;
    const tag = nodes[0].tagName;
    if (!nodes.every((node) => node.tagName === tag)) return null;
    const classes = [...nodes[0].classList].filter((c) => nodes.every((node) => node.classList.contains(c)));
    const name = tag.toLowerCase();
    return {
      classes,
      label: name + classes.map((c) => "." + c).join(""),
      selector: name + classes.map((c) => "." + CSS.escape(c)).join(""),
    };
  }

  const tagsIn = (nodes) => [...new Set(nodes.map((node) => node.tagName.toLowerCase()))].join(", ");

  /* Everything on the page wearing the signature. Ours is in the shadow root,
     so leaving it out is one containment check, the same as stackUnder. */
  function likeThis(sig) {
    try {
      return [...document.querySelectorAll(sig.selector)].filter((node) => node !== host && !shadow.contains(node));
    } catch { return []; /* a class the page can no longer escape */ }
  }

  function renderSelection() {
    sideMulti.hidden = !extras.length;
    if (!extras.length) return;
    const nodes = selection();
    const sig = sharedSignature(nodes);
    sideShape.textContent = `${nodes.length} elements selected, ${sig ? `all ${sig.label}` : `mixed (${tagsIn(nodes)})`}. Spacing, alignment and type apply to all of them.`;
    /* Offered only where it would add something. A signature with no class is
       every div on the page, and a page holding nothing else like this has
       nothing left to add. */
    const rest = sig && sig.classes.length ? likeThis(sig) : [];
    selectAllBtn.hidden = rest.length <= nodes.length;
    if (!selectAllBtn.hidden) selectAllBtn.textContent = `Select all ${rest.length} like this on the page`;
  }

  /* The cap belongs to the ticket rather than to the page, so it is said when
     it bites rather than silently obeyed: a selection that stopped at eight
     without saying so would be a ticket quietly missing half its subject. */
  function selectAllLike() {
    const sig = sharedSignature();
    if (!sig || !sig.classes.length) return;
    const rest = likeThis(sig);
    const already = new Set(selection());
    let capped = false;
    for (const node of rest) {
      if (already.has(node)) continue;
      if (extras.length + 1 >= MAX_ELEMENTS) { capped = true; break; }
      extras.push({ el: node, selector: selectorFor(node) });
    }
    hovered = null;
    drawEditBoxes(selected);
    renderSelection();
    refreshControls();
    const n = extras.length + 1;
    if (capped) say(`A ticket carries ${MAX_ELEMENTS} elements at most, so ${n} of the ${rest.length} like this are selected.`);
    else say(`${n} elements selected, every ${sig.label} on the page.`);
  }
  selectAllBtn.addEventListener("click", selectAllLike);

  /* Live references to everything a control writes to, primary first. */
  function selection() {
    const out = [];
    const primary = currentTarget();
    if (primary) out.push(primary);
    for (const extra of extras) {
      const node = live(extra.el, extra.selector);
      if (!node) continue;
      extra.el = node;
      if (!out.includes(node)) out.push(node);
    }
    return out;
  }

  /* Every control writes through here, because a control points at the
     selection and the selection can be more than one element. The value is
     the primary's: a stepper shows one number, and stepping it says "make
     them all this", not "move each of them by that much". */
  function applyToSelection(prop, value, stops, tokenName) {
    for (const node of selection()) applyEdit(node, prop, value, stops, tokenName);
  }

  /* ------------------------------------------------------------ layer walk */

  /* The ancestry is a stack, so move through it like one. Up is the container
     the thing sits in, down is back where you came from, and both keep the
     sidebar pointed at whatever the walk landed on, so a box found by looking
     is a box you can edit without hunting for a click that hits it. */

  let lastPoint = null;
  let trail = []; /* selections the walk stepped through, for Esc to unwind */
  const cameFrom = new WeakMap(); /* container -> the child the walk came up from */

  const walkable = (node) => node && node.nodeType === 1 && node !== host
    && node !== document.body && node !== document.documentElement;

  function walkTo(node) {
    if (!node || node === selected) return;
    if (selected) trail.push(selected);
    select(node);
  }

  function walkUp() {
    const from = currentTarget();
    const parent = from?.parentElement;
    if (!walkable(parent)) { say("Nothing outside this one to select."); return; }
    cameFrom.set(parent, from);
    walkTo(parent);
  }

  function walkDown() {
    const from = currentTarget();
    if (!from) return;
    const back = cameFrom.get(from);
    const next = back && back.isConnected && back.parentElement === from
      ? back
      : [...from.children].find((child) => {
        if (child === host || XRAY_SKIP.has(child.tagName)) return false;
        const r = child.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
      });
    if (!next) { say("Nothing inside this one to select."); return; }
    walkTo(next);
  }

  const crumbLabel = (node) => {
    const tag = node.tagName.toLowerCase();
    if (node.id) return tag + "#" + node.id;
    const cls = [...node.classList][0];
    return cls ? tag + "." + cls : tag;
  };

  function renderCrumbs() {
    crumbs.replaceChildren();
    if (!selected) return;
    const chain = [];
    for (let node = selected; walkable(node); node = node.parentElement) chain.unshift(node);
    chain.forEach((node, i) => {
      if (i) crumbs.append(el("span", "ga-crumb-sep", ">"));
      const crumb = el("button", "ga-crumb", crumbLabel(node));
      crumb.type = "button";
      if (node === selected) crumb.setAttribute("aria-current", "true");
      crumb.addEventListener("click", () => { trail = []; select(node); });
      crumbs.append(crumb);
    });
    /* The end of the chain is the interesting end, and scrollIntoView inside a
       shadow root will scroll the host page to get there. */
    crumbs.scrollLeft = crumbs.scrollWidth;
  }

  /* Focus in a field means the page or the sidebar is taking the key, and the
     walk must not take it as well. Both roots are asked: the host page keeps
     its own focus while the overlay is up. */
  function typingNow() {
    for (const node of [shadow.activeElement, document.activeElement]) {
      if (!node || node === host) continue;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable) return true;
    }
    return false;
  }

  /* Square brackets walk, and alt with the arrows walks too. The arrows on
     their own already nudge the selected element by its margin, and a key
     that does two things depending on what you last touched is worse than
     two keys. */
  function walkKeys(e) {
    if (mode !== "edit" || !selected || typingNow()) return false;
    const up = e.key === "[" || (e.altKey && e.key === "ArrowUp");
    const down = e.key === "]" || (e.altKey && e.key === "ArrowDown");
    if (!up && !down) return false;
    e.preventDefault();
    if (up) walkUp();
    else walkDown();
    return true;
  }

  /* ------------------------------------------------------------------ text */

  /* Editing copy is the one change that is not a CSS property, and it still
     has to be a pending edit: it reverts, it lands in the pending list, and it
     saves as a ticket with an edits record of `{prop: "text"}`, which the
     contract already allows. It takes only an element whose whole content is
     one run of text, because that is the only shape a from and a to can
     describe without throwing away the page's own markup. */

  let textOn = false;
  let editingText = null; /* { el, from } while a line is open */

  const textish = (node) => node && node.nodeType === 1 && node.childNodes.length > 0
    && [...node.childNodes].every((n) => n.nodeType === 3)
    && node.textContent.trim().length > 0;

  /* Authored HTML arrives indented, so the raw text of a paragraph carries
     the newlines and spaces the source file used. They render as one space,
     and a ticket that quoted them would be unreadable, so the record keeps
     the collapsed form both sides. */
  const tidy = (s) => s.replace(/\s+/g, " ").trim();

  function setTextTool(on) {
    if (!on) endText(true);
    textOn = on;
    textSwitch.checked = on;
    stage.toggleAttribute("data-text", on);
    if (!on) { hovered = null; if (mode === "edit") paintBoxes(); return; }
    /* Same reasoning as the x-ray lens: off is the overlay gone, and edit is
       where the selection, the pending list and the save button already are. */
    if (mode !== "edit") setMode("edit");
    say("Click a line of text to edit it in place. Enter saves it, esc puts it back.", true);
  }
  textSwitch.addEventListener("change", () => setTextTool(textSwitch.checked));

  function startText(stack) {
    const node = stack.find(textish);
    if (!node) { say("The text tool takes an element whose whole content is text. This one holds other elements."); return; }
    endText(true);
    select(node);
    editingText = { el: node, from: node.textContent };
    node.setAttribute("contenteditable", "plaintext-only");
    /* The element grows as it is typed into, and an outline drawn around the
       shape it had before says the wrong thing about what is being edited. */
    node.addEventListener("input", scheduleRedrawBoxes);
    editOutline.setAttribute("data-editing", "");
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    /* The stage stands aside so the pointer can place a caret in the text.
       It is the stage and not the hit layer because pointer-events inherits:
       the hit layer never declares it, so switching off the one node that
       covers the viewport switches off both. What keeps the page a picture
       while it is down is textOutside, below. */
    stage.style.pointerEvents = "none";
    say("Editing text. Enter saves it, esc puts it back.", true);
  }

  function endText(cancel) {
    const open = editingText;
    if (!open) return;
    editingText = null;
    stage.style.pointerEvents = "";
    const node = open.el;
    node.removeAttribute("contenteditable");
    node.removeEventListener("input", scheduleRedrawBoxes);
    editOutline.removeAttribute("data-editing");
    const now = node.textContent;
    if (cancel || tidy(now) === tidy(open.from)) { node.textContent = open.from; return; }
    /* Put the original back before recording, so applyEdit captures the true
       `from` on first touch the same way every other edit does. */
    node.textContent = tidy(open.from);
    applyEdit(node, TEXT_PROP, tidy(now), null);
    say("Text edit pending. Save edits turns it into a ticket.");
  }

  /* While a line is open the stage is down, which puts the page back in reach
     of its own click handlers. This is what keeps it a picture: the click
     that closes the line goes no further than closing it.

     All three events, because closing on the pointerdown puts the stage back
     before the click is dispatched, and a link whose mousedown the page saw
     would then navigate out from under an unsaved edit. A click on the
     overlay's own chrome closes the line and is left to work, because at
     window level everything inside the shadow root reports the host element
     as its target. */
  let textSwallow = false; /* the rest of the gesture that closed a line */
  function textOutside(e) {
    if (e.type === "pointerdown") {
      textSwallow = false;
      if (!editingText) return;
      if (editingText.el.contains(e.target)) return; /* placing the caret */
      const ours = e.target === host || host.contains(e.target);
      endText(false);
      if (ours) return;
      textSwallow = true;
    } else if (!textSwallow) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "click") textSwallow = false;
  }
  for (const type of ["pointerdown", "mousedown", "click"]) {
    window.addEventListener(type, textOutside, true);
  }

  /* The node in hand goes stale on an app page. A framework that re-renders
     replaces the element with an identical one, and the old reference is then
     a detached node: writing to it writes to nothing anybody can see, which is
     what "the edit did not apply" looks like from the outside. The selector is
     the durable name for the target, so a reference that has left the document
     is resolved again through it. A reference that is still in the document is
     trusted as it stands: the selector was unique when it was captured, and a
     re-render can make it ambiguous. */
  function live(node, selector) {
    if (node?.isConnected) return node;
    try {
      const found = selector && document.querySelector(selector);
      if (found) return found;
    } catch { /* a selector the page can no longer parse */ }
    return null;
  }

  /* Every read of the selection goes through here, not just every write. A
     detached node reports no computed style at all, so a control that read one
     would show 0 for everything and then step from 0 the next time it was
     clicked, which is the edit landing somewhere nobody asked for. */
  function currentTarget() {
    if (!selected) return null;
    const fresh = live(selected, selectedSelector);
    if (fresh) selected = fresh;
    return selected;
  }

  /* Pending edits are written twice: inline on the element, which is what
     shows instantly, and as rules in one stylesheet in the document head,
     which is what survives. A re-render takes the inline style with the node
     it replaces; a rule outlives the node because it is addressed by name.
     The rules are !important because after a re-render the thing they are
     competing with is the framework's own inline style. */
  let pendingSheet = null;
  function syncPendingSheet() {
    const rules = [...pending.values()]
      .filter((r) => r.prop !== TEXT_PROP)
      .map((r) => `${r.selector} { ${r.prop}: ${r.to} !important; }`).join("\n");
    if (!rules) {
      pendingSheet?.remove();
      pendingSheet = null;
      return;
    }
    if (!pendingSheet) {
      pendingSheet = document.createElement("style");
      pendingSheet.setAttribute("data-g-admin-pending", "");
      document.head.append(pendingSheet);
    }
    pendingSheet.textContent = rules;
  }

  /* An edit is recorded against the selector, because that is what a baking
     agent will look for. `from` is the computed value before we touched it,
     captured once: a second nudge must not record the first nudge as the
     original. */
  function applyEdit(node, prop, value, stops, tokenName = null) {
    const selector = selectorFor(node);
    const target = live(node, selector);
    if (!target) { say("That element has left the page. Select it again."); return; }
    if (target !== node && node === selected) { selected = target; selectedSelector = selector; }
    const key = `${selector}|${prop}`;
    if (!pending.has(key)) {
      const from = prop === TEXT_PROP ? target.textContent : getComputedStyle(target).getPropertyValue(prop);
      /* What the page's own style attribute said about this one property,
         before we wrote over it. Writing a longhand expands any shorthand the
         page declared inline, so removing the longhand on revert would drop
         the shorthand's value to nothing. This is read through CSSOM, which
         has already expanded `padding: 13px` into its four sides. */
      const inlineBefore = prop === TEXT_PROP ? "" : target.style.getPropertyValue(prop);
      pending.set(key, { selector, prop, from, to: from, token_from: stops ? tokenAt(stops, px(from)) : null, token_to: null, inlineBefore });
    }
    touched.set(selector, target);
    const record = pending.get(key);
    record.to = value;
    record.token_to = stops ? tokenAt(stops, px(value)) : tokenName;
    /* Text is written to the node itself and cannot be mirrored into the
       pending stylesheet, so a re-render takes it with the node it replaces.
       Everything the stylesheet can carry, it carries. */
    if (prop === TEXT_PROP) target.textContent = value;
    else target.style.setProperty(prop, value);
    syncPendingSheet();
    renderPending();
    /* Immediate, not on the next idle frame: the edit and the box that shows
       it have to move together, or a 4px step on a dark page reads as nothing
       having happened at all. The scheduled redraw is deliberately not used
       here, because it would repaint the flash away on the very next frame. */
    drawEditBoxes(selected, true);
    refreshControls();
  }

  function revertAll() {
    for (const record of pending.values()) {
      const node = live(touched.get(record.selector), record.selector);
      if (!node) continue;
      if (record.prop === TEXT_PROP) { node.textContent = record.from; continue; }
      node.style.removeProperty(record.prop);
      if (record.inlineBefore) node.style.setProperty(record.prop, record.inlineBefore);
    }
    pending.clear();
    touched.clear();
    syncPendingSheet();
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
      row.append(el("span", "ga-to", record.token_to ? record.token_to.replace("--", "") : record.to));
      pendingList.append(row);
    }
  }

  /* A stepper row: minus, value, plus, and the token the value lands on. Off
     the scale is allowed and flagged in place rather than corrected. */
  function stepper(label, prop, getStops, unit = "px") {
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
      const target = currentTarget();
      /* A field takes any text, and parseFloat says NaN to most of it. Letting
         that through would put "NaNpx" in the record a baking agent reads. */
      if (!target || !Number.isFinite(next)) { render(); return; }
      applyToSelection(prop, Math.max(0, Math.round(next)) + unit, getStops());
      render();
      /* A step from 0 to 4px is a real change that looks like nothing on a
         busy page, so the number says it changed even when the page cannot. */
      flash(value);
    };
    down.addEventListener("click", () => commit(stepAlong(getStops(), current(), -1)));
    up.addEventListener("click", () => commit(stepAlong(getStops(), current(), 1)));
    value.addEventListener("change", () => commit(parseFloat(value.value)));

    const current = () => {
      const target = currentTarget();
      return target ? px(getComputedStyle(target).getPropertyValue(prop)) : 0;
    };
    function render() {
      /* Scrolling re-reads every control, which must not overwrite a number
         somebody is halfway through typing. */
      if (shadow.activeElement === value) return;
      const now = current();
      value.value = String(now);
      const stop = stopAt(getStops(), now);
      token.textContent = stop ? (stop.token || "").replace("--", "") : "off scale";
      /* The strip is one line in a 320px panel and a project can name its
         steps anything, so the full name is always one hover away. */
      token.title = token.textContent;
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
      input.addEventListener("change", () => {
        if (input.checked) applyToSelection(prop, value, null);
      });
    }
    row.append(seg);
    return {
      row,
      render() {
        const target = currentTarget();
        const now = target ? getComputedStyle(target).getPropertyValue(prop).trim() : "";
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

  /* Margin is the control that most often does nothing, and silence there is
     indistinguishable from the tool being broken. Three cases, said in place:
     an inline box ignores vertical margin outright, a positioned element is
     placed by something that will place it again, and an item in a flex or
     grid container is spaced by the container as well. */
  const marginHint = el("span", "hint");
  marginHint.hidden = true;
  marginBody.append(marginHint);

  function marginCaveat() {
    const target = currentTarget();
    if (!target) return "";
    const cs = getComputedStyle(target);
    if (cs.display === "inline") return "This is an inline box. Top and bottom margins have no effect on it.";
    if (cs.position === "absolute" || cs.position === "fixed") {
      return "This element is positioned, not flowed. A margin shifts it from its inset, and a layout that sets that inset again on its next render puts it back.";
    }
    const parentDisplay = target.parentElement ? getComputedStyle(target.parentElement).display : "";
    if (/flex|grid/.test(parentDisplay)) return "This is a flex or grid item. Its margin adds to the container's gap rather than replacing it.";
    return "";
  }

  const textAlign = toggles("Text", "text-align", [["left", "Left"], ["center", "Centre"], ["right", "Right"]]);
  const justify = toggles("Justify", "justify-content", [["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["space-between", "Between"]]);
  const alignItems = toggles("Align", "align-items", [["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["stretch", "Stretch"]]);
  const flexHint = el("span", "hint", "Justify and align apply to a flex or grid container.");
  alignBody.append(textAlign.row, justify.row, alignItems.row, flexHint);

  const fontSize = stepper("Size", "font-size", () => FONT_SIZES.map((v) => ({ token: null, px: v })));
  const lineHeight = stepper("Line", "line-height", lineHeights);
  /* Weight steps the nine hundreds and takes no unit: `font-weight: 400px` is
     not a declaration. */
  const fontWeight = stepper("Weight", "font-weight", () => WEIGHTS.map((v) => ({ token: null, px: v })), "");

  /* The family picker offers the host page's font tokens and nothing else, so
     a family lands as `var(--font-mono)` rather than a font name the design
     system never chose. A page that declares none has no row. */
  function familyPicker() {
    const row = el("div", "ga-row");
    row.append(el("span", "ga-key", "Family"));
    const select = el("select", "select");
    row.append(wrapSelect(select));
    select.addEventListener("change", () => {
      if (!select.value) return;
      applyToSelection("font-family", `var(${select.value})`, null, select.value);
    });
    return {
      row,
      render() {
        const fonts = fontTokens();
        row.hidden = !fonts.length;
        if (!fonts.length) return;
        const target = currentTarget();
        const now = target ? getComputedStyle(target).fontFamily : "";
        const match = fonts.find((f) => firstFamily(f.value) === firstFamily(now));
        /* Rebuilt only when the answer changes: a select rebuilt on every
           scroll frame would close itself the moment it was opened. */
        const shape = fonts.map((f) => f.token).join("|") + (match ? "" : "|off");
        if (select.dataset.shape !== shape) {
          select.dataset.shape = shape;
          select.replaceChildren();
          if (!match) select.append(new Option("Off token", ""));
          for (const f of fonts) select.append(new Option(f.token.replace("--", ""), f.token));
        }
        select.value = match ? match.token : "";
      },
    };
  }
  const family = familyPicker();
  typeBody.append(fontSize.row, lineHeight.row, fontWeight.row, family.row);

  const marginPane = pane("Margin", marginBody);
  const paddingPane = pane("Padding", paddingBody);
  const alignPane = pane("Alignment", alignBody);
  pane("Type", typeBody);
  pane("Pending edits", pendingList);

  function refreshControls() {
    if (!selected) return;
    /* A selection that has left the page reports no computed style at all, so
       every reader below would be reading zeroes. */
    const target = currentTarget();
    if (!target) return;
    for (const s of [...Object.values(margins), ...Object.values(paddings), fontSize, lineHeight, fontWeight, family]) s.render();
    const caveat = marginCaveat();
    marginHint.textContent = caveat;
    marginHint.hidden = !caveat;
    textAlign.render();
    justify.render();
    alignItems.render();
    const display = getComputedStyle(target).display;
    const flexish = /flex|grid/.test(display);
    justify.setDisabled(!flexish);
    alignItems.setDisabled(!flexish);
    flexHint.hidden = flexish;
  }

  /* Arrow keys move the selected element by its margin: one pixel on its own,
     one step of the spacing scale with shift. The sidebar's own fields keep
     their keys. */
  function editKeys(e) {
    if (mode !== "edit" || !selected || typingNow()) return;
    const axis = { ArrowUp: [margins.top, -1], ArrowDown: [margins.top, 1], ArrowLeft: [margins.left, -1], ArrowRight: [margins.left, 1] }[e.key];
    if (!axis) return;
    e.preventDefault();
    const [control, dir] = axis;
    if (e.shiftKey) control.step(dir);
    else control.nudge(dir);
  }

  /* Delete hides rather than removes: it goes through the same pending path
     as everything else, so it reverts, it shows in the pending list and it
     tickets as `display: none` for a baking agent to read. The key labelled
     delete on a Mac keyboard reports Backspace. */
  function hideKeys(e) {
    if (mode !== "edit" || !selected || composing || typingNow()) return false;
    if (e.key !== "Delete" && e.key !== "Backspace") return false;
    e.preventDefault();
    applyToSelection("display", "none", null);
    say("Hidden. Revert puts it back, and the ticket carries it as display none.");
    return true;
  }

  /* Jump to a pane, because the alternative is scrolling a 320px column with
     the pointer for a control the keyboard was already on its way to. Focus
     lands on the pane's own title and not on its first field: a field would
     make every letter after it a typed character, and m then p is the whole
     point of having both. Tab from there reaches the controls. */
  function focusPane(section) {
    if (!selected) { say("Select an element first."); return; }
    const title = section.querySelector(".g-pane-title");
    if (title?.getAttribute("aria-expanded") === "false") title.click();
    /* scrollIntoView inside a shadow root scrolls the host page to get there,
       which moves every box the overlay has drawn. The pane's offset inside
       its own scroller is the same answer with none of that. */
    sideBody.scrollTop = Math.max(0, section.offsetTop - sideBody.offsetTop);
    title?.focus({ preventScroll: true });
  }

  /* Single letters, and only while the overlay owns the keyboard: a field or
     an open line of text takes its own keys. Modifiers are left alone,
     because cmd+E and friends belong to the browser. */
  function toolKeys(e) {
    /* These work from rest as well as inside a mode: a and e are how a mode
       starts. Not while the composer is open, because every one of them
       leaves the mode, and leaving reverts the edits it is about to save. */
    if (composing || typingNow() || e.metaKey || e.ctrlKey || e.altKey) return false;
    /* Both readings of the same gesture: a layout where ? is shift and slash
       reports one or the other depending on the browser and the layout. */
    if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); toggleHelp(); return true; }
    const run = {
      a: () => setMode("annotate"),
      e: () => setMode("edit"),
      x: () => setXray(!xrayOn),
      t: () => setTextTool(!textOn),
      m: () => focusPane(marginPane),
      p: () => focusPane(paddingPane),
    }[e.key.toLowerCase()];
    if (!run) return false;
    e.preventDefault();
    run();
    return true;
  }

  revertBtn.addEventListener("click", revertAll);

  /* ----------------------------------------------------------------- save */

  let composing = null; /* what the composer will post when it is not annotate */

  function openComposer(kind) {
    composing = kind;
    kindSelect.value = kind.kind;
    panel.hidden = false;
    /* The pin and pen belong to annotate mode, which opens the panel itself.
       Anything composed from pending edits has no drawing to make. */
    tools.hidden = true;
    counts.textContent = kind.summary;
    noteInput.focus();
  }

  function closeComposer() {
    composing = null;
    panel.hidden = true;
    noteInput.value = "";
    error.hidden = true;
  }

  /* A multi-selection that shares a signature is a class-level intention, and
     the summary is free text, which is the only place the contract leaves to
     say so. Claimed only where it is true of every element the edits touched:
     a shape that covers three of four elements is worse than no shape. */
  function editShape() {
    const sig = sharedSignature();
    if (!sig || touched.size < 2) return "";
    for (const [selector, node] of touched) {
      const target = live(node, selector);
      try { if (!target || !target.matches(sig.selector)) return ""; } catch { return ""; }
    }
    return `, all ${sig.label}`;
  }

  saveEditsBtn.addEventListener("click", () => {
    const records = [...pending.values()];
    if (!records.length) return;
    openComposer({
      /* A set of edits that is nothing but text is a content change, and the
         kind is what routes the ticket to the right kind of fix. */
      kind: records.every((r) => r.prop === TEXT_PROP) ? "content" : "edit",
      summary: `${records.length} ${records.length === 1 ? "edit" : "edits"} on ${touched.size} ${touched.size === 1 ? "element" : "elements"}${editShape()}`,
      /* The HTML in a ticket has to be the element as it stands now, not as a
         reference that a re-render left behind. */
      elements: [...touched.entries()].map(([selector, node]) => snapshot(live(node, selector) || node)),
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
    endText(true);
    closeHelp();
    revertAll();
    stage.hidden = true;
    stage.removeAttribute("data-gap");
    boxes.replaceChildren();
    gapHits = [];
    panel.hidden = true;
    side.hidden = true;
    hint.hidden = true;
    /* The x-ray switch survives a mode change, its painting does not: there is
       no stage to paint on between leaving one mode and entering the next. */
    watchXray(false);
    xrayCanvas.hidden = true;
    legend.hidden = true;
    crumbs.replaceChildren();
    extras = [];
    sideMulti.hidden = true;
    trail = [];
    lastPoint = null;
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
    /* The text tool is edit mode's, so it does not follow the overlay into
       annotate mode the way the x-ray lens does. */
    if (next !== "edit" && textOn) setTextTool(false);
    if (xrayOn) {
      xrayCanvas.hidden = false;
      legend.hidden = false;
      sizeCanvas(xrayCanvas);
      watchXray(true);
      paintXray();
    }
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
    say("Click an element to select it, then hover another to measure the gap. Click a gap to jump to what owns it, and ? lists every key.", true);
  }

  /* "Off" is not a fourth mode, it is leaving: the overlay goes away and the
     browser is disarmed, so the next page load is an ordinary one until
     somebody visits with ?gadmin=1 again. */
  function setMode(next) {
    if (next === mode && next !== "off") return;
    leave();
    if (next !== "off") { enter(next); return; }
    mode = "off";
    xrayOn = false;
    xraySwitch.checked = false;
    textOn = false;
    textSwitch.checked = false;
    try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
    host.remove();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
    for (const type of ["pointerdown", "mousedown", "click"]) {
      window.removeEventListener(type, textOutside, true);
    }
    window.__gAdmin = false;
  }

  function onKey(e) {
    /* The help sheet opens from rest, so it closes from rest. */
    if (e.key === "Escape" && !help.hidden) { e.preventDefault(); closeHelp(); return; }
    if (e.key === "Escape" && mode !== "off") {
      e.preventDefault();
      if (editingText) { endText(true); return; }
      if (composing) { closeComposer(); return; }
      /* The rest of a multi-selection goes before the walk does: both are
         things added to a selection, newest first. */
      if (mode === "edit" && extras.length) { extras = []; renderSelection(); drawEditBoxes(selected); return; }
      /* Esc unwinds the walk one step before it unwinds anything else: having
         drilled in, the way out is the way you came. */
      if (mode === "edit" && trail.length) { select(trail.pop()); return; }
      if (mode === "edit" && selected) {
        selected = null;
        side.hidden = true;
        crumbs.replaceChildren();
        boxes.replaceChildren();
        return;
      }
      setMode("off");
      return;
    }
    /* Enter closes a line of text. Shift and enter is a line break, which is
       the convention that does not have to guess whether the element the
       pointer landed on was meant to be one line or many. */
    if (editingText && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); endText(false); return; }
    if (toolKeys(e)) return;
    if (walkKeys(e)) return;
    if (hideKeys(e)) return;
    editKeys(e);
  }
  function onResize() {
    if (mode === "annotate") { sizeCanvas(); redraw(); renderPicked(); }
    if (xrayOn) { sizeCanvas(xrayCanvas); scheduleXray(); }
    scheduleRedrawBoxes();
  }
  function onScroll() {
    if (mode === "edit") scheduleRedrawBoxes();
    scheduleXray();
  }
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, true);

  /* --------------------------------------------------------------- mount */

  /* The way out, for anything that did not come through the bar. Whatever
     tears the overlay down has to come through here rather than removing the
     element: the pending edits are inline styles and a stylesheet in the head,
     and dropping the element leaves both applied with nothing left on screen
     to say so. The stub owns `window.__gAdmin`; this is its counterpart. */
  window.__gAdminOff = () => setMode("off");

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
