/**
 * Inject a final 「3D試着」 slide into Helio / Horizon-style product media galleries.
 * Falls back to Dawn-like lists and a gallery-adjacent chip when needed.
 */
(function () {
  "use strict";

  var MARK = "data-outfit-gallery-injected";
  // Eager-load MakeHuman body data (Shopify CDN siblings / config).
  (function preloadBodyData() {
    function add(url) {
      if (!url || document.querySelector('script[data-outfit-body-src="' + url + '"]')) return;
      var s = document.createElement("script");
      s.src = url.indexOf("v=") >= 0 ? url : url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=16mh";
      s.async = true;
      s.setAttribute("data-outfit-body-src", s.src);
      document.head.appendChild(s);
    }
    try {
      var cfgNode = document.querySelector("[data-outfit-gallery-config]");
      if (cfgNode) {
        var cfg = JSON.parse(cfgNode.textContent || "{}");
        if (cfg.bodyMaleData) add(cfg.bodyMaleData);
        if (cfg.bodyFemaleData) add(cfg.bodyFemaleData);
      }
    } catch (e) {}
    var nodes = document.querySelectorAll("script[src]");
    for (var i = 0; i < nodes.length; i++) {
      var src = nodes[i].getAttribute("src") || "";
      if (/try-on\.js/.test(src)) {
        var base = src.replace(/try-on\.js.*/, "");
        add(base + "body-male-data.js");
        add(base + "body-female-data.js");
        break;
      }
    }
  })();

  var SLIDE_ID = "outfit-3d-tryon";
  var bootTimer = 0;

  function parseConfig(node) {
    try {
      var data = JSON.parse(node.textContent || "{}");
      return data && typeof data === "object" ? data : null;
    } catch (err) {
      return null;
    }
  }

  function getActiveConfig() {
    var nodes = document.querySelectorAll("[data-outfit-gallery-config]");
    for (var i = 0; i < nodes.length; i++) {
      var cfg = parseConfig(nodes[i]);
      if (cfg && cfg.enabled !== false) return { cfg: cfg, node: nodes[i] };
    }
    return null;
  }

  function getTemplate(blockId) {
    return (
      document.getElementById("OutfitGalleryTryOnTemplate-" + blockId) ||
      document.querySelector("[data-outfit-gallery-template]")
    );
  }

  function cloneTryOnRoot(cfg) {
    var tpl = getTemplate(cfg.blockId);
    if (!tpl || !tpl.content) return null;
    var frag = tpl.content.cloneNode(true);
    var root = frag.querySelector("[data-outfit-tryon]");
    if (!root) return null;
    if (cfg.bodyMale) root.setAttribute("data-body-male", cfg.bodyMale);
    if (cfg.bodyFemale) root.setAttribute("data-body-female", cfg.bodyFemale);
    if (cfg.bodyMaleData) {
      root.setAttribute("data-body-male-data", cfg.bodyMaleData);
    }
    if (cfg.bodyFemaleData) {
      root.setAttribute("data-body-female-data", cfg.bodyFemaleData);
    }
    if (cfg.threeBundle) root.setAttribute("data-three-bundle", cfg.threeBundle);
    root.__outfitBodyUrls = {
      male: cfg.bodyMale || root.getAttribute("data-body-male") || "",
      female: cfg.bodyFemale || root.getAttribute("data-body-female") || "",
    };
    root.__outfitBodyDataUrls = {
      male: cfg.bodyMaleData || root.getAttribute("data-body-male-data") || "",
      female:
        cfg.bodyFemaleData || root.getAttribute("data-body-female-data") || "",
    };
    return root;
  }

  function makeThumbLabel(heading) {
    var wrap = document.createElement("span");
    wrap.className = "outfit-gallery-tryon__thumb-label";
    wrap.textContent = heading || "3D試着";
    return wrap;
  }

  function appendHelioCarouselSlide(gallery, root, cfg) {
    var slidesHost =
      gallery.querySelector("slideshow-slides") ||
      gallery.querySelector("[ref='scroller']");
    if (!slidesHost) return false;

    if (slidesHost.querySelector("[" + MARK + "]")) return true;

    var index = slidesHost.querySelectorAll("slideshow-slide").length;
    var slide = document.createElement("slideshow-slide");
    slide.setAttribute("ref", "slides[]");
    slide.setAttribute("aria-hidden", "true");
    slide.setAttribute("slide-id", SLIDE_ID);
    slide.setAttribute(MARK, "1");
    slide.className =
      "product-media-container product-media-container--outfit-tryon outfit-gallery-tryon__slide";
    slide.style.setProperty("--slideshow-timeline", "--slide-" + index);
    slide.style.setProperty("--product-media-fit", "contain");

    var shell = document.createElement("div");
    shell.className = "outfit-gallery-tryon__shell product-media";
    shell.appendChild(root);
    slide.appendChild(shell);
    slidesHost.appendChild(slide);

    gallery
      .querySelectorAll(".product-media-gallery__slideshow--single-media, .slideshow--single-media")
      .forEach(function (el) {
        el.classList.remove(
          "product-media-gallery__slideshow--single-media",
          "slideshow--single-media",
        );
      });

    injectHelioControls(gallery, index, cfg.heading || "3D試着");
    return true;
  }

  function injectHelioControls(gallery, index, heading) {
    gallery.querySelectorAll("slideshow-controls").forEach(function (controls) {
      if (controls.querySelector("[" + MARK + "]")) return;

      var thumbs = controls.querySelector(".slideshow-controls__thumbnails");
      if (thumbs) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "slideshow-control button button-unstyled slideshow-controls__thumbnail outfit-gallery-tryon__thumb";
        btn.setAttribute("aria-label", heading);
        btn.setAttribute("on:click", "/select/" + index);
        btn.setAttribute("ref", "thumbnails[]");
        btn.setAttribute(MARK, "1");
        btn.style.setProperty("--aspect-ratio", "1");
        btn.appendChild(makeThumbLabel(heading));
        thumbs.appendChild(btn);
      }

      var dots = controls.querySelector(".slideshow-controls__dots");
      if (dots) {
        var li = document.createElement("li");
        li.setAttribute(MARK, "1");
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className =
          "slideshow-control button button-unstyled outfit-gallery-tryon__dot";
        dot.setAttribute("aria-label", heading);
        dot.setAttribute("on:click", "/select/" + index);
        dot.setAttribute("ref", "dots[]");
        dot.setAttribute(MARK, "1");
        dot.style.setProperty("animation-timeline", "--slide-" + index);
        // Helio default controls are dots (not thumbnails) — label the last one.
        dot.textContent = heading || "3D試着";
        li.appendChild(dot);
        dots.appendChild(li);
      }

      var counter = controls.querySelector(".slideshow-controls__counter");
      if (counter) {
        var slash = counter.querySelector(".slash");
        if (slash && slash.nextSibling) {
          slash.nextSibling.textContent = String(index + 1);
        } else if (slash) {
          counter.appendChild(document.createTextNode(String(index + 1)));
        }
      }
    });
  }

  function appendHelioGridItem(gallery, root, cfg) {
    var grid = gallery.querySelector(".media-gallery__grid");
    if (!grid) return false;
    if (grid.querySelector("[" + MARK + "]")) return true;

    var li = document.createElement("li");
    li.setAttribute("ref", "media[]");
    li.setAttribute(MARK, "1");
    li.className =
      "product-media-container product-media-container--outfit-tryon outfit-gallery-tryon__grid-item";
    li.style.setProperty("--media-preview-ratio", "1");
    var shell = document.createElement("div");
    shell.className = "outfit-gallery-tryon__shell product-media";
    shell.appendChild(root);
    li.appendChild(shell);
    grid.appendChild(li);
    return true;
  }

  function appendDawnLikeSlide(gallery, root, cfg) {
    var list =
      gallery.querySelector("ul[role='list']") ||
      gallery.querySelector(".product__media-list") ||
      gallery.querySelector(".product-media-list");
    if (!list) return false;
    if (list.querySelector("[" + MARK + "]")) return true;

    var li = document.createElement("li");
    li.className = "product__media-item outfit-gallery-tryon__dawn-item";
    li.setAttribute(MARK, "1");
    li.setAttribute("data-media-id", SLIDE_ID);
    var shell = document.createElement("div");
    shell.className = "product-media-container outfit-gallery-tryon__shell";
    shell.appendChild(root);
    li.appendChild(shell);
    list.appendChild(li);

    var thumbs =
      document.querySelector(".thumbnail-list") ||
      gallery.querySelector(".thumbnail-list");
    if (thumbs && !thumbs.querySelector("[" + MARK + "]")) {
      var t = document.createElement("li");
      t.className = "thumbnail-list__item outfit-gallery-tryon__thumb-item";
      t.setAttribute(MARK, "1");
      var tb = document.createElement("button");
      tb.type = "button";
      tb.className = "thumbnail outfit-gallery-tryon__thumb";
      tb.appendChild(makeThumbLabel(cfg.heading || "3D試着"));
      tb.addEventListener("click", function () {
        li.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      t.appendChild(tb);
      thumbs.appendChild(t);
    }
    return true;
  }

  function appendAdjacentFallback(gallery, root, cfg) {
    if (gallery.parentElement && gallery.parentElement.querySelector("[" + MARK + "='adjacent']")) {
      return true;
    }
    var wrap = document.createElement("div");
    wrap.className = "outfit-gallery-tryon__adjacent";
    wrap.setAttribute(MARK, "adjacent");
    var title = document.createElement("h3");
    title.className = "outfit-gallery-tryon__adjacent-title";
    title.textContent = cfg.heading || "3D試着";
    wrap.appendChild(title);
    wrap.appendChild(root);
    gallery.insertAdjacentElement("afterend", wrap);
    return true;
  }

  function setDrawerOpen(root, open) {
    var drawer = root.querySelector("[data-tryon-drawer]");
    var toggle = root.querySelector("[data-tryon-drawer-toggle]");
    if (!drawer) return;
    if (open) {
      drawer.hidden = false;
      root.classList.add("is-drawer-open");
    } else {
      drawer.hidden = true;
      root.classList.remove("is-drawer-open");
    }
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    root.dispatchEvent(
      new CustomEvent("outfit:tryon:drawer", {
        bubbles: true,
        detail: { open: !!open },
      }),
    );
  }

  function isDrawerChrome(target) {
    return !!(
      target &&
      target.closest &&
      target.closest(
        "[data-tryon-drawer], [data-tryon-drawer-toggle], [data-tryon-layer-toggles], [data-outfit-interactive]",
      )
    );
  }

  /**
   * Helio slideshow.js attaches mousedown on the scroller (bubble) and calls
   * preventDefault unless target.closest('model-viewer') — that cancels focus
   * on height/weight/gender controls. Bubble stopPropagation lets the field
   * receive the event, then keeps the slideshow from seeing it.
   */
  function shieldInteractive(el) {
    if (!el || el.__outfitTryOnShielded) return;
    el.__outfitTryOnShielded = true;
    var types = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "touchstart",
      "touchend",
      "click",
      "dblclick",
      "wheel",
      "contextmenu",
      "keydown",
      "keyup",
      "keypress",
    ];
    types.forEach(function (type) {
      el.addEventListener(type, function (ev) {
        ev.stopPropagation();
      });
    });
    // Rescue focus if another ancestor still canceling mousedown.
    el.addEventListener("pointerup", function (ev) {
      var field =
        ev.target &&
        ev.target.closest &&
        ev.target.closest("input, select, textarea");
      if (field && document.activeElement !== field) {
        try {
          field.focus();
        } catch (err) {
          /* ignore */
        }
      }
    });
  }

  /**
   * Keep OrbitControls yaw drag on the canvas. Helio's #handleMouseDown will
   * otherwise preventDefault + setPointerCapture on pointermove and steal the
   * gesture for slide scrolling. Stop bubble only for canvas hits — never for
   * drawer chrome (form shield handles those).
   */
  function shieldOrbitCanvas(root) {
    var wrap = root.querySelector("[data-tryon-canvas-wrap]");
    if (!wrap || wrap.__outfitTryOnOrbitShielded) return;
    wrap.__outfitTryOnOrbitShielded = true;
    wrap.setAttribute("data-tryon-orbit-host", "");

    ["pointerdown", "mousedown", "touchstart", "wheel"].forEach(function (type) {
      wrap.addEventListener(type, function (ev) {
        if (isDrawerChrome(ev.target)) return;
        // Canvas / empty stage only — let OrbitControls keep the pointer.
        ev.stopPropagation();
      });
    });
  }

  function wireCompactUi(root) {
    var toggle = root.querySelector("[data-tryon-drawer-toggle]");
    var closeBtn = root.querySelector("[data-tryon-drawer-close]");
    var drawer = root.querySelector("[data-tryon-drawer]");
    var layers = root.querySelector("[data-tryon-layer-toggles]");

    shieldInteractive(toggle);
    shieldInteractive(drawer);
    shieldInteractive(layers);
    shieldOrbitCanvas(root);

    if (toggle && drawer) {
      toggle.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setDrawerOpen(root, drawer.hidden);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setDrawerOpen(root, false);
      });
    }

    root.addEventListener("outfit:tryon:ready", function () {
      setDrawerOpen(root, false);
    });
  }

  /**
   * Prevent native form navigation before Three.js bindRoot attaches.
   * Queues create if the viewer is not ready yet.
   */
  function wireFormSubmitGuard(root) {
    var form = root.querySelector("[data-tryon-form]");
    if (!form || form.__outfitTryOnSubmitGuarded) return;
    form.__outfitTryOnSubmitGuarded = true;
    form.addEventListener(
      "submit",
      function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof root.__outfitTryOnCreate === "function") {
          root.__outfitTryOnCreate();
          return;
        }
        root.__outfitTryOnPendingCreate = true;
        var status = root.querySelector("[data-tryon-status]");
        if (status) status.textContent = "3D ビューアを準備しています…";
        requestTryOnBoot();
      },
      true,
    );
  }

  function mountRoot(cfg) {
    var root = cloneTryOnRoot(cfg);
    if (!root) return null;
    wireFormSubmitGuard(root);
    wireCompactUi(root);
    return root;
  }

  function alreadyInjected(gallery) {
    return (
      gallery.hasAttribute(MARK) ||
      !!gallery.querySelector("[" + MARK + "]") ||
      !!(
        gallery.parentElement &&
        gallery.parentElement.querySelector("[" + MARK + "='adjacent']")
      )
    );
  }

  function mountIntoGallery(gallery, cfg) {
    if (alreadyInjected(gallery)) return true;

    var presentation = gallery.getAttribute("data-presentation") || "";
    var hasSlideshow = !!gallery.querySelector("slideshow-slides");
    var hasGrid = !!gallery.querySelector(".media-gallery__grid");
    var mounted = false;

    // Helio grid: mobile uses slideshow, desktop uses grid — inject both.
    if (presentation === "grid" && hasGrid) {
      var gridRoot = mountRoot(cfg);
      if (gridRoot && appendHelioGridItem(gallery, gridRoot, cfg)) mounted = true;
      if (hasSlideshow) {
        var slideRoot = mountRoot(cfg);
        if (slideRoot && appendHelioCarouselSlide(gallery, slideRoot, cfg)) mounted = true;
      }
    } else if (hasSlideshow) {
      var carouselRoot = mountRoot(cfg);
      if (carouselRoot && appendHelioCarouselSlide(gallery, carouselRoot, cfg)) {
        mounted = true;
      }
    } else if (hasGrid) {
      var onlyGridRoot = mountRoot(cfg);
      if (onlyGridRoot && appendHelioGridItem(gallery, onlyGridRoot, cfg)) {
        mounted = true;
      }
    }

    if (!mounted) {
      var dawnRoot = mountRoot(cfg);
      if (dawnRoot && appendDawnLikeSlide(gallery, dawnRoot, cfg)) mounted = true;
    }

    if (!mounted) {
      var fallbackRoot = mountRoot(cfg);
      if (fallbackRoot) {
        appendAdjacentFallback(gallery, fallbackRoot, cfg);
        mounted = true;
      }
    }

    if (mounted) gallery.setAttribute(MARK, "done");
    return mounted;
  }

  function findGalleries() {
    var list = [];
    document.querySelectorAll("media-gallery").forEach(function (el) {
      // Prefer product section galleries; skip product-card galleries.
      if (el.closest("product-card, .product-card")) return;
      list.push(el);
    });
    if (list.length) return list;

    document
      .querySelectorAll(
        "media-gallery, .product-media-gallery, .product__media-wrapper, [data-product-media-gallery]",
      )
      .forEach(function (el) {
        if (el.closest("product-card, .product-card")) return;
        list.push(el);
      });
    return list;
  }

  function requestTryOnBoot() {
    if (window.OutfitTryOn && typeof window.OutfitTryOn.boot === "function") {
      window.OutfitTryOn.boot();
      return;
    }
    document.dispatchEvent(new CustomEvent("outfit:tryon:boot"));
  }

  function injectAll() {
    var active = getActiveConfig();
    if (!active) return;
    var cfg = active.cfg;
    var galleries = findGalleries();
    if (!galleries.length) return;

    var newlyMounted = false;
    galleries.forEach(function (gallery) {
      if (alreadyInjected(gallery)) return;
      if (mountIntoGallery(gallery, cfg)) newlyMounted = true;
    });
    if (newlyMounted) requestTryOnBoot();
  }

  function scheduleInject() {
    clearTimeout(bootTimer);
    bootTimer = setTimeout(injectAll, 40);
  }

  function observe() {
    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "childList") {
          scheduleInject();
          return;
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("shopify:section:load", scheduleInject);
    document.addEventListener("shopify:block:select", scheduleInject);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      injectAll();
      observe();
    });
  } else {
    injectAll();
    observe();
  }
})();
