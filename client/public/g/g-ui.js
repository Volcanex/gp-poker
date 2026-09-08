/* g-system@1.1.0, vendored, do not edit. Update: node scripts/vendor.mjs from the g-system repo. */
/* g-icons — generated from packages/g-icons/icons/*.svg. Do not edit. */
(() => {
  const g = (window.g = window.g || {});
  g.icons = {
  "bell": "<svg class=\"gi gi-bell\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"body\"><path d=\"M56 110 a72 72 0 0 1 144 0 c0 34 8 58 14 68 a5 5 0 0 1 -4 8 H46 a5 5 0 0 1 -4 -8 c6 -10 14 -34 14 -68 Z\"/></g> <g data-part=\"clapper\"><path d=\"M102 214 a26 26 0 0 0 52 0\"/></g></svg>",
  "check": "<svg class=\"gi gi-check\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"tick\"><path pathLength=\"1\" d=\"M38 140 l56 54 124 -122\"/></g></svg>",
  "copy": "<svg class=\"gi gi-copy\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"back\"><path d=\"M96 80 V56 a8 8 0 0 1 8 -8 h96 a8 8 0 0 1 8 8 v96 a8 8 0 0 1 -8 8 h-24\"/></g> <g data-part=\"front\"><path d=\"M56 96 h96 a8 8 0 0 1 8 8 v96 a8 8 0 0 1 -8 8 h-96 a8 8 0 0 1 -8 -8 v-96 a8 8 0 0 1 8 -8 Z\"/></g></svg>",
  "download": "<svg class=\"gi gi-download\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"arrow-clip\"><g data-part=\"arrow\"><path d=\"M128 36 v100 M86 100 l42 42 42 -42\"/></g></g> <g data-part=\"tray\"><path d=\"M40 158 v34 a16 16 0 0 0 16 16 h144 a16 16 0 0 0 16 -16 v-34\"/></g> <g data-part=\"check\"><path pathLength=\"1\" d=\"M56 110 l44 42 100 -98\"/></g></svg>",
  "list": "<svg class=\"gi gi-list\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"top\"><path d=\"M40 76 h176\"/></g> <g data-part=\"mid\"><path d=\"M40 128 h176\"/></g> <g data-part=\"bottom\"><path d=\"M40 180 h176\"/></g></svg>",
  "plus": "<svg class=\"gi gi-plus\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"cross\"><path d=\"M128 48 v160 M48 128 h160\"/></g></svg>",
  "refresh": "<svg class=\"gi gi-refresh\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"arc1\"><path pathLength=\"1\" d=\"M62 71 A80 80 0 0 1 196 100\"/><path d=\"M196 58 v42 h-42\"/></g> <g data-part=\"arc2\"><path pathLength=\"1\" d=\"M194 185 A80 80 0 0 1 60 156\"/><path d=\"M60 198 v-42 h42\"/></g></svg>",
  "save": "<svg class=\"gi gi-save\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"body\"><path d=\"M172 40 H48 a8 8 0 0 0 -8 8 v160 a8 8 0 0 0 8 8 h160 a8 8 0 0 0 8 -8 V84 Z\"/></g> <g data-part=\"label\"><path pathLength=\"1\" d=\"M88 216 v-52 a6 6 0 0 1 6 -6 h68 a6 6 0 0 1 6 6 v52\"/></g> <g data-part=\"stripe\"><path d=\"M96 78 h52\"/></g></svg>",
  "search": "<svg class=\"gi gi-search\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"glass\"><circle cx=\"112\" cy=\"112\" r=\"72\"/></g> <g data-part=\"handle\"><path d=\"M164 164 L218 218\"/></g></svg>",
  "send": "<svg class=\"gi gi-send\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"plane\"><path d=\"M222 34 L36 102 l86 36 26 82 Z\"/><path d=\"M222 34 L124 140\"/></g> <g data-part=\"check\"><path pathLength=\"1\" d=\"M38 140 l56 54 124 -122\"/></g></svg>",
  "trash": "<svg class=\"gi gi-trash\" viewBox=\"0 0 256 256\" aria-hidden=\"true\"><g data-part=\"lid\"><path d=\"M40 72 h176 M100 72 v-16 a12 12 0 0 1 12 -12 h32 a12 12 0 0 1 12 12 v16\"/></g> <g data-part=\"body\"><path d=\"M60 72 l8 138 a8 8 0 0 0 8 8 h104 a8 8 0 0 0 8 -8 l8 -138 M106 112 v58 M150 112 v58\"/></g></svg>"
};
  g.icon = (name) => g.icons[name] || "";
})();

/* g-ui behaviour layer. Framework-free; progressive — pages work without it,
   this adds the interactions CSS cannot do alone. */
(() => {
  const g = (window.g = window.g || {});

  /* ---- theme + density -------------------------------------------------- */

  g.theme = (mode) => {
    /* "dark" (the default), "light", or "system" (follow the OS) */
    const el = document.documentElement;
    if (mode === "dark") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", mode);
    try { localStorage.setItem("g-theme", mode); } catch {}
  };
  g.density = (mode) => {
    const el = document.documentElement;
    if (mode === "compact") el.setAttribute("data-density", "compact");
    else el.removeAttribute("data-density");
    try { localStorage.setItem("g-density", mode); } catch {}
  };
  try {
    const t = localStorage.getItem("g-theme");
    if (t && t !== "dark") document.documentElement.setAttribute("data-theme", t);
    if (localStorage.getItem("g-density") === "compact")
      document.documentElement.setAttribute("data-density", "compact");
  } catch {}

  /* ---- plain: markdown source flattened to label text -------------------
     Authored markdown reaches interface chrome constantly: a note title
     lifted from a body's first line, a search hit, a table cell, a tooltip.
     Chrome has no markdown renderer, so the syntax survives as literal
     asterisks and backticks. `.prose` is the ONLY place markdown is
     rendered; every other slot flattens first.

     Upstream truncation is the common case ("**A title cut mid-phrase"),
     which leaves openers with no closer, so unmatched asterisks and
     backticks are swept after the paired passes. Underscores are not
     swept: snake_case survives far more often than a stray _emphasis_,
     so they only pair at word boundaries, the way CommonMark reads them. */

  g.plain = (s) => String(s ?? "")
    .replace(/```[\s\S]*?```/g, " ")                     /* fenced code */
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")            /* image, keep the alt */
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")         /* labelled wikilink */
    .replace(/\[\[([^\]]*)\]\]/g, "$1")                  /* bare wikilink */
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")             /* link, keep the text */
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")                  /* heading marker */
    .replace(/^\s{0,3}>\s?/gm, "")                       /* quote marker */
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "")           /* list marker */
    .replace(/`+([^`]*)`+/g, "$1")                       /* code span */
    .replace(/\*\*\*([\s\S]*?)\*\*\*/g, "$1")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, "$1")
    .replace(/(^|\W)___([\s\S]*?)___(?!\w)/g, "$1$2")
    .replace(/(^|\W)__([\s\S]*?)__(?!\w)/g, "$1$2")
    .replace(/(^|\W)_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~([\s\S]*?)~~/g, "$1")
    .replace(/[*`]/g, "")                                /* opener left by a cut */
    .replace(/\s+/g, " ")
    .trim();

  /* ---- tooltip with delay grouping -------------------------------------
     300ms warm-up before the first tooltip; once one is visible (or was
     within the last 300ms) neighbours show instantly. */

  let tipEl, tipTimer, tipWarm = false, tipCool;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "tooltip";
      tipEl.role = "tooltip";
      tipEl.id = "g-tooltip";
      document.body.append(tipEl);
    }
    return tipEl;
  }
  function showTip(trigger) {
    const el = tip();
    el.textContent = trigger.getAttribute("data-tip");
    el.toggleAttribute("data-instant", tipWarm);
    const r = trigger.getBoundingClientRect();
    el.style.left = "0px"; el.style.top = "0px";
    const w = el.offsetWidth, h = el.offsetHeight;
    /* Prefer above; flip below when there is no headroom. */
    const above = r.top - h - 6 >= 8;
    el.toggleAttribute("data-side", false);
    if (!above) el.setAttribute("data-side", "bottom");
    el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    el.style.top = (above ? r.top - h - 6 : r.bottom + 6) + "px";
    el.setAttribute("data-open", "");
    trigger.setAttribute("aria-describedby", "g-tooltip");
    tipWarm = true;
    clearTimeout(tipCool);
  }
  function hideTip(trigger) {
    clearTimeout(tipTimer);
    tipEl?.removeAttribute("data-open");
    trigger?.removeAttribute("aria-describedby");
    tipCool = setTimeout(() => { tipWarm = false; }, 300);
  }
  document.addEventListener("pointerenter", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) return;
    clearTimeout(tipTimer);
    if (tipWarm) showTip(t);
    else tipTimer = setTimeout(() => showTip(t), 300);
  }, true);
  document.addEventListener("pointerleave", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t) hideTip(t);
  }, true);
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t) showTip(t);
  });
  document.addEventListener("focusout", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t) hideTip(t);
  });

  /* ---- tabs: sliding indicator + arrow keys ----------------------------- */

  function initTabs(tabs) {
    let ind = tabs.querySelector(".tab-indicator");
    if (!ind) {
      ind = document.createElement("span");
      ind.className = "tab-indicator";
      tabs.append(ind);
    }
    const items = [...tabs.querySelectorAll(".tab")];
    function select(tab, focus) {
      items.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        const panel = t.getAttribute("aria-controls");
        if (panel) document.getElementById(panel)?.toggleAttribute("hidden", !on);
      });
      ind.style.width = tab.offsetWidth + "px";
      ind.style.translate = tab.offsetLeft + "px 0";
      if (focus) tab.focus();
    }
    items.forEach((t) => t.addEventListener("click", () => select(t)));
    tabs.addEventListener("keydown", (e) => {
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "ArrowRight") select(items[(i + 1) % items.length], true);
      if (e.key === "ArrowLeft") select(items[(i - 1 + items.length) % items.length], true);
    });
    select(tabs.querySelector('.tab[aria-selected="true"]') || items[0]);
  }

  /* ---- menus on the Popover API ----------------------------------------- */

  function initMenu(menu) {
    const trigger = document.querySelector(`[popovertarget="${menu.id}"]`);
    menu.addEventListener("toggle", (e) => {
      if (e.newState !== "open" || !trigger) return;
      menu.style.maxHeight = "";
      const r = trigger.getBoundingClientRect();
      const fitsBelow = r.bottom + 4 + menu.offsetHeight < innerHeight;
      const fitsAbove = r.top - 4 - menu.offsetHeight > 0;
      /* A menu too tall for either side of the trigger stays below it and
         scrolls in whatever room is actually there, rather than flipping
         above and landing off the top of the screen: fitsAbove is false in
         that case too, so flipping never helped. */
      const below = fitsBelow || !fitsAbove;
      menu.style.setProperty("--_origin", below ? "top" : "bottom");
      menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + "px";
      menu.style.top = (below ? r.bottom + 4 : r.top - menu.offsetHeight - 4) + "px";
      if (below && !fitsBelow) menu.style.maxHeight = innerHeight - r.bottom - 12 + "px";
      highlight(menu, null);
    });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll(".menu-item:not(:disabled)")];
      const cur = items.findIndex((i) => i.hasAttribute("data-highlighted"));
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(menu, items[(cur + 1) % items.length]); }
      if (e.key === "ArrowUp") { e.preventDefault(); highlight(menu, items[(cur - 1 + items.length) % items.length]); }
      if (e.key === "Enter" && cur >= 0) { items[cur].click(); menu.hidePopover(); }
    });
    menu.addEventListener("pointermove", (e) => {
      const item = e.target.closest(".menu-item");
      if (item) highlight(menu, item);
    });
    menu.querySelectorAll(".menu-item").forEach((i) =>
      i.addEventListener("click", () => menu.hidePopover()));
  }
  function highlight(menu, item) {
    menu.querySelectorAll("[data-highlighted]").forEach((i) => i.removeAttribute("data-highlighted"));
    if (item) { item.setAttribute("data-highlighted", ""); item.focus({ preventScroll: true }); }
  }

  /* ---- toast: Sonner-style stack, scale + 14px offset ------------------- */

  let toaster;
  const toasts = [];
  const TOAST_ICONS = {
    ok: '<svg class="t-ok" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>',
    danger: '<svg class="t-danger" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z"/></svg>',
    loading: '<span class="spinner"></span>',
  };
  function toastBody(el, { title, desc, kind, action }) {
    el.innerHTML = `${TOAST_ICONS[kind] || ""}<div class="t-body"><b>${title || ""}</b>${desc ? `<div class="t-desc">${desc}</div>` : ""}</div>`;
    if (action) {
      const b = document.createElement("button");
      b.className = "btn btn-secondary btn-sm";
      b.textContent = action.label;
      b.addEventListener("click", () => { action.onClick?.(); dismiss(el); });
      el.append(b);
    }
  }
  /* patch the body in place when the shape is unchanged, so a loading
     spinner keeps turning across updates instead of restarting */
  function patchBody(el, next) {
    const same = el._kind === next.kind && !!el.querySelector(".t-body") && !next.action && !el.querySelector(".btn");
    if (!same) { el._kind = next.kind; toastBody(el, next); return; }
    const body = el.querySelector(".t-body");
    body.querySelector("b").textContent = next.title || "";
    let d = body.querySelector(".t-desc");
    if (next.desc) {
      if (!d) { d = document.createElement("div"); d.className = "t-desc"; body.append(d); }
      d.textContent = next.desc;
    } else d?.remove();
  }
  /* The toast's bar is the same progress component, pinned to its bottom edge. */
  function toastProgress(el, p) {
    let bar = el.querySelector(".t-bar");
    if (p == null || p === false) { bar?.remove(); el.removeAttribute("data-progress"); return; }
    if (!bar) { bar = document.createElement("div"); bar.className = "g-progress t-bar"; el.append(bar); }
    el.setAttribute("data-progress", "");
    g.progress(bar, p);
  }
  g.toast = (opts = {}) => {
    if (!toaster) {
      toaster = document.createElement("div");
      toaster.className = "toaster";
      toaster.setAttribute("aria-live", "polite");
      document.body.append(toaster);
      toaster.addEventListener("pointerenter", () => toasts.forEach((t) => clearTimeout(t.timer)));
      toaster.addEventListener("pointerleave", () =>
        toasts.forEach((t) => { if (!t.sticky) t.timer = setTimeout(() => dismiss(t), 2000); }));
    }
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("data-entering", "");
    el.opts = Object.assign({}, opts);
    patchBody(el, opts);
    toastProgress(el, opts.progress);
    el.sticky = opts.kind === "loading" || opts.sticky;
    toaster.append(el);
    toasts.unshift(el);
    requestAnimationFrame(() => { el.removeAttribute("data-entering"); restack(); });
    if (!el.sticky) el.timer = setTimeout(() => dismiss(el), opts.duration || 4000);
    return {
      el,
      /* update merges, so a running job can move one field at a time */
      update(next) {
        const o = Object.assign(el.opts, next);
        patchBody(el, o);
        toastProgress(el, o.progress);
        el.sticky = o.kind === "loading" || o.sticky;
        clearTimeout(el.timer);
        if (!el.sticky) el.timer = setTimeout(() => dismiss(el), o.duration || 4000);
      },
      progress(p) { el.opts.progress = p; toastProgress(el, p); },
      dismiss: () => dismiss(el),
    };
  };
  function restack() {
    toasts.forEach((t, i) => {
      t.style.zIndex = 10 - i;
      t.style.translate = `0 ${-i * 14}px`;
      t.style.scale = `${Math.max(0, 1 - i * 0.05)}`;
      t.style.opacity = i > 2 ? "0" : "1";
      t.style.pointerEvents = i > 2 ? "none" : "";
    });
  }
  function dismiss(el) {
    clearTimeout(el.timer);
    const i = toasts.indexOf(el);
    if (i < 0) return;
    toasts.splice(i, 1);
    el.style.translate = ""; el.style.scale = "";
    el.setAttribute("data-leaving", "");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
    restack();
  }

  /* ---- copy button ------------------------------------------------------ */

  function initCopy(btn) {
    if (!btn.querySelector(".copy-icons"))
      btn.insertAdjacentHTML("afterbegin", `<span class="copy-icons">${icon("copy")}${icon("check")}</span>`);
    const label = btn.querySelector(".copy-label");
    const live = document.createElement("span");
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    btn.append(live);
    if (label) btn.style.minWidth = btn.offsetWidth + "px";
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy")
        ?? document.querySelector(btn.getAttribute("data-copy-from"))?.textContent ?? "";
      try { await navigator.clipboard.writeText(text.trim()); } catch {}
      btn.setAttribute("data-copied", "");
      if (label) { label.textContent = "Copied"; bridgeLabel(label); }
      live.textContent = "Copied to clipboard";
      clearTimeout(btn.timer); /* re-click resets the timer, never stacks */
      btn.timer = setTimeout(() => {
        btn.removeAttribute("data-copied");
        if (label) label.textContent = "Copy";
        live.textContent = "";
      }, 1800);
    });
  }

  /* ---- command menu ----------------------------------------------------- */

  function fuzzy(q, s) {
    q = q.toLowerCase(); s = s.toLowerCase();
    let i = 0;
    for (const c of s) if (c === q[i]) i++;
    return i === q.length;
  }
  function initCmdk(dlg) {
    const input = dlg.querySelector(".cmdk-input");
    const list = dlg.querySelector(".cmdk-list");
    const empty = dlg.querySelector(".cmdk-empty");
    const items = () => [...list.querySelectorAll(".menu-item:not([hidden])")];
    function filter() {
      let any = false;
      list.querySelectorAll(".menu-item").forEach((i) => {
        const hit = !input.value || fuzzy(input.value, i.textContent);
        i.toggleAttribute("hidden", !hit);
        any = any || hit;
      });
      list.querySelectorAll(".cmdk-group").forEach((h) => {
        let sib = h.nextElementSibling, show = false;
        while (sib && !sib.classList.contains("cmdk-group")) {
          if (sib.classList.contains("menu-item") && !sib.hidden) show = true;
          sib = sib.nextElementSibling;
        }
        h.toggleAttribute("hidden", !show);
      });
      if (empty) empty.toggleAttribute("hidden", any);
      highlight(list, items()[0]);
    }
    input.addEventListener("input", filter);
    dlg.addEventListener("keydown", (e) => {
      const it = items();
      const cur = it.findIndex((i) => i.hasAttribute("data-highlighted"));
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(list, it[(cur + 1) % it.length]); input.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); highlight(list, it[(cur - 1 + it.length) % it.length]); input.focus(); }
      if (e.key === "Enter" && cur >= 0) { it[cur].click(); dlg.close(); }
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (dlg.open) dlg.close();
        else { dlg.showModal(); input.value = ""; filter(); input.focus(); }
      }
    });
  }

  /* ---- view swap: page change inside persistent chrome ------------------ */

  /* g.swap(el, update): fade the old content out (100ms), run `update` to
     put the new view in, then replay the entrance stagger. Interruption
     safe: rapid navigation cancels the pending swap and the last one wins. */
  g.swap = (el, update) => {
    clearTimeout(el._swapTimer);
    el.setAttribute("data-leaving", "");
    el._swapTimer = setTimeout(() => {
      update(el);
      el.removeAttribute("data-leaving");
      if (el.classList.contains("enter")) {
        el.classList.remove("enter");
        void el.offsetWidth; /* restart the stagger */
        el.classList.add("enter");
      }
      init(el);
    }, 100);
  };

  /* ---- feedback buttons: save, send, download, refresh -------------------
     The taxonomy: destructive buttons show their icon before (the trash
     warns); feedback buttons earn theirs after the action succeeds. */

  /* Icons come from g-icons (concatenated ahead of this file by the build). */
  const icon = (name) => (g.icon ? g.icon(name) : "");

  function bridgeLabel(el) {
    if (!el) return;
    el.classList.remove("g-label-bridge");
    void el.offsetWidth;
    el.classList.add("g-label-bridge");
  }

  function announcer(btn) {
    let live = btn.querySelector(".g-live");
    if (!live) {
      live = document.createElement("span");
      live.className = "sr-only g-live";
      live.setAttribute("aria-live", "polite");
      btn.append(live);
    }
    return live;
  }

  /* click → done state + label swap, reverting after 2s; a re-click resets
     the timer, never stacks (the copy-button rule, everywhere) */
  function doneCycle(btn, attr, label, apply) {
    btn.style.minWidth = btn.offsetWidth + "px";
    const live = announcer(btn);
    btn.addEventListener("click", () => {
      apply?.();
      btn.setAttribute(attr, "");
      const doneText = btn.getAttribute("data-label-done");
      if (label && doneText) { label.textContent = doneText; bridgeLabel(label); }
      live.textContent = doneText || "Done";
      clearTimeout(btn._cycleTimer);
      btn._cycleTimer = setTimeout(() => {
        btn.removeAttribute(attr);
        if (label) { label.textContent = btn.getAttribute("data-label") || label.textContent; bridgeLabel(label); }
        live.textContent = "";
      }, 2000);
    });
  }

  function initSave(btn) {
    if (!btn.querySelector(".gi-save")) btn.insertAdjacentHTML("afterbegin", icon("save"));
    doneCycle(btn, "data-saved", btn.querySelector(".save-label"));
  }

  function initSend(btn) {
    if (!btn.querySelector(".gi-send")) btn.insertAdjacentHTML("afterbegin", icon("send"));
    doneCycle(btn, "data-sent", btn.querySelector(".send-label"));
  }

  function initDownload(btn) {
    if (!btn.querySelector(".gi-download")) btn.insertAdjacentHTML("afterbegin", icon("download"));
    const label = btn.querySelector(".dl-label");
    const live = announcer(btn);
    btn.style.minWidth = btn.offsetWidth + "px";
    const wait = parseInt(btn.getAttribute("data-wait") || "1100", 10);
    btn.addEventListener("click", () => {
      clearTimeout(btn._dlTimer); clearTimeout(btn._cycleTimer);
      btn.removeAttribute("data-done");
      btn.setAttribute("data-active", "");
      btn._dlTimer = setTimeout(() => {
        btn.removeAttribute("data-active");
        btn.setAttribute("data-done", "");
        const doneText = btn.getAttribute("data-label-done");
        if (label && doneText) { label.textContent = doneText; bridgeLabel(label); }
        live.textContent = doneText || "Downloaded";
        btn._cycleTimer = setTimeout(() => {
          btn.removeAttribute("data-done");
          if (label) label.textContent = btn.getAttribute("data-label") || label.textContent;
          live.textContent = "";
        }, 2000);
      }, wait);
    });
  }

  function initSpin(btn) {
    if (!btn.querySelector("svg")) btn.insertAdjacentHTML("afterbegin", icon("refresh"));
    btn.addEventListener("click", () => {
      btn.removeAttribute("data-spinning");
      void btn.offsetWidth; /* restart mid-spin cleanly */
      btn.setAttribute("data-spinning", "");
    });
    btn.addEventListener("animationend", (e) => {
      if (e.animationName === "g-revolve") btn.removeAttribute("data-spinning");
    });
  }

  /* ---- status badge: swap with a blink ---------------------------------- */

  /* One swell: the pill resizes to its new label while colours crossfade and
     the text types through a blur; once settled, the pill blinks three times.
     Width is measured in px at both ends so the transition has real numbers. */
  g.status = (el, { kind, label }) => {
    const nextClass = "badge" + (kind ? " badge-" + kind : "");
    const sameClass = el.className.replace(/\s*g-swelling\s*/, " ").trim() === nextClass;
    const sameText = label == null || el.textContent === label;
    if (sameClass && sameText) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !el.isConnected) {
      el.className = nextClass;
      if (label != null) el.textContent = label;
      return;
    }
    const from = el.getBoundingClientRect().width;
    el.className = nextClass + " g-swelling";
    if (label != null) el.textContent = label;
    el.style.width = "";
    const to = el.getBoundingClientRect().width;
    el.style.width = from + "px";
    void el.offsetWidth;
    el.style.width = to + "px";
    el.removeAttribute("data-flash");
    void el.offsetWidth; /* restart the animation */
    el.setAttribute("data-flash", "");
    if (label != null && !sameText) bridgeLabel(el);
    clearTimeout(el._swell);
    el._swell = setTimeout(() => { el.style.width = ""; el.classList.remove("g-swelling"); }, 700);
  };

  /* ---- confirm button: tick draws in on click --------------------------- */

  function initConfirm(btn) {
    const label = btn.querySelector(".confirm-label");
    btn.style.minWidth = btn.offsetWidth + "px";
    if (!btn.querySelector(".gi-check")) btn.insertAdjacentHTML("afterbegin", icon("check"));
    btn.addEventListener("click", () => {
      /* one-way; a re-click resets the revert timer, never un-ticks */
      const first = !btn.hasAttribute("data-done");
      btn.setAttribute("data-done", "");
      if (label && first) { label.textContent = btn.getAttribute("data-label-done") || label.textContent; bridgeLabel(label); }
      if (btn.hasAttribute("data-revert")) {
        clearTimeout(btn.timer);
        btn.timer = setTimeout(() => {
          btn.removeAttribute("data-done");
          if (label) label.textContent = btn.getAttribute("data-label") || label.textContent;
        }, 2000);
      }
    });
  }

  /* ---- hold to delete ---------------------------------------------------- */

  /* Holding a button down is a pointer gesture: it wants a cursor that can rest
     on a target without the finger covering it, and a press that is distinct
     from a tap. Touch has neither, so a held finger there reads as a stuck tap.
     Fine-pointer devices get the hold; everything else gets a two-step confirm
     ("Delete" then "Really delete?"), which is the same guard by other means.
     Both paths end in one `hold-complete` event, so consumers never branch. */
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  function initHold(btn) {
    if (!btn.querySelector("svg")) btn.insertAdjacentHTML("afterbegin", icon("trash"));
    if (!btn.querySelector(".hold-fill")) {
      const f = document.createElement("span");
      f.className = "hold-fill";
      btn.prepend(f);
    }
    const label = btn.querySelector("span:not(.hold-fill)");
    const holdLabel = btn.getAttribute("data-hold-label") || (label && label.textContent) || "Hold to delete";
    const tapLabel = btn.getAttribute("data-tap-label") || "Delete";
    const confirmLabel = btn.getAttribute("data-confirm-label") || "Really delete?";
    const dur = parseInt(btn.getAttribute("data-hold-ms") || "2000", 10);
    btn.style.setProperty("--hold-dur", dur + "ms");

    const fire = () => btn.dispatchEvent(new CustomEvent("hold-complete", { bubbles: true }));

    /* --- hold path (fine pointer) --- */
    let timer;
    const start = () => {
      if (btn.disabled || btn.hasAttribute("data-holding")) return;
      btn.setAttribute("data-holding", "");
      timer = setTimeout(() => { cancel(); fire(); }, dur);
    };
    const cancel = () => { clearTimeout(timer); btn.removeAttribute("data-holding"); };

    /* --- confirm path (coarse pointer) --- */
    let armed;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      btn.removeAttribute("data-confirming");
      if (label) label.textContent = tapLabel;
    };
    const arm = () => {
      btn.setAttribute("data-confirming", "");
      if (label) label.textContent = confirmLabel;
      /* an unanswered confirm goes back to rest rather than sitting armed */
      armed = setTimeout(disarm, 3000);
    };

    btn.addEventListener("pointerdown", (e) => { if (btn.dataset.mode === "hold" && e.pointerType !== "touch") start(); });
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("keydown", (e) => {
      if (btn.dataset.mode !== "hold") return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) start(); }
    });
    btn.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === " ") cancel(); });
    btn.addEventListener("blur", () => { cancel(); if (armed) disarm(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault(); /* a completed hold is the click; never the plain action */
      if (btn.dataset.mode === "hold" || btn.disabled) return;
      if (armed) { disarm(); fire(); } else arm();
    });

    /* Mode is an attribute so the button describes its own behaviour in the
       DOM, and so a hybrid device that gains or loses a mouse re-decides. */
    const setMode = () => {
      const hold = finePointer.matches;
      if (btn.dataset.mode === (hold ? "hold" : "confirm")) return;
      cancel();
      if (armed) disarm();
      btn.dataset.mode = hold ? "hold" : "confirm";
      if (label) label.textContent = hold ? holdLabel : tapLabel;
    };
    setMode();
    finePointer.addEventListener("change", setMode);
  }

  /* ---- dialogs: light-dismiss ------------------------------------------ */

  function initDialog(dlg) {
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close(); /* backdrop click */
    });
  }

  /* ---- wire up ----------------------------------------------------------- */

  /* Component fragments (packages/g-ui/src/components/*.js) register here;
     they run once immediately and again for every g.swap'd view. */
  g.plugins = [];
  g.use = (fn) => {
    g.plugins.push(fn);
    if (document.readyState !== "loading") fn(document);
    else document.addEventListener("DOMContentLoaded", () => fn(document), { once: true });
  };

  function init(root = document) {
    g.plugins.forEach((fn) => { if (root !== document) fn(root); });
    /* generic: any element can request an animated icon by name */
    root.querySelectorAll("[data-icon]").forEach((el) => {
      if (!el.querySelector(".gi")) el.insertAdjacentHTML("afterbegin", icon(el.getAttribute("data-icon")));
    });
    root.querySelectorAll(".tabs").forEach(initTabs);
    root.querySelectorAll(".menu[popover]").forEach(initMenu);
    root.querySelectorAll(".copy-btn").forEach(initCopy);
    root.querySelectorAll(".confirm-btn").forEach(initConfirm);
    root.querySelectorAll(".hold-btn").forEach(initHold);
    root.querySelectorAll(".save-btn").forEach(initSave);
    root.querySelectorAll(".send-btn").forEach(initSend);
    root.querySelectorAll(".dl-btn").forEach(initDownload);
    root.querySelectorAll(".spin-btn").forEach(initSpin);
    root.querySelectorAll("dialog.cmdk").forEach(initCmdk);
    root.querySelectorAll("dialog.dlg").forEach(initDialog);
  }
  g.init = init;
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => init());
  else init();
})();

/* g.chart, dependency-free SVG charts. Every renderer takes (el, data,
   opts), replaces the element's content and sizes itself to the box, so a
   re-render is just calling it again. Colours are written as var(--chart-N)
   strings, so the theme owns the palette and a switch recolours live. */
(() => {
  const g = (window.g = window.g || {});
  const NS = "http://www.w3.org/2000/svg";
  const chart = (g.chart = g.chart || {});

  const node = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };
  const color = (n) => `var(--chart-${((Math.round(n || 1) - 1) % 6 + 6) % 6 + 1})`;
  const nums = (v) => (Array.isArray(v) ? v : []).map(Number).filter(Number.isFinite);
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (v, opts) =>
    (opts && opts.format ? opts.format(v) : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(v));

  /* A flat series draws down the middle rather than collapsing onto an edge. */
  function extent(values, opts) {
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (opts && opts.zero) lo = Math.min(0, lo);
    if (opts && opts.min != null) lo = opts.min;
    if (opts && opts.max != null) hi = opts.max;
    if (hi === lo) { hi += 1; lo -= 1; }
    return [lo, hi];
  }

  /* Clear the host and hand back its box. Measuring after the clear is
     deliberate: a height that came from content collapses to 0 and falls
     back to the default, a height that came from CSS survives. */
  function open(host, dw, dh) {
    cancelAnimationFrame(host._gchartFrame);
    host.classList.add("g-chart");
    host.textContent = "";
    return { w: Math.max(1, host.clientWidth || dw), h: Math.max(1, host.clientHeight || dh) };
  }

  function frame(w, h) {
    return node("svg", {
      viewBox: `0 0 ${w} ${h}`,
      width: "100%",
      height: "100%",
      preserveAspectRatio: "none",
      role: "img",
    });
  }

  /* The entrance runs once per element and never on a re-render of the same
     one; interruption is safe because the flip is a single queued frame. */
  function enter(host, marked) {
    if (still() || host._gchartEntered) {
      marked.forEach((el) => { el.removeAttribute("data-draw"); el.removeAttribute("data-rise"); el.removeAttribute("data-fade"); });
      return;
    }
    host._gchartEntered = true;
    host._gchartFrame = requestAnimationFrame(() =>
      (host._gchartFrame = requestAnimationFrame(() => marked.forEach((el) => el.setAttribute("data-on", "")))));
  }

  /* Re-arm the entrance so the next render animates again. */
  chart.replay = (host) => { host._gchartEntered = false; };

  function legend(items) {
    const box = document.createElement("div");
    box.className = "g-chart-legend";
    items.forEach((it) => {
      const key = document.createElement("span");
      key.className = "g-chart-key";
      const dot = document.createElement("i");
      dot.style.background = it.color;
      key.append(dot, document.createTextNode(it.label));
      if (it.value != null) {
        const val = document.createElement("b");
        val.textContent = it.value;
        key.append(val);
      }
      box.append(key);
    });
    return box;
  }

  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("");

  /* ---- sparkline -------------------------------------------------------- */

  chart.sparkline = (host, values, opts = {}) => {
    values = nums(values);
    const { w, h } = open(host, 120, 28);
    if (!values.length) return;

    const c = color(opts.color);
    const pad = 4;
    const [lo, hi] = extent(values, opts);
    const x = (i) => (values.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (values.length - 1));
    const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    const pts = values.map((v, i) => [x(i), y(v)]);

    const svg = frame(w, h);
    svg.append(node("path", {
      d: `${path(pts)}L${x(values.length - 1).toFixed(2)},${h}L${x(0).toFixed(2)},${h}Z`,
      fill: c,
      "fill-opacity": opts.fillOpacity ?? 0.08,
      stroke: "none",
      "data-fade": "",
    }));
    svg.append(node("path", {
      d: path(pts),
      fill: "none",
      stroke: c,
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      pathLength: 1,
      "data-draw": "",
    }));
    svg.append(node("circle", {
      cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.5, fill: c, "data-fade": "",
    }));
    host.append(svg);
    enter(host, [...svg.children]);
  };

  /* ---- line ------------------------------------------------------------- */

  chart.line = (host, data = {}, opts = {}) => {
    const series = (data.series || []).slice(0, 6)
      .map((s, i) => ({ label: s.label || `Series ${i + 1}`, values: nums(s.values), color: color(s.color ?? i + 1) }))
      .filter((s) => s.values.length);
    const labels = data.labels || [];
    const showLegend = opts.legend !== false && series.length > 1;

    const { w, h } = open(host, 520, 200);
    if (!series.length) return;

    const keys = showLegend ? legend(series.map((s) => ({ label: s.label, color: s.color }))) : null;
    if (keys) host.append(keys);
    const hSvg = Math.max(40, h - (keys ? keys.offsetHeight + 8 : 0));

    const padL = opts.padLeft ?? 38;
    const padR = 12;
    const padT = 10;
    const padB = labels.length ? 20 : 8;
    const y0 = hSvg - padB;
    const all = series.flatMap((s) => s.values);
    const [lo, hi] = extent(all, opts);
    const n = Math.max(...series.map((s) => s.values.length));
    const x = (i) => (n === 1 ? (padL + w - padR) / 2 : padL + (i * (w - padL - padR)) / (n - 1));
    const y = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - padT);

    const svg = frame(w, hSvg);
    svg.append(node("line", { x1: padL, y1: y0, x2: w - padR, y2: y0, stroke: "var(--border-subtle)", "stroke-width": 1 }));

    [[hi, y(hi)], [lo, y(lo)]].forEach(([v, at]) => {
      const t = node("text", { x: padL - 8, y: at + 3.5, "text-anchor": "end", class: "num" });
      t.textContent = fmt(v, opts);
      svg.append(t);
    });

    if (labels.length) {
      [[labels[0], x(0), "start"], [labels[Math.min(labels.length, n) - 1], x(n - 1), "end"]].forEach(([label, at, anchor]) => {
        const t = node("text", { x: at, y: y0 + 14, "text-anchor": anchor });
        t.textContent = label;
        svg.append(t);
      });
    }

    const drawn = [];
    series.forEach((s, i) => {
      const pts = s.values.map((v, j) => [x(j), y(v)]);
      const line = node("path", {
        d: path(pts),
        fill: "none",
        stroke: s.color,
        "stroke-width": 1.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        pathLength: 1,
        "data-draw": "",
      });
      line.style.transitionDelay = `${i * 40}ms`;
      const last = pts[pts.length - 1];
      const dot = node("circle", { cx: last[0], cy: last[1], r: 2.5, fill: s.color, "data-fade": "" });
      dot.style.transitionDelay = `${i * 40 + 120}ms`;
      svg.append(line, dot);
      drawn.push(line, dot);
    });

    host.prepend(svg);
    enter(host, drawn);
  };

  /* ---- bar -------------------------------------------------------------- */

  /* Rounded top only: a rect with rx would round the feet into the baseline. */
  function barPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - r * 2}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`;
  }

  chart.bar = (host, data = {}, opts = {}) => {
    const values = nums(data.values);
    const labels = data.labels || [];
    const { w, h } = open(host, 520, 200);
    if (!values.length) return;

    const c = color(opts.color);
    const padT = opts.values ? 18 : 10;
    const padB = labels.length ? 20 : 8;
    const padX = 2;
    const y0 = h - padB;
    const [lo, hi] = extent(values, { ...opts, zero: opts.zero !== false });
    const band = (w - padX * 2) / values.length;
    const bw = Math.max(3, band * (opts.barWidth ?? 0.62));
    const y = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - padT);

    const svg = frame(w, h);
    const risen = [];
    values.forEach((v, i) => {
      const cx = padX + band * i + band / 2;
      const top = y(v);
      const bar = node("path", {
        d: barPath(cx - bw / 2, top, bw, Math.max(1, y0 - top), 2),
        fill: c,
        "data-rise": "",
      });
      bar.style.transformOrigin = `${cx}px ${y0}px`;
      bar.style.transitionDelay = `${i * 20}ms`;
      svg.append(bar);
      risen.push(bar);

      if (opts.values) {
        const t = node("text", { x: cx, y: top - 6, "text-anchor": "middle", class: "num" });
        t.textContent = fmt(v, opts);
        svg.append(t);
      }
      if (labels[i] != null) {
        const t = node("text", { x: cx, y: y0 + 14, "text-anchor": "middle" });
        t.textContent = labels[i];
        svg.append(t);
      }
    });
    svg.append(node("line", { x1: padX, y1: y0, x2: w - padX, y2: y0, stroke: "var(--border-subtle)", "stroke-width": 1 }));

    host.append(svg);
    enter(host, risen);
  };

  /* ---- donut ------------------------------------------------------------ */

  chart.donut = (host, data = [], opts = {}) => {
    const slices = (data || [])
      .map((d, i) => ({ label: d.label || `Slice ${i + 1}`, value: Number(d.value) || 0, color: color(d.color ?? i + 1) }))
      .filter((d) => d.value > 0)
      .slice(0, 6);
    const side = opts.legend === "side";

    const { w, h } = open(host, 240, 190);
    host.toggleAttribute("data-layout", false);
    if (side) host.setAttribute("data-layout", "side");
    if (!slices.length) return;

    const total = slices.reduce((a, d) => a + d.value, 0);
    const keys = opts.legend === false ? null : legend(slices.map((d) => ({
      label: d.label,
      color: d.color,
      value: opts.legendValues === false ? null : fmt(d.value, opts),
    })));
    if (keys) host.append(keys);

    const wSvg = side && keys ? Math.max(60, w - keys.offsetWidth - 16) : w;
    const hSvg = !side && keys ? Math.max(60, h - keys.offsetHeight - 8) : h;
    const size = Math.min(wSvg, hSvg);
    const thick = size * 0.14;
    const r = (size - thick) / 2;
    const C = 2 * Math.PI * r;
    const gap = Math.min(2, C / (slices.length * 3));
    const cx = wSvg / 2;
    const cy = hSvg / 2;

    const svg = frame(wSvg, hSvg);
    const ring = node("g", { transform: `rotate(-90 ${cx} ${cy})` });
    let at = 0;
    slices.forEach((d) => {
      const len = (d.value / total) * C;
      const dash = Math.max(0.5, len - gap);
      ring.append(node("circle", {
        cx, cy, r,
        fill: "none",
        stroke: d.color,
        "stroke-width": thick,
        "stroke-dasharray": `${dash.toFixed(2)} ${(C - dash).toFixed(2)}`,
        "stroke-dashoffset": (-(at + gap / 2)).toFixed(2),
      }));
      at += len;
    });
    svg.append(ring);

    const centre = node("text", {
      x: cx, y: cy, "text-anchor": "middle",
      "dominant-baseline": "middle",
      class: "center-value num",
      "font-size": Math.max(13, Math.round(size * 0.16)),
    });
    centre.textContent = opts.center ?? fmt(total, opts);
    svg.append(centre);
    if (opts.caption) {
      const cap = node("text", { x: cx, y: cy + Math.round(size * 0.13) + 6, "text-anchor": "middle", "dominant-baseline": "middle" });
      cap.textContent = opts.caption;
      svg.append(cap);
    }

    host.prepend(svg);
  };

  /* ---- declarative sparklines ------------------------------------------- */

  g.use((root) => {
    root.querySelectorAll(".g-spark").forEach((el) => {
      if (el.hasAttribute("data-init")) return;
      el.setAttribute("data-init", "");
      const values = nums((el.getAttribute("data-values") || "").split(","));
      if (values.length) chart.sparkline(el, values, { color: Number(el.getAttribute("data-color")) || 1 });
    });
  });
})();

/* data behaviours: pagination, right-click menus, sortable and selectable
   tables. Each init stamps the element so a re-init after g.swap is a no-op. */
(() => {
  const g = (window.g = window.g || {});

  const once = (el, flag) => {
    if (el.hasAttribute(flag)) return false;
    el.setAttribute(flag, "");
    return true;
  };

  /* ---- pagination -------------------------------------------------------
     Prev and next step through the buttons that are actually rendered, so a
     set with ellipsis gaps jumps the gap rather than paging into nothing. */

  function initPages(nav) {
    if (!once(nav, "data-pages-init")) return;
    const pages = () => [...nav.querySelectorAll("[data-page]")].filter((b) => /^\d+$/.test(b.dataset.page));
    const prev = nav.querySelector('[data-page="prev"]');
    const next = nav.querySelector('[data-page="next"]');
    const current = () => nav.querySelector('[aria-current="page"]');

    function edges() {
      const i = pages().indexOf(current());
      if (prev) prev.disabled = i <= 0;
      if (next) next.disabled = i < 0 || i === pages().length - 1;
    }
    function go(btn) {
      if (!btn || btn === current()) return edges();
      pages().forEach((b) => b.removeAttribute("aria-current"));
      btn.setAttribute("aria-current", "page");
      edges();
      nav.dispatchEvent(new CustomEvent("page", {
        bubbles: true,
        detail: { page: Number(btn.dataset.page) },
      }));
    }
    nav.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-page]");
      if (!btn || btn.disabled) return;
      const list = pages();
      const i = list.indexOf(current());
      if (btn === prev) go(list[Math.max(0, i - 1)]);
      else if (btn === next) go(list[Math.min(list.length - 1, i + 1)]);
      else go(btn);
    });
    edges();
  }

  /* ---- context menu -----------------------------------------------------
     Reuses the .menu popover recipe: we place it at the pointer and show it,
     the existing menu behaviour keeps the arrow keys, and popover auto mode
     keeps Escape and outside click.

     The one subtlety: a contextmenu event arrives mid-press, and the browser
     light-dismisses open popovers on the pointerup that ends that press, so a
     menu opened here would be shut a moment later. When a pointer is down we
     hand the open to that pointerup; a keyboard menu key opens immediately. */

  let pointerDown = false, pendingOpen = null;
  addEventListener("pointerdown", () => { pointerDown = true; }, true);
  addEventListener("pointerup", () => {
    pointerDown = false;
    const open = pendingOpen;
    pendingOpen = null;
    open?.();
  }, true);
  addEventListener("pointercancel", () => { pointerDown = false; pendingOpen = null; }, true);

  function showMenuAt(menu, x, y) {
    if (!menu.matches(":popover-open")) menu.showPopover();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.setProperty("--_origin", "top left");
    menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
    menu.querySelector(".menu-item:not(:disabled)")?.focus({ preventScroll: true });
  }

  function initContextMenu(target) {
    if (!once(target, "data-ctx-init")) return;
    const menu = document.getElementById(target.getAttribute("data-context-menu"));
    if (!menu) return;
    target.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const open = () => showMenuAt(menu, e.clientX, e.clientY);
      if (pointerDown) pendingOpen = open;
      else open();
    });
  }

  /* ---- sortable ---------------------------------------------------------- */

  const cellText = (row, i) => (row.cells[i]?.getAttribute("data-value") ?? row.cells[i]?.textContent ?? "").trim();
  const asNumber = (s) => parseFloat(s.replace(/[^\d.-]/g, "")) || 0;

  function initSortable(table) {
    if (!once(table, "data-sort-init")) return;
    const tbody = table.tBodies[0];
    const heads = [...table.querySelectorAll("th[data-sort]")];
    heads.forEach((th) => {
      if (!th.hasAttribute("aria-sort")) th.setAttribute("aria-sort", "none");
      th.tabIndex = 0;
      const sort = () => {
        const dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        heads.forEach((o) => o.setAttribute("aria-sort", "none"));
        th.setAttribute("aria-sort", dir);
        const col = [...th.parentNode.children].indexOf(th);
        const numeric = th.dataset.sort === "num";
        const sign = dir === "ascending" ? 1 : -1;
        [...tbody.rows]
          .sort((a, b) => {
            const x = cellText(a, col), y = cellText(b, col);
            return sign * (numeric ? asNumber(x) - asNumber(y) : x.localeCompare(y));
          })
          .forEach((r) => tbody.append(r));
      };
      th.addEventListener("click", sort);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); }
      });
    });
  }

  /* ---- selectable -------------------------------------------------------- */

  function initSelectable(table) {
    if (!once(table, "data-select-init")) return;
    const all = table.querySelector("thead .checkbox");
    const boxes = () => [...table.querySelectorAll("tbody .checkbox")];
    function sync(emit) {
      const list = boxes();
      const n = list.filter((b) => b.checked).length;
      list.forEach((b) => b.closest("tr").toggleAttribute("data-selected", b.checked));
      if (all) {
        all.checked = n > 0 && n === list.length;
        all.indeterminate = n > 0 && n < list.length;
      }
      if (emit) table.dispatchEvent(new CustomEvent("selection", { bubbles: true, detail: { count: n, total: list.length } }));
    }
    all?.addEventListener("change", () => {
      boxes().forEach((b) => { b.checked = all.checked; });
      sync(true);
    });
    table.addEventListener("change", (e) => {
      if (e.target.classList.contains("checkbox") && e.target.closest("tbody")) sync(true);
    });
    sync(false);
  }

  g.use((root) => {
    root.querySelectorAll(".g-pages").forEach(initPages);
    root.querySelectorAll("[data-context-menu]").forEach(initContextMenu);
    root.querySelectorAll(".table.g-sortable").forEach(initSortable);
    root.querySelectorAll(".table.g-selectable").forEach(initSelectable);
  });
})();

/* g-ui behaviour: slider, progress, meter, dropzone.
   Every one of these reads its value straight out of the DOM, the range
   input, aria-valuenow, data-value, the file input's FileList, so there is
   no second copy to drift. Progress and meter watch their own attributes,
   which makes `el.setAttribute("aria-valuenow", 40)` the whole API. */
(() => {
  const g = (window.g = window.g || {});

  const num = (v, fallback) => (v == null || v === "" || isNaN(+v) ? fallback : +v);
  const clamp = (n) => Math.min(1, Math.max(0, n));

  /* ---- slider ----------------------------------------------------------- */

  function initSlider(wrap) {
    const input = wrap.querySelector('input[type="range"]');
    if (!input) return;
    let out = wrap.querySelector(".g-slider-out");
    if (wrap.hasAttribute("data-output") && !out) {
      out = document.createElement("span");
      out.className = "g-slider-out num";
      out.setAttribute("aria-hidden", "true"); /* the input already announces it */
      wrap.prepend(out);
    }
    const sync = () => {
      const min = num(input.min, 0);
      const max = num(input.max, 100);
      wrap.style.setProperty("--_p", max === min ? 0 : clamp((input.value - min) / (max - min)));
      if (out) {
        const suf = wrap.getAttribute("data-suffix") || "";
        /* the number is what sits over the thumb; the suffix hangs off its
           right edge without pulling the centre, so 5% and 100% both align */
        out.textContent = input.value;
        out.dataset.suffix = suf;
      }
    };
    input.addEventListener("input", sync);
    sync();
  }

  /* ---- progress --------------------------------------------------------- */

  function fillOf(el, cls) {
    let fill = el.querySelector("." + cls);
    if (!fill) {
      fill = document.createElement("span");
      fill.className = cls;
      el.append(fill);
    }
    return fill;
  }

  function initProgress(el) {
    const fill = fillOf(el, "g-progress-fill");
    if (!el.hasAttribute("role")) el.setAttribute("role", "progressbar");
    /* written once, before the observer starts: writing an observed attribute
       from inside the callback would re-enter forever */
    if (!el.hasAttribute("aria-valuemin")) el.setAttribute("aria-valuemin", 0);
    if (!el.hasAttribute("aria-valuemax")) el.setAttribute("aria-valuemax", 100);
    const sync = () => {
      const min = num(el.getAttribute("aria-valuemin"), 0);
      const max = num(el.getAttribute("aria-valuemax"), 100);
      if (el.hasAttribute("data-indeterminate")) {
        fill.style.width = "";
        return;
      }
      const now = num(el.getAttribute("aria-valuenow"), 0);
      fill.style.width = (max === min ? 0 : clamp((now - min) / (max - min)) * 100) + "%";
    };
    new MutationObserver(sync).observe(el, {
      attributes: true,
      attributeFilter: ["aria-valuenow", "aria-valuemin", "aria-valuemax", "data-indeterminate"],
    });
    sync();
  }

  /* ---- meter ------------------------------------------------------------ */

  function initMeter(el) {
    const fill = fillOf(el, "g-meter-fill");
    if (!el.hasAttribute("role")) el.setAttribute("role", "meter");
    const sync = () => {
      const min = num(el.dataset.min, 0);
      const max = num(el.dataset.max, 100);
      const value = num(el.dataset.value, 0);
      const warn = num(el.dataset.warnAt, Infinity);
      const danger = num(el.dataset.dangerAt, Infinity);
      fill.style.width = (max === min ? 0 : clamp((value - min) / (max - min)) * 100) + "%";
      el.setAttribute("data-zone", value >= danger ? "danger" : value >= warn ? "warn" : "ok");
      el.setAttribute("aria-valuemin", min);
      el.setAttribute("aria-valuemax", max);
      el.setAttribute("aria-valuenow", value);
      if (el.dataset.valuetext) el.setAttribute("aria-valuetext", el.dataset.valuetext);
    };
    new MutationObserver(sync).observe(el, {
      attributes: true,
      attributeFilter: ["data-value", "data-min", "data-max", "data-warn-at", "data-danger-at", "data-valuetext"],
    });
    sync();
  }

  /* ---- dropzone --------------------------------------------------------- */

  const FILE_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"/></svg>';
  const X_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

  function fileSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function initDropzone(zone) {
    const input = zone.querySelector('input[type="file"]');
    if (!input) return;
    let list = zone.querySelector(".g-dropzone-files");
    if (!list) {
      list = document.createElement("ul");
      list.className = "g-dropzone-files";
      zone.append(list);
    }

    /* the FileList on the input is the only store: a drop writes into it
       through a DataTransfer, so a real form submit carries what is shown */
    const put = (files) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      input.files = dt.files;
      render();
      zone.dispatchEvent(new CustomEvent("files", {
        bubbles: true,
        detail: { files: [...input.files] },
      }));
    };
    const add = (incoming) => {
      const kept = input.multiple ? [...input.files] : [];
      for (const f of incoming) {
        if (kept.some((k) => k.name === f.name && k.size === f.size)) continue;
        if (!input.multiple) kept.length = 0;
        kept.push(f);
      }
      put(kept);
    };
    const remove = (i) => put([...input.files].filter((_, n) => n !== i));

    function render() {
      list.textContent = "";
      [...input.files].forEach((f, i) => {
        const li = document.createElement("li");
        li.className = "g-dropzone-file";
        li.innerHTML = `${FILE_ICON}<span class="g-dropzone-name"></span><span class="g-dropzone-size num"></span>`;
        li.querySelector(".g-dropzone-name").textContent = f.name;
        li.querySelector(".g-dropzone-size").textContent = fileSize(f.size);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-tertiary btn-sm btn-icon";
        btn.setAttribute("aria-label", "Remove " + f.name);
        btn.innerHTML = X_ICON;
        btn.addEventListener("click", () => remove(i));
        li.append(btn);
        list.append(li);
      });
    }

    input.addEventListener("change", () => {
      render();
      zone.dispatchEvent(new CustomEvent("files", { bubbles: true, detail: { files: [...input.files] } }));
    });

    /* dragenter/leave fire per child element, so count depth instead of
       trusting a single leave to mean the pointer really left */
    let depth = 0;
    const over = (on) => zone.toggleAttribute("data-dragover", on);
    zone.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; over(true); });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    zone.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; over(false); } });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      over(false);
      if (e.dataTransfer?.files?.length) add(e.dataTransfer.files);
    });

    render();
  }

  /* g.progress(el, p, parts): the imperative face of .g-progress. p is 0..1 for
     measurable work, true for a sweep. parts fill the readout the bar reports
     to: the .progress-readout beside it, or the id its data-readout names (a
     bar pinned to a panel's top edge often reports in the footer). */
  g.progress = (el, p, parts) => {
    if (!el.classList.contains("g-progress")) el.classList.add("g-progress");
    if (!el.hasAttribute("data-progress-init")) { el.setAttribute("data-progress-init", ""); initProgress(el); }
    if (p === true) el.setAttribute("data-indeterminate", "");
    else {
      el.removeAttribute("data-indeterminate");
      el.setAttribute("aria-valuenow", Math.round(clamp(p || 0) * 100));
    }
    const ref = el.getAttribute("data-readout");
    const out = (ref && document.getElementById(ref)) || el.closest(".progress-row")?.querySelector(".progress-readout") || el.parentElement?.querySelector(".progress-readout");
    if (!out) return;
    const bits = [];
    if (p !== true) {
      const pct = document.createElement("b");
      pct.className = "pct";
      pct.textContent = Math.round(clamp(p || 0) * 100) + "%";
      bits.push(pct);
    }
    for (const part of [].concat(parts || []).filter(Boolean)) {
      const s = document.createElement("span"); s.textContent = part; bits.push(s);
    }
    out.replaceChildren(...bits);
  };

  /* One set of units for every readout in the system. */
  g.bytes = (n) => {
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i > 0 && n < 10 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
  };
  g.rate = (bps) => g.bytes(bps) + "/s";
  g.eta = (s) => (s >= 60 ? Math.round(s / 60) + "m left" : Math.max(1, Math.round(s)) + "s left");

  /* ---- wire up ---------------------------------------------------------- */

  const each = (root, sel, flag, fn) =>
    root.querySelectorAll(sel).forEach((el) => {
      if (el.hasAttribute(flag)) return;
      el.setAttribute(flag, "");
      fn(el);
    });

  g.use((root) => {
    each(root, ".g-slider", "data-slider-init", initSlider);
    each(root, ".g-progress", "data-progress-init", initProgress);
    each(root, ".g-meter", "data-meter-init", initMeter);
    each(root, ".g-dropzone", "data-dropzone-init", initDropzone);
  });
})();

/* g-select and g-combobox, listbox popups on the Popover API.

   The popups are manual popovers, not auto ones: light dismiss fires on the
   pointerdown that opens the control, so an auto popover would close and
   reopen inside one click. This fragment owns dismissal instead. */
(() => {
  const g = (window.g = window.g || {});
  let uid = 0;
  const nextId = (prefix) => `${prefix}-${++uid}`;

  const rows = (list) =>
    [...list.querySelectorAll('.g-option:not([hidden]):not([aria-disabled="true"])')];

  const labelOf = (opt) =>
    opt.getAttribute("data-label") || opt.textContent.trim().replace(/\s+/g, " ");

  const valueOf = (opt) => opt.getAttribute("data-value") ?? labelOf(opt);

  /* Position under the anchor, flipping above when there is no room, the
     same geometry initMenu uses for .menu, plus a clamp, because a list long
     enough to flip is often too long to fit above the anchor either. */
  function place(list, anchor) {
    const r = anchor.getBoundingClientRect();
    list.style.minWidth = r.width + "px";
    const h = list.offsetHeight;
    const below = r.bottom + 4 + h < innerHeight;
    list.style.setProperty("--_origin", below ? "top" : "bottom");
    list.style.left = Math.min(r.left, innerWidth - list.offsetWidth - 8) + "px";
    const top = below ? r.bottom + 4 : r.top - h - 4;
    list.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + "px";
  }

  /* owner is whatever holds DOM focus, so aria-activedescendant lands there:
     the list itself for a select, the text field for a combobox. */
  function highlight(list, opt, owner) {
    list.querySelectorAll("[data-highlighted]").forEach((o) => o.removeAttribute("data-highlighted"));
    if (!opt) { owner.removeAttribute("aria-activedescendant"); return; }
    opt.setAttribute("data-highlighted", "");
    opt.scrollIntoView({ block: "nearest" });
    owner.setAttribute("aria-activedescendant", opt.id);
  }

  function move(list, owner, step) {
    const items = rows(list);
    if (!items.length) return;
    const cur = items.findIndex((o) => o.hasAttribute("data-highlighted"));
    let i;
    if (step === "first") i = 0;
    else if (step === "last") i = items.length - 1;
    else if (cur < 0) i = step > 0 ? 0 : items.length - 1;
    else i = (cur + step + items.length) % items.length;
    highlight(list, items[i], owner);
  }

  function prepare(list, owner) {
    if (!list.id) list.id = nextId("g-listbox");
    list.setAttribute("popover", "manual");
    list.setAttribute("role", "listbox");
    list.tabIndex = -1;
    list.querySelectorAll(".g-option").forEach((o) => {
      if (!o.id) o.id = nextId("g-option");
      o.setAttribute("role", "option");
      if (!o.hasAttribute("aria-selected")) o.setAttribute("aria-selected", "false");
      if (!o.querySelector(".gi-check")) o.insertAdjacentHTML("afterbegin", g.icon("check"));
      o.addEventListener("pointermove", () => highlight(list, o, owner));
    });
    let empty = list.querySelector(".g-listbox-empty");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "g-listbox-empty";
      empty.textContent = list.getAttribute("data-empty-text") || "No matches";
      list.append(empty);
    }
    empty.setAttribute("role", "presentation");
    empty.hidden = true;
    return empty;
  }

  /* A hidden input mirrors the value so the control posts with the form. */
  function mirror(root) {
    const name = root.getAttribute("data-name");
    if (!name) return null;
    let input = root.querySelector('input[type="hidden"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      root.append(input);
    }
    input.name = name;
    return input;
  }

  function announce(root, opt) {
    root.dispatchEvent(new CustomEvent("change", {
      bubbles: true,
      detail: { value: valueOf(opt), label: labelOf(opt) },
    }));
  }

  function markSelected(list, opt) {
    list.querySelectorAll(".g-option").forEach((o) =>
      o.setAttribute("aria-selected", String(o === opt)));
  }

  /* ---- select ----------------------------------------------------------- */

  function initGSelect(root) {
    if (root.hasAttribute("data-g-init")) return;
    const trigger = root.querySelector(".g-select-trigger");
    const list = root.querySelector(".g-listbox");
    if (!trigger || !list) return;
    root.setAttribute("data-g-init", "");

    const empty = prepare(list, list);
    empty.hidden = true;
    const hidden = mirror(root);

    let value = trigger.querySelector(".g-select-value");
    if (!value) {
      value = document.createElement("span");
      value.className = "g-select-value";
      trigger.append(value);
    }
    value.id = value.id || nextId("g-select-value");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", list.id);
    const labelledby = root.getAttribute("data-labelledby");
    trigger.setAttribute("aria-labelledby", labelledby ? `${labelledby} ${value.id}` : value.id);

    const placeholder = root.getAttribute("data-placeholder") || "Choose one";

    function paint(opt) {
      if (!opt) {
        trigger.setAttribute("data-empty", "");
        value.textContent = placeholder;
        if (hidden) hidden.value = "";
        return;
      }
      trigger.removeAttribute("data-empty");
      /* the trigger wears the row itself, badge and all, minus the check */
      const parts = [...opt.cloneNode(true).childNodes]
        .filter((n) => !(n.nodeType === 1 && n.classList.contains("gi")));
      value.replaceChildren(...parts);
      if (hidden) hidden.value = valueOf(opt);
    }

    function choose(opt) {
      markSelected(list, opt);
      paint(opt);
      announce(root, opt);
    }

    const isOpen = () => list.matches(":popover-open");

    function open() {
      if (isOpen() || trigger.disabled) return;
      list.showPopover();
      place(list, trigger);
      trigger.setAttribute("aria-expanded", "true");
      list.focus({ preventScroll: true });
      highlight(list, list.querySelector('.g-option[aria-selected="true"]') || rows(list)[0], list);
    }

    function close(refocus) {
      if (!isOpen()) return;
      list.hidePopover();
      trigger.setAttribute("aria-expanded", "false");
      highlight(list, null, list);
      if (refocus) trigger.focus();
    }

    trigger.addEventListener("click", () => (isOpen() ? close(true) : open()));
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
    });

    /* the list keeps focus while a row is clicked, so the keys keep working
       if the popup stays open */
    list.addEventListener("pointerdown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const opt = e.target.closest('.g-option:not([aria-disabled="true"])');
      if (!opt) return;
      choose(opt);
      close(true);
    });

    /* typeahead: a single letter cycles the rows that start with it, a longer
       run searches from the top. The buffer clears after 600ms of quiet. */
    let buf = "", bufTimer;
    function typeahead(ch) {
      clearTimeout(bufTimer);
      buf += ch.toLowerCase();
      bufTimer = setTimeout(() => { buf = ""; }, 600);
      const items = rows(list);
      const from = items.findIndex((o) => o.hasAttribute("data-highlighted"));
      const order = buf.length === 1
        ? [...items.slice(from + 1), ...items.slice(0, from + 1)]
        : items;
      const hit = order.find((o) => labelOf(o).toLowerCase().startsWith(buf));
      if (hit) highlight(list, hit, list);
    }

    list.addEventListener("keydown", (e) => {
      const cur = list.querySelector("[data-highlighted]");
      if (e.key === "ArrowDown") { e.preventDefault(); move(list, list, 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(list, list, -1); }
      else if (e.key === "Home") { e.preventDefault(); move(list, list, "first"); }
      else if (e.key === "End") { e.preventDefault(); move(list, list, "last"); }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (cur) choose(cur);
        close(true);
      } else if (e.key === "Escape") { e.preventDefault(); close(true); }
      else if (e.key === "Tab") { close(true); }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        typeahead(e.key);
      }
    });

    document.addEventListener("pointerdown", (e) => {
      if (!root.contains(e.target)) close(false);
    });

    paint(list.querySelector('.g-option[aria-selected="true"]'));
  }

  /* ---- combobox --------------------------------------------------------- */

  function initGCombobox(root) {
    if (root.hasAttribute("data-g-init")) return;
    const input = root.querySelector("input:not([type=hidden])");
    const list = root.querySelector(".g-listbox");
    if (!input || !list) return;
    root.setAttribute("data-g-init", "");

    const empty = prepare(list, input);
    const hidden = mirror(root);

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("autocomplete", "off");

    let chosen = list.querySelector('.g-option[aria-selected="true"]');
    if (chosen) {
      input.value = labelOf(chosen);
      if (hidden) hidden.value = valueOf(chosen);
    }

    const isOpen = () => list.matches(":popover-open");

    function filter() {
      const q = input.value.trim().toLowerCase();
      let any = false;
      list.querySelectorAll(".g-option").forEach((o) => {
        const hit = !q || labelOf(o).toLowerCase().includes(q);
        o.hidden = !hit;
        any = any || hit;
      });
      empty.hidden = any;
      if (isOpen()) { highlight(list, rows(list)[0], input); place(list, input); }
      else highlight(list, null, input);
    }

    function open() {
      if (isOpen() || input.disabled) return;
      list.showPopover();
      place(list, input);
      input.setAttribute("aria-expanded", "true");
      highlight(list, list.querySelector('.g-option[aria-selected="true"]:not([hidden])') || rows(list)[0], input);
    }

    function close() {
      if (!isOpen()) return;
      list.hidePopover();
      input.setAttribute("aria-expanded", "false");
      highlight(list, null, input);
    }

    function choose(opt) {
      chosen = opt;
      markSelected(list, opt);
      input.value = labelOf(opt);
      if (hidden) hidden.value = valueOf(opt);
      announce(root, opt);
      close();
    }

    /* leaving with half-typed text is not a choice: the field settles back
       onto whatever is actually selected */
    function settle() {
      input.value = chosen ? labelOf(chosen) : "";
      filter();
    }

    input.addEventListener("input", () => { open(); filter(); });
    input.addEventListener("click", () => open());
    input.addEventListener("keydown", (e) => {
      const cur = list.querySelector("[data-highlighted]");
      if (e.key === "ArrowDown") { e.preventDefault(); if (!isOpen()) { open(); return; } move(list, input, 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (!isOpen()) { open(); return; } move(list, input, -1); }
      else if (e.key === "Home" && isOpen()) { e.preventDefault(); move(list, input, "first"); }
      else if (e.key === "End" && isOpen()) { e.preventDefault(); move(list, input, "last"); }
      else if (e.key === "Enter") {
        if (!isOpen()) return;
        e.preventDefault();
        if (cur) choose(cur); else close();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (isOpen()) close(); else settle();
      } else if (e.key === "Tab") { close(); }
    });

    /* the field keeps focus while the popup is clicked, so the click lands
       as a choice rather than as a blur */
    list.addEventListener("pointerdown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const opt = e.target.closest('.g-option:not([aria-disabled="true"])');
      if (opt) { choose(opt); input.focus(); }
    });

    root.addEventListener("focusout", (e) => {
      if (root.contains(e.relatedTarget)) return;
      close();
      settle();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!root.contains(e.target) && isOpen()) { close(); settle(); }
    });

    filter();
  }

  g.use((root) => {
    root.querySelectorAll(".g-select").forEach(initGSelect);
    root.querySelectorAll(".g-combobox").forEach(initGCombobox);
  });
})();
