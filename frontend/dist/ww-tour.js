/**
 * Weien Wong guided tour.
 *
 * Shows somebody round a page the first time they see it: a spotlight on one
 * element at a time, with a short note saying what it is for.
 *
 * Steps are declared on the elements themselves, so the tour lives next to the
 * thing it describes and cannot drift from it:
 *
 *   <a href="/scans" data-tour="1"
 *      data-tour-title="Your scans"
 *      data-tour-body="Every check you have run, newest first.">
 *
 * Include it, and that is all:
 *   <script src="https://weienwong.online/static/js/ww-tour.js"></script>
 *
 * A page with no annotated elements has no tour and shows nothing, so adding
 * the script everywhere is safe.
 *
 * It runs once per person per site. `WWTour.start()` runs it again on demand,
 * which is what a "Take the tour" button should call.
 */
(function (global) {
  "use strict";

  var STYLE_ID = "ww-tour-style";
  var ROOT_ID = "ww-tour-root";
  var SEEN_PREFIX = "ww-tour-seen:";

  // ── what counts as a step ──────────────────────────────────────

  /**
   * Read the steps declared on a document, in order.
   *
   * `data-tour` is the position. Numbered rather than taken from document
   * order because the order somebody should be shown things is rarely the
   * order they appear in the markup -- a sidebar is written before the main
   * content but is usually the second thing worth pointing at.
   *
   * An element that is not visible is left out. Hiding something and still
   * pointing at it is worse than skipping it: the spotlight lands on nothing
   * and the reader is told to look at empty space.
   */
  function collect(root) {
    var doc = root || document;
    var found = [];
    var nodes = doc.querySelectorAll("[data-tour]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var order = parseFloat(el.getAttribute("data-tour"));
      if (isNaN(order)) continue;
      var title = el.getAttribute("data-tour-title") || "";
      var body = el.getAttribute("data-tour-body") || "";
      if (!title && !body) continue;
      found.push({ order: order, el: el, title: title, body: body });
    }
    found.sort(function (a, b) { return a.order - b.order; });
    return found;
  }

  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    // getClientRects rather than offsetParent: an element with position:fixed
    // has no offsetParent and would read as hidden while plainly on screen.
    if (!el.getClientRects().length) return false;
    var style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (!style) return true;
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function siteKey() {
    return SEEN_PREFIX + global.location.host + global.location.pathname;
  }

  function hasSeen(key) {
    try {
      return global.localStorage.getItem(key || siteKey()) === "1";
    } catch (e) {
      // Private windows and blocked site data throw on access. Someone who
      // cannot be remembered should still get the tour, not an error.
      return false;
    }
  }

  function remember(key) {
    try {
      global.localStorage.setItem(key || siteKey(), "1");
    } catch (e) {
      /* nothing to do: the tour simply runs again next time */
    }
  }

  // ── the furniture ──────────────────────────────────────────────

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent = [
      // pointer-events:none on the root is what makes the spotlight real. The
      // root is a full-viewport fixed box, and without this it took every click
      // itself -- including clicks inside the gap between the shades, which is
      // the one place the tour is pointing at. On a landing page that meant the
      // "Create account" button the tour was highlighting could not be pressed
      // until the tour was skipped, and nothing said so. The shades and the
      // card opt back in below.
      "#" + ROOT_ID + "{position:fixed;inset:0;z-index:10050;overflow:hidden;pointer-events:none;}",
      // overflow:hidden is load-bearing. The ring and the shades are sized
      // from the target's rectangle, and a target wider than the viewport
      // -- which is exactly the case on a page that already overflows --
      // made them wider still. Their own width then counted towards the
      // document scroll width, so opening the tour made the page scroll
      // further sideways than the fault it was pointing at.
      "#" + ROOT_ID + "[hidden]{display:none!important;}",
      // Four panels around the target rather than one box-shadow ring: the
      // gap between them is the spotlight, and each panel takes the click, so
      // the page underneath cannot be operated mid-tour by accident.
      "#" + ROOT_ID + " .ww-tour-shade{position:absolute;pointer-events:auto;background:rgba(1,4,9,.66);backdrop-filter:blur(1.5px);transition:all .18s ease;}",
      "#" + ROOT_ID + " .ww-tour-ring{position:absolute;border:2px solid var(--accent,var(--blue,#58a6ff));border-radius:10px;pointer-events:none;transition:all .18s ease;box-shadow:0 0 0 4px rgba(88,166,255,.15);}",
      "#" + ROOT_ID + " .ww-tour-card{position:absolute;z-index:2;pointer-events:auto;width:min(340px,calc(100vw - 2rem));background:var(--card-solid,var(--surface,#161b22));color:var(--text,var(--ink,#f0f3f6));border:1px solid var(--border,var(--line,rgba(48,54,61,.8)));border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.45);padding:1rem 1.05rem .9rem;transition:top .18s ease,left .18s ease;}",
      "#" + ROOT_ID + " .ww-tour-title{margin:0 0 .4rem;font:600 1rem/1.3 var(--font-display,var(--font,system-ui,sans-serif));letter-spacing:-.01em;}",
      "#" + ROOT_ID + " .ww-tour-body{margin:0;color:var(--text-muted,var(--muted,#7d8590));font:400 .89rem/1.5 var(--font,system-ui,sans-serif);}",
      "#" + ROOT_ID + " .ww-tour-foot{display:flex;align-items:center;gap:.5rem;margin-top:.95rem;}",
      "#" + ROOT_ID + " .ww-tour-count{color:var(--text-muted,var(--muted,#7d8590));font:400 .8rem/1 var(--font,system-ui,sans-serif);margin-right:auto;}",
      "#" + ROOT_ID + " .ww-tour-btn{min-height:36px;padding:.45rem .85rem;border-radius:9px;border:1px solid var(--border,rgba(48,54,61,.8));background:var(--surface-2,var(--bg-elevated,#0d1117));color:inherit;font:600 .85rem/1 var(--font,system-ui,sans-serif);cursor:pointer;}",
      "#" + ROOT_ID + " .ww-tour-btn:hover{border-color:var(--accent,var(--blue,#58a6ff));}",
      "#" + ROOT_ID + " .ww-tour-btn:focus-visible{outline:2px solid var(--accent,#388bfd);outline-offset:2px;}",
      "#" + ROOT_ID + " .ww-tour-btn.primary{background:var(--accent,var(--blue,#238636));border-color:transparent;color:#fff;}",
      "#" + ROOT_ID + " .ww-tour-skip{background:none;border:none;color:var(--text-muted,#7d8590);cursor:pointer;font:400 .8rem/1 var(--font,system-ui,sans-serif);text-decoration:underline;padding:.4rem;}",
      "@media (max-width:560px){#" + ROOT_ID + " .ww-tour-card{left:1rem!important;right:1rem;width:auto;}}",
      "@media (prefers-reduced-motion:reduce){#" + ROOT_ID + " .ww-tour-shade,#" + ROOT_ID + " .ww-tour-ring,#" + ROOT_ID + " .ww-tour-card{transition:none;}}",
    ].join("\n");
    document.head.appendChild(css);
  }

  function build() {
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Guided tour");
    root.innerHTML =
      '<div class="ww-tour-shade" data-side="top"></div>' +
      '<div class="ww-tour-shade" data-side="bottom"></div>' +
      '<div class="ww-tour-shade" data-side="left"></div>' +
      '<div class="ww-tour-shade" data-side="right"></div>' +
      '<div class="ww-tour-ring"></div>' +
      '<div class="ww-tour-card">' +
      '  <h2 class="ww-tour-title"></h2>' +
      '  <p class="ww-tour-body"></p>' +
      '  <div class="ww-tour-foot">' +
      '    <span class="ww-tour-count"></span>' +
      '    <button type="button" class="ww-tour-skip">Skip</button>' +
      '    <button type="button" class="ww-tour-btn" data-act="back">Back</button>' +
      '    <button type="button" class="ww-tour-btn primary" data-act="next">Next</button>' +
      '  </div>' +
      "</div>";
    document.body.appendChild(root);
    return root;
  }

  /**
   * Where to put the card so it neither covers the thing it describes nor
   * falls off the screen. Below the target by preference, above when there is
   * no room below, and clamped to the viewport either way.
   */
  function place(card, rect, viewport) {
    var margin = 12;
    var width = card.w;
    var height = card.h;
    var top = rect.bottom + margin;
    if (top + height > viewport.h - margin) {
      var above = rect.top - height - margin;
      top = above >= margin ? above : Math.max(margin, viewport.h - height - margin);
    }
    var left = rect.left;
    if (left + width > viewport.w - margin) left = viewport.w - width - margin;
    if (left < margin) left = margin;
    return { top: Math.round(top), left: Math.round(left) };
  }

  // ── running one ────────────────────────────────────────────────

  function Tour(steps, options) {
    this.steps = steps;
    this.options = options || {};
    this.index = 0;
    this.root = null;
    this._onKey = null;
    this._onMove = null;
  }

  var running = null;

  Tour.prototype.start = function () {
    if (!this.steps.length) return false;
    ensureStyle();
    this.root = document.getElementById(ROOT_ID) || build();
    this.root.hidden = false;
    this.index = 0;
    running = this;
    // Lets the stylesheet lift the sign-in buttons above the tour (see the CSS
    // below) and lets other scripts see a tour is up.
    document.documentElement.classList.add("ww-tour-active");

    var self = this;
    this.root.querySelector('[data-act="next"]').onclick = function () { self.go(1); };
    this.root.querySelector('[data-act="back"]').onclick = function () { self.go(-1); };
    this.root.querySelector(".ww-tour-skip").onclick = function () { self.stop(); };
    for (var i = 0; i < 4; i++) {
      this.root.querySelectorAll(".ww-tour-shade")[i].onclick = function (e) {
        self.stop();
        // A click on a shade dismisses the tour -- but if it landed on Sign in
        // or Create account underneath, dismissing is not what that person
        // wanted; they wanted the dialog. Those two buttons are the reason a
        // stranger is on the page, so the click is delivered to them. Done by
        // hit-testing after the root is hidden, rather than by z-index: the
        // header is a sticky stacking context (z-index 30), so nothing inside
        // it can be raised above the tour root however large its z-index.
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var trigger = under && under.closest && under.closest("[data-ww-signin],[data-ww-signup]");
        if (trigger) trigger.click();
      };
    }

    this._onKey = function (e) {
      if (e.key === "Escape") self.stop();
      else if (e.key === "ArrowRight" || e.key === "Enter") self.go(1);
      else if (e.key === "ArrowLeft") self.go(-1);
    };
    document.addEventListener("keydown", this._onKey);

    // A page that scrolls or reflows under the tour would leave the spotlight
    // pointing at the wrong place, which is worse than no spotlight.
    this._onMove = function () { self.draw(); };
    global.addEventListener("resize", this._onMove);
    global.addEventListener("scroll", this._onMove, true);

    this.draw();
    return true;
  };

  Tour.prototype.go = function (delta) {
    var next = this.index + delta;
    if (next < 0) return;
    if (next >= this.steps.length) return this.finish();
    this.index = next;
    this.draw();
  };

  Tour.prototype.draw = function () {
    var step = this.steps[this.index];
    if (!step) return this.finish();
    var el = step.el;

    // The element may have gone since the tour started -- a table redrawn, a
    // banner dismissed. Move past it rather than pointing at nothing.
    if (!isVisible(el)) {
      if (this.index + 1 < this.steps.length) return this.go(1);
      return this.finish();
    }

    if (el.scrollIntoView) {
      try {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      } catch (e) {
        el.scrollIntoView();
      }
    }

    var rect = el.getBoundingClientRect();
    var pad = 6;
    var box = {
      top: rect.top - pad, left: rect.left - pad,
      bottom: rect.bottom + pad, right: rect.right + pad,
      width: rect.width + pad * 2, height: rect.height + pad * 2,
    };
    var viewport = { w: global.innerWidth, h: global.innerHeight };

    var shades = this.root.querySelectorAll(".ww-tour-shade");
    style(shades[0], { top: 0, left: 0, width: viewport.w, height: Math.max(0, box.top) });
    style(shades[1], { top: box.bottom, left: 0, width: viewport.w, height: Math.max(0, viewport.h - box.bottom) });
    style(shades[2], { top: box.top, left: 0, width: Math.max(0, box.left), height: Math.max(0, box.height) });
    style(shades[3], { top: box.top, left: box.right, width: Math.max(0, viewport.w - box.right), height: Math.max(0, box.height) });

    style(this.root.querySelector(".ww-tour-ring"), {
      top: box.top, left: box.left, width: box.width, height: box.height,
    });

    var card = this.root.querySelector(".ww-tour-card");
    card.querySelector(".ww-tour-title").textContent = step.title;
    card.querySelector(".ww-tour-body").textContent = step.body;
    card.querySelector(".ww-tour-count").textContent =
      this.index + 1 + " of " + this.steps.length;
    card.querySelector('[data-act="back"]').disabled = this.index === 0;
    card.querySelector('[data-act="next"]').textContent =
      this.index === this.steps.length - 1 ? "Done" : "Next";

    var size = { w: card.offsetWidth || 340, h: card.offsetHeight || 160 };
    var at = place(size, box, viewport);
    card.style.top = at.top + "px";
    card.style.left = at.left + "px";
  };

  Tour.prototype.finish = function () {
    remember(this.options.key);
    this.stop();
  };

  Tour.prototype.stop = function () {
    // Skipping counts as seen. Being shown the same tour on every visit after
    // deliberately dismissing it is the behaviour people disable extensions
    // over.
    remember(this.options.key);
    if (this.root) this.root.hidden = true;
    if (running === this) running = null;
    document.documentElement.classList.remove("ww-tour-active");
    if (this._onKey) document.removeEventListener("keydown", this._onKey);
    if (this._onMove) {
      global.removeEventListener("resize", this._onMove);
      global.removeEventListener("scroll", this._onMove, true);
    }
    this._onKey = this._onMove = null;
  };

  function style(el, box) {
    el.style.top = box.top + "px";
    el.style.left = box.left + "px";
    el.style.width = box.width + "px";
    el.style.height = box.height + "px";
  }

  // ── the public shape ───────────────────────────────────────────

  var WWTour = {
    collect: collect,
    place: place,

    /** Everything declared on this page, whether or not it has been seen. */
    steps: function () {
      return collect(document).filter(function (s) { return isVisible(s.el); });
    },

    available: function () {
      return WWTour.steps().length > 0;
    },

    /** Run it now, regardless of whether it has been seen. */
    start: function (options) {
      var steps = WWTour.steps();
      if (!steps.length) return false;
      return new Tour(steps, options || {}).start();
    },

    /** Run it only if this person has not seen it here before. */
    auto: function (options) {
      var opts = options || {};
      if (hasSeen(opts.key)) return false;
      return WWTour.start(opts);
    },

    /** Forget it was seen, so the next load offers it again. */
    reset: function (key) {
      try {
        global.localStorage.removeItem(key || siteKey());
      } catch (e) { /* nothing stored, nothing to forget */ }
      return true;
    },

    seen: hasSeen,

    /** Whether a tour is showing right now. */
    active: function () { return running !== null; },

    /** Dismiss the running tour, if any. */
    stop: function () {
      if (running) running.stop();
      return true;
    },
  };

  global.WWTour = WWTour;

  // Self-starting, so a page only has to include the script and annotate its
  // elements. Deferred to load rather than DOMContentLoaded: a step pointing
  // at something a stylesheet has not finished positioning gets a rectangle
  // that is about to move.
  function boot() {
    if (document.documentElement.hasAttribute("data-tour-manual")) return;
    WWTour.auto();
  }
  if (document.readyState === "complete") setTimeout(boot, 250);
  else global.addEventListener("load", function () { setTimeout(boot, 250); });
})(typeof window !== "undefined" ? window : this);
