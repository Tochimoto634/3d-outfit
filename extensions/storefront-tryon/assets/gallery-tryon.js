/**
 * Inject a final 「3D試着」 slide into Helio / Horizon-style product media galleries.
 * Falls back to Dawn-like lists and a gallery-adjacent chip when needed.
 */
(function () {
  "use strict";

  var MARK = "data-outfit-gallery-injected";
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
    return root || null;
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

  function wireCompactUi(root) {
    var openBtn = root.querySelector("[data-tryon-open-form]");
    var dialog = root.querySelector("[data-tryon-dialog]");
    if (openBtn && dialog && typeof dialog.showModal === "function") {
      openBtn.addEventListener("click", function () {
        dialog.showModal();
      });
    }

    root.addEventListener("outfit:tryon:ready", function () {
      if (dialog && dialog.open) dialog.close();
      var panel = root.querySelector("[data-tryon-form-panel]");
      if (panel) panel.open = false;
    });
  }

  function mountRoot(cfg) {
    var root = cloneTryOnRoot(cfg);
    if (!root) return null;
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
