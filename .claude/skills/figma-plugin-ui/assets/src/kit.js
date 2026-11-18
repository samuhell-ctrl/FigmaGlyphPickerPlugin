/* =============================================================================
   PLUGIN UI KIT — RUNTIME  (window.K)
   Zero dependencies. Works inside the Figma plugin iframe and in a plain
   browser tab (gallery), where the figma bridge degrades to a no-op.
   ============================================================================= */
(function () {
  "use strict";

  var INSIDE_FIGMA = typeof parent !== "undefined" && parent !== window;
  var handlers = Object.create(null);

  /* ---------------------------------------------------------------- bridge */

  /** Send a message to code.js (the plugin main thread). */
  function send(type, payload) {
    if (!INSIDE_FIGMA) {
      console.info("[kit] send (no host):", type, payload);
      return;
    }
    parent.postMessage({ pluginMessage: { type: type, payload: payload } }, "*");
  }

  /** Subscribe to a message type coming from code.js. Returns an unsubscriber. */
  function on(type, fn) {
    (handlers[type] || (handlers[type] = [])).push(fn);
    return function off() {
      handlers[type] = handlers[type].filter(function (f) { return f !== fn; });
    };
  }

  window.addEventListener("message", function (event) {
    var msg = event.data && event.data.pluginMessage;
    if (!msg || !msg.type) return;
    (handlers[msg.type] || []).forEach(function (fn) { fn(msg.payload, msg); });
    (handlers["*"] || []).forEach(function (fn) { fn(msg.payload, msg); });
  });

  /* ----------------------------------------------------------------- theme */

  var THEME_KEY = "kit:theme"; // persisted via clientStorage through code.js

  function resolvedTheme() {
    var explicit = document.body.getAttribute("data-theme");
    if (explicit) return explicit;
    if (document.documentElement.classList.contains("figma-dark")) return "dark";
    if (document.documentElement.classList.contains("figma-light")) return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setTheme(next, opts) {
    var persist = !opts || opts.persist !== false;
    document.body.classList.add("k-no-transitions");
    if (next === "auto") {
      document.body.removeAttribute("data-theme");
    } else {
      document.body.setAttribute("data-theme", next);
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.body.classList.remove("k-no-transitions");
      });
    });
    syncSwitches();
    if (persist) send("kit:set-setting", { key: THEME_KEY, value: next });
    document.dispatchEvent(new CustomEvent("kit:themechange", { detail: resolvedTheme() }));
  }

  function toggleTheme() {
    setTheme(resolvedTheme() === "dark" ? "light" : "dark");
  }

  function syncSwitches() {
    var dark = resolvedTheme() === "dark";
    document.querySelectorAll('[data-kit="theme-switch"]').forEach(function (el) {
      if ("checked" in el) el.checked = dark;
      el.setAttribute("aria-checked", String(dark));
    });
  }

  /* ----------------------------------------------------------------- toast */

  function toastLayer() {
    var layer = document.querySelector(".k-toasts");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "k-toasts";
      document.body.appendChild(layer);
    }
    return layer;
  }

  function toast(message, opts) {
    opts = opts || {};
    var el = document.createElement("div");
    el.className = "k-toast";
    el.setAttribute("role", "status");
    if (opts.tone) el.setAttribute("data-tone", opts.tone);
    el.textContent = message;
    toastLayer().appendChild(el);
    var ms = opts.duration == null ? 2200 : opts.duration;
    setTimeout(function () {
      el.classList.add("is-leaving");
      el.addEventListener("animationend", function () { el.remove(); }, { once: true });
    }, ms);
    return el;
  }

  /* ----------------------------------------------------------------- modal */

  function modal(target) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) throw new Error("[kit] modal target not found: " + target);
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      root.classList.add("is-open");
      root.setAttribute("aria-hidden", "false");
      var first = root.querySelector("[autofocus], button, input, select, textarea");
      if (first) first.focus();
      document.addEventListener("keydown", onKey);
    }
    function close() {
      root.classList.remove("is-open");
      root.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

    root.addEventListener("mousedown", function (e) { if (e.target === root) close(); });
    root.querySelectorAll('[data-kit="modal-close"]').forEach(function (btn) {
      btn.addEventListener("click", close);
    });

    return { open: open, close: close, el: root, isOpen: function () { return root.classList.contains("is-open"); } };
  }

  /* ------------------------------------------------- segmented control/tabs */

  function segment(target, onChange) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return { value: function () { return null; } };
    var items = Array.prototype.slice.call(root.querySelectorAll("[data-value]"));

    function select(value, silent) {
      items.forEach(function (it) {
        it.setAttribute("aria-selected", String(it.dataset.value === value));
      });
      if (!silent && onChange) onChange(value);
    }
    items.forEach(function (it) {
      it.addEventListener("click", function () { select(it.dataset.value); });
    });
    root.addEventListener("keydown", function (e) {
      var i = items.indexOf(document.activeElement);
      if (i < 0) return;
      var next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
      if (next < 0 || next >= items.length) return;
      e.preventDefault();
      items[next].focus();
      select(items[next].dataset.value);
    });

    var initial = root.querySelector('[aria-selected="true"]');
    if (initial) select(initial.dataset.value, true);

    return {
      select: select,
      value: function () {
        var cur = root.querySelector('[aria-selected="true"]');
        return cur ? cur.dataset.value : null;
      }
    };
  }

  /* ---------------------------------------------------------------- search */

  /** Wires the clear button + filled state, and debounces input. */
  function search(target, onInput, debounceMs) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return {};
    var input = root.querySelector("input");
    var clear = root.querySelector('[data-kit="search-clear"]');
    var timer = null;
    var wait = debounceMs == null ? 120 : debounceMs;

    function sync() { root.setAttribute("data-filled", String(!!input.value)); }

    input.addEventListener("input", function () {
      sync();
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { if (onInput) onInput(input.value); }, wait);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && input.value) {
        e.stopPropagation();
        input.value = "";
        sync();
        if (onInput) onInput("");
      }
    });
    if (clear) {
      clear.addEventListener("click", function () {
        input.value = "";
        sync();
        input.focus();
        if (onInput) onInput("");
      });
    }
    sync();
    return { input: input, value: function () { return input.value; }, focus: function () { input.focus(); } };
  }

  /* ----------------------------------------------------------------- misc */

  function scale(n) {
    document.documentElement.style.setProperty("--k-scale", String(n));
    send("kit:set-setting", { key: "kit:scale", value: n });
  }

  /** Ask code.js to resize the window to fit content height. */
  function autoResize(opts) {
    opts = opts || {};
    var width = opts.width || Math.ceil(document.body.getBoundingClientRect().width);
    var el = opts.measure ? document.querySelector(opts.measure) : document.querySelector(".k-app") || document.body;
    var height = Math.ceil(el.scrollHeight);
    if (opts.max) height = Math.min(height, opts.max);
    if (opts.min) height = Math.max(height, opts.min);
    send("kit:resize", { width: width, height: height });
  }

  function loading(btn, state) {
    var el = typeof btn === "string" ? document.querySelector(btn) : btn;
    if (!el) return;
    if (state) el.setAttribute("data-loading", "true");
    else el.removeAttribute("data-loading");
    el.disabled = !!state;
  }

  function progress(target, ratio) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return;
    var bar = root.querySelector(".k-progress__bar");
    if (ratio == null) {
      root.classList.add("k-progress--indeterminate");
      bar.style.width = "";
    } else {
      root.classList.remove("k-progress--indeterminate");
      bar.style.width = Math.max(0, Math.min(1, ratio)) * 100 + "%";
    }
  }

  /** Delegated click handler: $on('click', '.k-cell', fn) */
  function delegate(type, selector, fn, root) {
    (root || document).addEventListener(type, function (e) {
      var match = e.target.closest(selector);
      if (match) fn(e, match);
    });
  }

  /* ----------------------------------------------------------------- init */

  function init(opts) {
    opts = opts || {};

    // Declarative theme switches: <input class="k-switch" data-kit="theme-switch">
    delegate("change", '[data-kit="theme-switch"]', function (_, el) {
      setTheme(el.checked ? "dark" : "light");
    });
    delegate("click", '[data-kit="theme-toggle"]', function () { toggleTheme(); });

    // Restore persisted settings from clientStorage via code.js.
    on("kit:settings", function (settings) {
      settings = settings || {};
      if (settings[THEME_KEY]) setTheme(settings[THEME_KEY], { persist: false });
      if (settings["kit:scale"]) {
        document.documentElement.style.setProperty("--k-scale", String(settings["kit:scale"]));
      }
      syncSwitches();
      document.dispatchEvent(new CustomEvent("kit:ready", { detail: settings }));
    });

    // Follow Figma's native theme while no explicit choice is stored.
    new MutationObserver(syncSwitches).observe(document.documentElement, {
      attributes: true, attributeFilter: ["class"]
    });

    syncSwitches();
    send("kit:get-settings", { keys: [THEME_KEY, "kit:scale"].concat(opts.settings || []) });

    // Nothing persisted yet / running outside Figma: fire ready anyway.
    setTimeout(function () {
      if (!document.body.hasAttribute("data-kit-ready")) {
        document.body.setAttribute("data-kit-ready", "1");
        document.dispatchEvent(new CustomEvent("kit:ready", { detail: {} }));
      }
    }, INSIDE_FIGMA ? 400 : 0);
    on("kit:settings", function () { document.body.setAttribute("data-kit-ready", "1"); });
  }

  window.K = {
    init: init,
    send: send,
    on: on,
    delegate: delegate,
    theme: { get: resolvedTheme, set: setTheme, toggle: toggleTheme },
    scale: scale,
    toast: toast,
    modal: modal,
    segment: segment,
    search: search,
    loading: loading,
    progress: progress,
    autoResize: autoResize,
    insideFigma: INSIDE_FIGMA
  };
})();
