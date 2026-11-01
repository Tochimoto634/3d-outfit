/**
 * 3D OUTFIT storefront try-on viewer (Theme App Extension).
 * MakeHuman/MPFB CC0 body GLB (scaled by height/weight/gender) + garment
 * GLB or cloth proxy + 360° turntable. Capsule fallback if GLB missing.
 */
(function () {
  "use strict";

  /** Vendored ESM bundle (preferred — theme editor CSP / no bare "three" import). */
  var THREE_VERSION = "0.170.0";
  var CDN_THREE_CANDIDATES = [
    "https://cdn.jsdelivr.net/npm/three@" + THREE_VERSION + "/build/three.module.min.js",
    "https://unpkg.com/three@" + THREE_VERSION + "/build/three.module.min.js",
    "https://esm.sh/three@" + THREE_VERSION,
  ];
  var CDN_ORBIT_CANDIDATES = [
    "https://cdn.jsdelivr.net/npm/three@" +
      THREE_VERSION +
      "/examples/jsm/controls/OrbitControls.js",
    "https://unpkg.com/three@" +
      THREE_VERSION +
      "/examples/jsm/controls/OrbitControls.js",
    "https://esm.sh/three@" + THREE_VERSION + "/examples/jsm/controls/OrbitControls",
  ];
  var CDN_GLTF_CANDIDATES = [
    "https://cdn.jsdelivr.net/npm/three@" +
      THREE_VERSION +
      "/examples/jsm/loaders/GLTFLoader.js",
    "https://unpkg.com/three@" +
      THREE_VERSION +
      "/examples/jsm/loaders/GLTFLoader.js",
    "https://esm.sh/three@" + THREE_VERSION + "/examples/jsm/loaders/GLTFLoader",
  ];

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /** Mirror of app/lib/mannequin.ts for offline / proxy-less rebuild. */
  function buildProportions(input) {
    var heightCm = clamp(Number(input.heightCm) || 170, 120, 220);
    var weightKg = clamp(Number(input.weightKg) || 60, 30, 200);
    var gender = input.gender || "unspecified";
    var heightM = heightCm / 100;
    var bmi = weightKg / (heightM * heightM);
    var bmiFactor = clamp(Math.sqrt(bmi / 22), 0.75, 1.45);
    var overallScale = heightCm / 170;
    var shoulderBias = 1;
    var hipBias = 1;
    var chestBias = 1;
    if (gender === "male") {
      shoulderBias = 1.08;
      hipBias = 0.96;
      chestBias = 1.04;
    } else if (gender === "female") {
      shoulderBias = 0.94;
      hipBias = 1.08;
      chestBias = 1.02;
    }
    function circScale(cm, fallback) {
      var value = cm != null && isFinite(cm) && cm > 0 ? cm : fallback;
      return clamp(value / 90, 0.65, 1.55);
    }
    var defaultChest = 90 * bmiFactor * chestBias;
    var defaultWaist = 74 * bmiFactor;
    var defaultHip = 94 * bmiFactor * hipBias;
    var chestScale = circScale(input.bustCm, defaultChest) * shoulderBias;
    return {
      heightM: heightM,
      overallScale: overallScale,
      shoulderScale: chestScale * (gender === "male" ? 1.05 : 0.98),
      chestScale: chestScale,
      waistScale: circScale(input.waistCm, defaultWaist),
      hipScale: circScale(input.hipCm, defaultHip),
      limbThickness: clamp(bmiFactor * 0.95, 0.7, 1.35),
      torsoLength: 0.34 * overallScale,
      legLength: 0.48 * overallScale,
      bmi: Math.round(bmi * 10) / 10,
      gender: gender,
    };
  }

  function formValues(form) {
    var fd = new FormData(form);
    function num(name) {
      var v = fd.get(name);
      if (v == null || String(v).trim() === "") return null;
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    return {
      heightCm: num("heightCm"),
      weightKg: num("weightKg"),
      gender: String(fd.get("gender") || ""),
      bustCm: num("bustCm"),
      waistCm: num("waistCm"),
      hipCm: num("hipCm"),
    };
  }

  function validate(body) {
    if (body.heightCm == null || body.heightCm < 120 || body.heightCm > 220) {
      return "身長は 120〜220 cm で入力してください。";
    }
    if (body.weightKg == null || body.weightKg < 30 || body.weightKg > 200) {
      return "体重は 30〜200 kg で入力してください。";
    }
    if (!body.gender) {
      return "性別を選択してください。";
    }
    return null;
  }

  function createViewer(THREE, OrbitControls, GLTFLoader, root) {
    var canvas = root.querySelector("[data-tryon-canvas]");
    var wrap = root.querySelector("[data-tryon-canvas-wrap]");
    var overlay = root.querySelector("[data-tryon-overlay]");
    var statusEl = root.querySelector("[data-tryon-status]");
    var limitationsEl = root.querySelector("[data-tryon-limitations]");
    var garmentColor = root.getAttribute("data-garment-color") || "#3d5a80";

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
    // Auto-fit: product-only ~75% of shorter axis; body (±garment) ~50%.
    var FIT_FILL_PRODUCT = 0.75;
    var FIT_FILL_BODY = 0.5;
    camera.position.set(0, 1.1, 2.8);

    var controls = new OrbitControls(camera, canvas);
    // Instant stop on release — no post-drag inertia/coasting.
    controls.enableDamping = false;
    controls.dampingFactor = 0;
    controls.target.set(0, 1.1, 0);
    controls.autoRotate = false;
    controls.enablePan = false;
    // No wheel / pinch zoom — yaw drag only.
    controls.enableZoom = false;
    controls.minDistance = 0.6;
    controls.maxDistance = 8;
    // Yaw / horizontal 360 only — lock polar angle at front-fixed height.
    controls.update();
    var lockedPolar = controls.getPolarAngle();
    controls.minPolarAngle = lockedPolar;
    controls.maxPolarAngle = lockedPolar;

    // Belt-and-suspenders: block wheel zoom gestures on the canvas.
    canvas.addEventListener(
      "wheel",
      function (ev) {
        ev.preventDefault();
      },
      { passive: false },
    );

    function setOrbitEnabled(enabled) {
      controls.enabled = !!enabled;
    }
    // Body-settings drawer open → freeze orbit so fields stay focusable.
    // Canvas drag stays available whenever the drawer is closed.
    root.addEventListener("outfit:tryon:drawer", function (ev) {
      var open = !!(ev && ev.detail && ev.detail.open);
      setOrbitEnabled(!open);
    });
    if (root.classList.contains("is-drawer-open")) {
      setOrbitEnabled(false);
    } else {
      setOrbitEnabled(true);
    }
    root.__outfitTryOnOrbit = {
      getYaw: function () {
        return controls.getAzimuthalAngle();
      },
      getPolar: function () {
        return controls.getPolarAngle();
      },
      getDistance: function () {
        return controls.getDistance();
      },
      setEnabled: setOrbitEnabled,
      isEnabled: function () {
        return !!controls.enabled;
      },
      zoomEnabled: function () {
        return !!controls.enableZoom;
      },
    };

    function lockOrbitHeight() {
      controls.update();
      lockedPolar = controls.getPolarAngle();
      controls.minPolarAngle = lockedPolar;
      controls.maxPolarAngle = lockedPolar;
    }

    // SSENSE-like seamless studio: near-white (not grey #f2f2f2), soft even
    // light, minimal contact shadow only (no beige stage disc / warm fill).
    var studioBg = 0xfafafa;
    scene.background = new THREE.Color(studioBg);
    renderer.setClearColor(studioBg, 1);

    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    var key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(0.35, 5.2, 2.4);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.32);
    fill.position.set(-2.8, 2.2, -0.6);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.18);
    rim.position.set(0.2, 2.5, -3.2);
    scene.add(rim);

    var shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    var sctx = shadowCanvas.getContext("2d");
    var grad = sctx.createRadialGradient(128, 128, 8, 128, 128, 124);
    grad.addColorStop(0, "rgba(0,0,0,0.16)");
    grad.addColorStop(0.35, "rgba(0,0,0,0.06)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 256, 256);
    var shadowTex = new THREE.CanvasTexture(shadowCanvas);
    shadowTex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
    var contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 1.05),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.001;

    var turntable = new THREE.Group();
    scene.add(turntable);
    turntable.add(contactShadow);
    var mannequinGroup = new THREE.Group();
    var garmentGroup = new THREE.Group();
    turntable.add(mannequinGroup);
    turntable.add(garmentGroup);

    var bodyBtn = root.querySelector('[data-tryon-layer="body"]');
    var productBtn = root.querySelector('[data-tryon-layer="product"]');

    function syncLayerButtons() {
      if (bodyBtn) {
        var bodyOn = !!mannequinGroup.visible;
        bodyBtn.classList.toggle("is-active", bodyOn);
        bodyBtn.setAttribute("aria-pressed", bodyOn ? "true" : "false");
      }
      if (productBtn) {
        var productOn = !!garmentGroup.visible;
        productBtn.classList.toggle("is-active", productOn);
        productBtn.setAttribute("aria-pressed", productOn ? "true" : "false");
      }
    }

    function setLayerVisible(layer, visible) {
      if (layer === "body") mannequinGroup.visible = !!visible;
      if (layer === "product") garmentGroup.visible = !!visible;
      syncLayerButtons();
      fitVisibleContent();
    }

    function wireLayerToggles() {
      if (!bodyBtn && !productBtn) return;
      function onToggle(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var btn = ev.currentTarget;
        var layer = btn.getAttribute("data-tryon-layer");
        if (layer === "body") setLayerVisible("body", !mannequinGroup.visible);
        if (layer === "product") setLayerVisible("product", !garmentGroup.visible);
      }
      if (bodyBtn) bodyBtn.addEventListener("click", onToggle);
      if (productBtn) productBtn.addEventListener("click", onToggle);
    }
    wireLayerToggles();

    var skinMat = new THREE.MeshStandardMaterial({
      color: 0xc9a48a,
      roughness: 0.72,
      metalness: 0.02,
    });
    var jointMat = new THREE.MeshStandardMaterial({
      color: 0xb89278,
      roughness: 0.85,
    });

    var bodyGlbCache = Object.create(null);
    var bodyLoadToken = 0;
    // Cache-bust + version marker for live verification.
    var OUTFIT_BODY_ASSET_V = "16";
    // jsDelivr only as last resort (Shopify CSP often blocks it → was
    // causing silent capsule fallback on live Helio).
    var BODY_CDN_MALE =
      "https://cdn.jsdelivr.net/gh/Tochimoto634/3d-outfit@33ae5df/public/tryon/bodies/body-male.glb";
    var BODY_CDN_FEMALE =
      "https://cdn.jsdelivr.net/gh/Tochimoto634/3d-outfit@33ae5df/public/tryon/bodies/body-female.glb";
    var bodyDataReady = null;
    // FORCE: never rebuild procedural capsules when MakeHuman assets exist.
    var ALLOW_CAPSULE_FALLBACK = false;

    function tryOnScriptBaseUrl() {
      var nodes = document.querySelectorAll("script[src]");
      for (var i = 0; i < nodes.length; i++) {
        var src = nodes[i].getAttribute("src") || "";
        if (/try-on\.js(\?|$)/.test(src)) {
          return src.replace(/try-on\.js(\?.*)?$/, "");
        }
      }
      return "";
    }

    function withCacheBust(url) {
      if (!url) return url;
      if (/[?&]v=/.test(url)) return url;
      return url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + OUTFIT_BODY_ASSET_V;
    }

    function loadScriptOnce(url, marker) {
      return new Promise(function (resolve) {
        if (!url) {
          resolve(false);
          return;
        }
        url = withCacheBust(url);
        if (marker && typeof window !== "undefined" && window[marker]) {
          resolve(true);
          return;
        }
        var existing = document.querySelector(
          'script[data-outfit-body-src="' + url + '"]',
        );
        if (existing) {
          if (marker && window[marker]) {
            resolve(true);
            return;
          }
          existing.addEventListener("load", function () {
            resolve(!!(marker ? window[marker] : true));
          });
          existing.addEventListener("error", function () {
            resolve(false);
          });
          return;
        }
        var s = document.createElement("script");
        s.src = url;
        s.async = false;
        s.setAttribute("data-outfit-body-src", url);
        s.onload = function () {
          resolve(!!(marker ? window[marker] : true));
        };
        s.onerror = function () {
          resolve(false);
        };
        document.head.appendChild(s);
      });
    }

    /**
     * Load body-*-data.js from (1) embed config (2) page script tags
     * (3) sibling of try-on.js on Shopify extension CDN — CSP-safe.
     */
    function ensureBodyDataScripts() {
      if (bodyDataReady) return bodyDataReady;
      bodyDataReady = Promise.resolve().then(function () {
        if (
          typeof window !== "undefined" &&
          window.__OutfitBodyMaleGlb &&
          window.__OutfitBodyFemaleGlb
        ) {
          return true;
        }
        var cfgUrls = root.__outfitBodyDataUrls || {};
        var maleSrc =
          cfgUrls.male ||
          root.getAttribute("data-body-male-data") ||
          "";
        var femaleSrc =
          cfgUrls.female ||
          root.getAttribute("data-body-female-data") ||
          "";
        var nodes = document.querySelectorAll("script[src]");
        for (var i = 0; i < nodes.length; i++) {
          var src = nodes[i].getAttribute("src") || "";
          if (!maleSrc && /body-male-data\.js/.test(src)) maleSrc = src;
          if (!femaleSrc && /body-female-data\.js/.test(src)) femaleSrc = src;
        }
        // Sibling of this try-on.js on cdn.shopify.com/extensions/...
        var base = tryOnScriptBaseUrl();
        if (base) {
          if (!maleSrc) maleSrc = base + "body-male-data.js";
          if (!femaleSrc) femaleSrc = base + "body-female-data.js";
        }
        return Promise.all([
          loadScriptOnce(maleSrc, "__OutfitBodyMaleGlb"),
          loadScriptOnce(femaleSrc, "__OutfitBodyFemaleGlb"),
        ]).then(function (results) {
          var ok = !!(
            typeof window !== "undefined" &&
            (window.__OutfitBodyMaleGlb || window.__OutfitBodyFemaleGlb)
          );
          try {
            console.info("[outfit-tryon] body-data scripts", {
              maleSrc: maleSrc,
              femaleSrc: femaleSrc,
              loaded: results,
              hasMale: !!window.__OutfitBodyMaleGlb,
              hasFemale: !!window.__OutfitBodyFemaleGlb,
              v: OUTFIT_BODY_ASSET_V,
            });
          } catch (err) {
            /* ignore */
          }
          return ok;
        });
      });
      return bodyDataReady;
    }

    function bodyUrlForGender(gender) {
      // Prefer Shopify-hosted data URLs (CSP-safe). External CDN last.
      var maleEmbedded =
        typeof window !== "undefined" && window.__OutfitBodyMaleGlb
          ? window.__OutfitBodyMaleGlb
          : "";
      var femaleEmbedded =
        typeof window !== "undefined" && window.__OutfitBodyFemaleGlb
          ? window.__OutfitBodyFemaleGlb
          : "";
      var male =
        maleEmbedded ||
        root.getAttribute("data-body-male") ||
        (root.__outfitBodyUrls && root.__outfitBodyUrls.male) ||
        BODY_CDN_MALE;
      var female =
        femaleEmbedded ||
        root.getAttribute("data-body-female") ||
        (root.__outfitBodyUrls && root.__outfitBodyUrls.female) ||
        BODY_CDN_FEMALE;
      if (gender === "female") return female || male;
      return male || female;
    }

    function clearMannequin() {
      while (mannequinGroup.children.length) {
        var child = mannequinGroup.children.pop();
        child.traverse(function (obj) {
          if (obj.geometry) obj.geometry.dispose();
        });
      }
      mannequinGroup.position.set(0, 0, 0);
      mannequinGroup.scale.set(1, 1, 1);
      mannequinGroup.rotation.set(0, 0, 0);
    }

    function limb(radius, length, mat) {
      return new THREE.Mesh(
        new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10),
        mat || skinMat,
      );
    }

    /** Capsule fallback when MakeHuman GLB is unavailable. */
    function rebuildCapsuleMannequin(p) {
      clearMannequin();
      var s = p.overallScale;
      var torsoH = p.torsoLength;
      var legH = p.legLength;
      var chestR = 0.14 * p.chestScale;
      var waistR = 0.11 * p.waistScale;
      var hipR = 0.13 * p.hipScale;
      var shoulderW = 0.28 * p.shoulderScale;
      var limbR = 0.045 * p.limbThickness;

      var hips = new THREE.Mesh(new THREE.SphereGeometry(hipR, 20, 16), skinMat);
      hips.position.y = legH;
      hips.scale.set(1.15, 0.7, 0.85);
      mannequinGroup.add(hips);

      var torso = limb((chestR + waistR) / 2, torsoH, skinMat);
      torso.position.y = legH + torsoH * 0.55;
      torso.scale.set(1.05, 1, 0.85);
      mannequinGroup.add(torso);

      var chest = new THREE.Mesh(new THREE.SphereGeometry(chestR * 0.95, 18, 14), skinMat);
      chest.position.y = legH + torsoH * 0.75;
      chest.scale.set(1.2, 0.7, 0.75);
      mannequinGroup.add(chest);

      var head = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 20, 16), skinMat);
      head.position.y = legH + torsoH + 0.16 * s;
      mannequinGroup.add(head);
      var neck = limb(0.04 * s, 0.08 * s, jointMat);
      neck.position.y = legH + torsoH + 0.04 * s;
      mannequinGroup.add(neck);

      [-1, 1].forEach(function (side) {
        var shoulder = new THREE.Mesh(
          new THREE.SphereGeometry(0.055 * p.shoulderScale, 12, 10),
          jointMat,
        );
        shoulder.position.set(side * shoulderW * 0.55, legH + torsoH * 0.85, 0);
        mannequinGroup.add(shoulder);
        var upper = limb(limbR, 0.28 * s);
        upper.position.set(side * (shoulderW * 0.55 + 0.02), legH + torsoH * 0.55, 0);
        upper.rotation.z = side * 0.12;
        mannequinGroup.add(upper);
        var lower = limb(limbR * 0.9, 0.26 * s);
        lower.position.set(side * (shoulderW * 0.6 + 0.04), legH + torsoH * 0.22, 0.02);
        lower.rotation.z = side * 0.05;
        mannequinGroup.add(lower);
      });

      [-1, 1].forEach(function (side) {
        var thigh = limb(limbR * 1.15, legH * 0.52);
        thigh.position.set(side * hipR * 0.55, legH * 0.72, 0);
        mannequinGroup.add(thigh);
        var calf = limb(limbR * 0.95, legH * 0.48);
        calf.position.set(side * hipR * 0.55, legH * 0.28, 0);
        mannequinGroup.add(calf);
      });
    }

    function loadBodyGltf(url) {
      if (bodyGlbCache[url]) return Promise.resolve(bodyGlbCache[url]);
      return new Promise(function (resolve, reject) {
        var loader = new GLTFLoader();
        loader.load(
          url,
          function (gltf) {
            bodyGlbCache[url] = gltf;
            resolve(gltf);
          },
          undefined,
          reject,
        );
      });
    }

    /**
     * Bake MakeHuman bind-pose into static meshes (no runtime skinning) and
     * scale by height / BMI / gender biases.
     */
    function mountMakeHumanBody(gltf, p) {
      clearMannequin();
      var baked = new THREE.Group();
      var src = gltf.scene;
      src.updateMatrixWorld(true);
      src.traverse(function (obj) {
        if (!obj.isMesh || !obj.geometry) return;
        var geom = obj.geometry.clone();
        geom.applyMatrix4(obj.matrixWorld);
        if (geom.attributes.normal) geom.computeVertexNormals();
        var mesh = new THREE.Mesh(geom, skinMat);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        baked.add(mesh);
      });
      if (!baked.children.length) {
        throw new Error("empty body glb");
      }
      mannequinGroup.add(baked);
      mannequinGroup.updateMatrixWorld(true);

      var box = new THREE.Box3().setFromObject(mannequinGroup);
      var size = new THREE.Vector3();
      box.getSize(size);
      var baseH = Math.max(size.y, 0.01);
      var heightScale = (p.heightM || 1.7) / baseH;
      var widthScale = clamp(p.limbThickness || 1, 0.78, 1.38);
      if (p.gender === "male") widthScale *= 1.04;
      else if (p.gender === "female") widthScale *= 0.98;
      // Soft shoulder/hip: slightly wider X for male, Z for female hips feel.
      var sx = heightScale * widthScale * (p.gender === "female" ? 0.97 : 1.03);
      var sy = heightScale;
      var sz = heightScale * widthScale * (p.gender === "female" ? 1.04 : 0.98);
      mannequinGroup.scale.set(sx, sy, sz);
      mannequinGroup.updateMatrixWorld(true);

      box.setFromObject(mannequinGroup);
      var center = new THREE.Vector3();
      box.getCenter(center);
      mannequinGroup.position.x -= center.x;
      mannequinGroup.position.z -= center.z;
      mannequinGroup.position.y -= box.min.y;
    }

    function rebuildMannequin(p) {
      var token = ++bodyLoadToken;
      function finish(source, detail) {
        root.__outfitBodySource = source;
        root.__outfitBodyDetail = detail || null;
        try {
          root.setAttribute("data-body-source", source);
          root.setAttribute("data-outfit-body-v", OUTFIT_BODY_ASSET_V);
        } catch (err) {
          /* ignore */
        }
        fitVisibleContent();
        try {
          console.info("[outfit-tryon] body source =", source, detail || "");
        } catch (err2) {
          /* ignore */
        }
        return { source: source, detail: detail || null };
      }
      return ensureBodyDataScripts()
        .catch(function () {
          return false;
        })
        .then(function () {
          var url = bodyUrlForGender(p.gender);
          if (!url) {
            clearMannequin();
            return finish(
              "error-no-url",
              "MakeHuman body URL missing (v" + OUTFIT_BODY_ASSET_V + ")",
            );
          }
          var triedCdn = false;
          function tryLoad(u, label) {
            return loadBodyGltf(u).then(function (gltf) {
              if (token !== bodyLoadToken) return { source: "stale" };
              mountMakeHumanBody(gltf, p);
              return finish(label, u.slice(0, 64));
            });
          }
          return tryLoad(
            url,
            String(url).indexOf("data:") === 0 ? "makehuman" : "makehuman-cdn",
          ).catch(function (err1) {
            var cdn =
              p.gender === "female" ? BODY_CDN_FEMALE : BODY_CDN_MALE;
            if (!cdn || cdn === url) throw err1;
            triedCdn = true;
            return tryLoad(cdn, "makehuman-cdn");
          }).catch(function (err2) {
            if (token !== bodyLoadToken) return { source: "stale" };
            clearMannequin();
            if (ALLOW_CAPSULE_FALLBACK) {
              rebuildCapsuleMannequin(p);
              return finish("capsule-fallback", String(err2 && err2.message));
            }
            // FORCE: never show capsules on live — empty + error status.
            return finish(
              "error-load",
              "MakeHuman load failed (v" +
                OUTFIT_BODY_ASSET_V +
                "; cdnTried=" +
                triedCdn +
                "): " +
                String((err2 && err2.message) || err2),
            );
          });
        });
    }

    /**
     * Auto-frame visible meshes:
     * - product-only → ~75% of the shorter viewport axis
     * - body alone / body+garment → ~50% (upper-body-ish crop)
     */
    function fitVisibleContent() {
      turntable.updateMatrixWorld(true);
      var box = new THREE.Box3();
      var has = false;
      if (mannequinGroup.visible && mannequinGroup.children.length) {
        box.expandByObject(mannequinGroup);
        has = true;
      }
      if (garmentGroup.visible && garmentGroup.children.length) {
        box.expandByObject(garmentGroup);
        has = true;
      }
      if (!has || box.isEmpty()) return;

      var size = new THREE.Vector3();
      var center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      if (!(size.x > 0) || !(size.y > 0)) return;

      var bodyOn = mannequinGroup.visible && mannequinGroup.children.length > 0;
      var rawX = size.x;
      var rawY = size.y;

      // Body modes: look slightly upper-body, but distance uses FULL visible
      // AABB so fill % matches what the user actually sees.
      var targetY = bodyOn ? box.min.y + size.y * 0.62 : center.y;

      var vFov = (camera.fov * Math.PI) / 180;
      var aspect = Math.max(camera.aspect || 1, 0.01);
      var hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      var shortFov = aspect >= 1 ? vFov : hFov;
      var fill = bodyOn ? FIT_FILL_BODY : FIT_FILL_PRODUCT;

      var dist;
      if (!bodyOn) {
        // Product-only: fit-inside on shorter axis at ~75% (sleeves shortened
        // so AABB matches the visible garment).
        var distH = rawY / (2 * fill * Math.tan(shortFov / 2));
        var distW = rawX / (2 * fill * Math.tan(shortFov / 2));
        dist = Math.max(distH, distW);
      } else {
        var distHBody = rawY / (2 * fill * Math.tan(shortFov / 2));
        var distWBody = rawX / (2 * fill * Math.tan(shortFov / 2));
        dist = Math.max(distHBody, distWBody);
      }
      dist = Math.max(dist, 0.55);

      var yaw = controls.getAzimuthalAngle();
      controls.target.set(center.x, targetY, center.z);
      camera.position.set(
        center.x + Math.sin(yaw) * dist,
        targetY,
        center.z + Math.cos(yaw) * dist,
      );
      lockOrbitHeight();
    }

    function clearGarment() {
      while (garmentGroup.children.length) {
        var g = garmentGroup.children.pop();
        g.traverse(function (obj) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(function (m) {
                m.dispose && m.dispose();
              });
            } else if (obj.material.dispose) {
              obj.material.dispose();
            }
          }
        });
      }
    }

    /** Cloth / garment anchors from live body bbox (MakeHuman) or capsule props. */
    function garmentLayout(p) {
      if (mannequinGroup.children.length) {
        mannequinGroup.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(mannequinGroup);
        var size = new THREE.Vector3();
        box.getSize(size);
        var h = Math.max(size.y, 0.01);
        var minY = box.min.y;
        return {
          bodyH: h,
          hipY: minY + h * 0.52,
          waistY: minY + h * 0.58,
          chestY: minY + h * 0.72,
          neckY: minY + h * 0.82,
          shirtH: h * 0.28,
          shoulderW: Math.max(size.x * 0.22, 0.16),
          chestR: Math.max(size.x * 0.12, 0.12) * (p.chestScale || 1) * 0.55,
          waistR: Math.max(size.x * 0.1, 0.1) * (p.waistScale || 1) * 0.5,
          sleeveLen: h * 0.09,
          collarR: h * 0.045,
        };
      }
      var s = p.overallScale || 1;
      var torsoH = p.torsoLength || 0.34 * s;
      var legH = p.legLength || 0.48 * s;
      return {
        bodyH: torsoH + legH,
        hipY: legH,
        waistY: legH + torsoH * 0.2,
        chestY: legH + torsoH * 0.72,
        neckY: legH + torsoH * 0.95,
        shirtH: torsoH * 0.95,
        shoulderW: 0.2 * (p.shoulderScale || 1),
        chestR: 0.155 * (p.chestScale || 1),
        waistR: 0.13 * (p.waistScale || 1),
        sleeveLen: 0.14 * s,
        collarR: 0.08 * s,
      };
    }

    function addClothProxy(p) {
      clearGarment();
      var color = new THREE.Color(garmentColor);
      var clothMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      var L = garmentLayout(p);
      var shirt = new THREE.Mesh(
        new THREE.CylinderGeometry(
          L.chestR * 1.05,
          L.waistR,
          L.shirtH,
          28,
          1,
          true,
        ),
        clothMat,
      );
      shirt.position.y = (L.waistY + L.chestY) / 2;
      garmentGroup.add(shirt);

      [-1, 1].forEach(function (side) {
        var sleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.045 * (p.limbThickness || 1),
            0.04 * (p.limbThickness || 1),
            L.sleeveLen,
            12,
          ),
          clothMat,
        );
        sleeve.position.set(side * L.shoulderW, L.chestY, 0);
        sleeve.rotation.z = side * (Math.PI / 2.35);
        garmentGroup.add(sleeve);
      });

      var collar = new THREE.Mesh(
        new THREE.TorusGeometry(L.collarR, L.collarR * 0.18, 8, 20),
        clothMat,
      );
      collar.position.y = L.neckY;
      collar.rotation.x = Math.PI / 2;
      garmentGroup.add(collar);
    }

    function fitLoadedModel(rootObj, p) {
      var box = new THREE.Box3().setFromObject(rootObj);
      var size = new THREE.Vector3();
      box.getSize(size);
      var L = garmentLayout(p);
      var targetH = Math.max(L.shirtH * 1.05, 0.2);
      var scale = size.y > 0.001 ? targetH / size.y : 1;
      rootObj.scale.setScalar(scale);
      rootObj.updateMatrixWorld(true);
      box.setFromObject(rootObj);
      var center = new THREE.Vector3();
      box.getCenter(center);
      rootObj.position.x -= center.x;
      rootObj.position.z -= center.z;
      rootObj.position.y += L.chestY - center.y;
    }

    function loadGarmentGlb(url, p) {
      clearGarment();
      return new Promise(function (resolve) {
        var loader = new GLTFLoader();
        loader.load(
          url,
          function (gltf) {
            var model = gltf.scene || gltf.scenes[0];
            fitLoadedModel(model, p);
            garmentGroup.add(model);
            resolve({ ok: true, placeholder: false });
          },
          undefined,
          function () {
            addClothProxy(p);
            resolve({ ok: false, placeholder: true });
          },
        );
      });
    }

    function resize() {
      var w = wrap.clientWidth;
      var h = wrap.clientHeight;
      // Hidden slideshow slides can report 0 — fall back to parent / square.
      if (!w || !h) {
        var host =
          root.closest("slideshow-slide") ||
          root.closest(".outfit-gallery-tryon__shell") ||
          root.parentElement;
        if (host) {
          w = w || host.clientWidth;
          h = h || host.clientHeight;
        }
      }
      if (!w || !h) {
        w = w || 320;
        h = h || w;
      }
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }

    function resizeWhenVisible() {
      resize();
      requestAnimationFrame(function () {
        resize();
      });
    }

    var raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }

    resize();
    animate();
    window.addEventListener("resize", resizeWhenVisible);

    if (typeof ResizeObserver !== "undefined" && wrap) {
      try {
        var ro = new ResizeObserver(function () {
          resizeWhenVisible();
        });
        ro.observe(wrap);
      } catch (err) {
        /* ignore */
      }
    }

    var slideEl = root.closest("slideshow-slide");
    if (slideEl && typeof MutationObserver !== "undefined") {
      try {
        new MutationObserver(function () {
          if (slideEl.getAttribute("aria-hidden") !== "true") {
            resizeWhenVisible();
          }
        }).observe(slideEl, {
          attributes: true,
          attributeFilter: ["aria-hidden", "class"],
        });
      } catch (err2) {
        /* ignore */
      }
    }

    return {
      setStatus: function (text) {
        if (statusEl) statusEl.textContent = text || "";
      },
      setLimitations: function (items) {
        if (!limitationsEl || !items || !items.length) return;
        limitationsEl.innerHTML = items
          .map(function (t) {
            return "<li>" + String(t).replace(/</g, "&lt;") + "</li>";
          })
          .join("");
      },
      hideOverlay: function () {
        if (overlay) overlay.hidden = true;
      },
      getYaw: function () {
        return controls.getAzimuthalAngle();
      },
      setOrbitEnabled: setOrbitEnabled,
      applyTryOn: async function (body, asset) {
        var p = body.mannequin || buildProportions(body);
        this.setStatus("人体モデルを読み込み中…");
        var bodyResult = await rebuildMannequin(p);
        // After create: both body + product available and visible.
        mannequinGroup.visible = true;
        garmentGroup.visible = true;
        syncLayerButtons();
        this.hideOverlay();
        resizeWhenVisible();
        if (
          bodyResult &&
          bodyResult.source &&
          String(bodyResult.source).indexOf("error") === 0
        ) {
          this.setStatus(
            "人体モデルの読み込みに失敗しました（v16）。" +
              (bodyResult.detail ? " " + bodyResult.detail : ""),
          );
        }
        if (asset && asset.storageUrl) {
          this.setStatus("服 3D を読み込み中…");
          var loaded = await loadGarmentGlb(asset.storageUrl, p);
          this.setStatus(
            loaded.placeholder
              ? "GLB の読み込みに失敗したため布プロキシを表示しています。"
              : "生成アセットを表示中（ドラッグで360°）。",
          );
        } else {
          addClothProxy(p);
          var bodyNote =
            bodyResult &&
            bodyResult.source &&
            String(bodyResult.source).indexOf("makehuman") === 0
              ? "MakeHuman系人体 + "
              : bodyResult &&
                  bodyResult.source &&
                  String(bodyResult.source).indexOf("error") === 0
                ? "人体未読込 + "
                : "";
          this.setStatus(
            bodyNote +
              "布プロキシで試着プレビューしています（TRELLIS 未接続）。",
          );
        }
        resizeWhenVisible();
        fitVisibleContent();
      },
      /**
       * Gallery idle: product only (no body) until the user creates a mannequin.
       */
      showProductOnlyPreview: function () {
        var p = buildProportions({
          heightCm: 170,
          weightKg: 60,
          gender: "unspecified",
        });
        clearMannequin();
        addClothProxy(p);
        mannequinGroup.visible = false;
        garmentGroup.visible = true;
        syncLayerButtons();
        this.hideOverlay();
        resizeWhenVisible();
        fitVisibleContent();
        this.setStatus("商品プレビュー（人体モデルは設定から作成）");
      },
      setLayerVisible: setLayerVisible,
      syncLayerButtons: syncLayerButtons,
      fitVisibleContent: fitVisibleContent,
      resize: function () {
        resizeWhenVisible();
        fitVisibleContent();
      },
      dispose: function () {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resizeWhenVisible);
        controls.dispose();
        renderer.dispose();
        try {
          delete root.__outfitTryOnOrbit;
        } catch (err) {
          root.__outfitTryOnOrbit = null;
        }
      },
    };
  }

  function fetchWithTimeout(url, options, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    var opts = Object.assign({}, options || {});
    if (ctrl) opts.signal = ctrl.signal;
    var pending = fetch(url, opts);
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        try {
          if (ctrl) ctrl.abort();
        } catch (err) {
          /* ignore */
        }
        reject(new Error("timeout"));
      }, ms);
    });
    return Promise.race([pending, timeout]).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  async function fetchTryOn(root, body) {
    var shop = root.getAttribute("data-shop") || "";
    var productId = root.getAttribute("data-product-id") || "";
    var apiBase = (root.getAttribute("data-api-base") || "").replace(/\/$/, "");
    var proxyPath = root.getAttribute("data-proxy-path") || "/apps/3d-outfit/tryon";

    var payload = Object.assign(
      {
        shop: shop,
        product_id: productId,
        productId: productId,
      },
      body,
    );

    var endpoints = [];
    if (apiBase) {
      endpoints.push(
        apiBase +
          "/api/storefront/tryon?shop=" +
          encodeURIComponent(shop) +
          "&product_id=" +
          encodeURIComponent(productId),
      );
    }
    // App proxy can redirect-loop on misconfigured hosts — keep it last + timed.
    endpoints.push(proxyPath);

    var lastError = null;
    for (var i = 0; i < endpoints.length; i++) {
      try {
        var res = await fetchWithTimeout(
          endpoints[i],
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
            credentials:
              String(endpoints[i]).indexOf("http") === 0
                ? "omit"
                : "same-origin",
            // Avoid password-wall redirect loops hanging the create button.
            redirect: "manual",
          },
          5000,
        );
        if (!res.ok) {
          lastError = "API エラー (" + res.status + ")";
          continue;
        }
        var data = await res.json();
        if (data && data.tryOn) return data.tryOn;
        lastError = data && data.error ? data.error : "応答形式が不正です。";
      } catch (err) {
        lastError =
          err && err.message === "timeout"
            ? "API タイムアウト"
            : "通信に失敗しました。";
      }
    }

    // Offline / proxy-down path — still build mannequin locally
    return {
      asset: null,
      limitations: [
        "API に接続できませんでした（" +
          (lastError || "不明") +
          "）。ローカル体型プレビューのみ表示します。",
        "TRELLIS 実生成は未接続です。",
      ],
      mannequin: buildProportions(body),
      _offline: true,
    };
  }

  function normalizeLibs(mod) {
    if (!mod) return null;
    var THREE = mod.THREE || mod;
    var OrbitControls = mod.OrbitControls || (mod.default && mod.default.OrbitControls);
    var GLTFLoader = mod.GLTFLoader || (mod.default && mod.default.GLTFLoader);
    if (THREE && THREE.Scene && OrbitControls && GLTFLoader) {
      return { THREE: THREE, OrbitControls: OrbitControls, GLTFLoader: GLTFLoader };
    }
    return null;
  }

  function injectThreeImportMap(threeUrl) {
    if (typeof threeUrl !== "string" || !threeUrl) return;
    if (document.querySelector('script[data-outfit-three-importmap]')) return;
    // Import maps must exist before dependent modules resolve bare "three".
    var script = document.createElement("script");
    script.type = "importmap";
    script.setAttribute("data-outfit-three-importmap", "1");
    script.textContent = JSON.stringify({ imports: { three: threeUrl } });
    var first = document.head.firstChild;
    if (first) document.head.insertBefore(script, first);
    else document.head.appendChild(script);
  }

  async function importModule(url) {
    return import(/* webpackIgnore: true */ url);
  }

  async function loadFromBundleUrl(url) {
    if (!url) return null;
    try {
      var mod = await importModule(url);
      return normalizeLibs(mod);
    } catch (err) {
      return null;
    }
  }

  async function loadFromCdnPair(threeUrl, orbitUrl, gltfUrl) {
    injectThreeImportMap(threeUrl);
    var THREE = await importModule(threeUrl);
    var orbitMod = await importModule(orbitUrl);
    var gltfMod = await importModule(gltfUrl);
    return normalizeLibs({
      THREE: THREE,
      OrbitControls: orbitMod.OrbitControls,
      GLTFLoader: gltfMod.GLTFLoader,
    });
  }

  /**
   * Resolve Three.js for storefront + theme editor preview.
   * 1) Extension asset bundle (Shopify CDN — CSP-safe)
   * 2) CDN fallbacks with importmap for bare "three" (OrbitControls / GLTFLoader)
   */
  async function ensureThree(roots) {
    var bundleUrl = "";
    if (roots && roots.length) {
      bundleUrl = roots[0].getAttribute("data-three-bundle") || "";
    }
    var local = await loadFromBundleUrl(bundleUrl);
    if (local) return local;

    var lastError = null;
    for (var i = 0; i < CDN_THREE_CANDIDATES.length; i++) {
      try {
        var libs = await loadFromCdnPair(
          CDN_THREE_CANDIDATES[i],
          CDN_ORBIT_CANDIDATES[i],
          CDN_GLTF_CANDIDATES[i],
        );
        if (libs) return libs;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("three_load_failed");
  }

  function bindRoot(root, libs) {
    if (root.__outfitTryOnBound) return;
    root.__outfitTryOnBound = true;

    var form = root.querySelector("[data-tryon-form]");
    var errorEl = root.querySelector("[data-tryon-error]");
    var submitBtn = root.querySelector("[data-tryon-submit]");
    var viewer = createViewer(
      libs.THREE,
      libs.OrbitControls,
      libs.GLTFLoader,
      root,
    );

    async function createPreview() {
      if (!form) return;
      var body = formValues(form);
      var err = validate(body);
      if (errorEl) {
        errorEl.hidden = !err;
        errorEl.textContent = err || "";
      }
      if (err) {
        // Keep drawer open so the user sees validation errors.
        root.dispatchEvent(
          new CustomEvent("outfit:tryon:drawer", {
            bubbles: true,
            detail: { open: true },
          }),
        );
        var drawer = root.querySelector("[data-tryon-drawer]");
        if (drawer) {
          drawer.hidden = false;
          root.classList.add("is-drawer-open");
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "作成中…";
      }
      viewer.setStatus("体型を計算しています…");

      try {
        // Local-first: always show mannequin+cloth immediately so a hanging
        // app-proxy / CORS failure cannot leave an empty viewer.
        var localMannequin = buildProportions(body);
        await viewer.applyTryOn(
          Object.assign({}, body, { mannequin: localMannequin }),
          null,
        );
        root.dispatchEvent(
          new CustomEvent("outfit:tryon:ready", { bubbles: true }),
        );
        viewer.setStatus(
          "ローカル体型プレビューを表示中。アセットを確認しています…",
        );

        var tryOn = await fetchTryOn(root, body);
        if (tryOn && tryOn.limitations) {
          viewer.setLimitations(tryOn.limitations);
        }
        if (tryOn && tryOn.asset && tryOn.asset.storageUrl) {
          await viewer.applyTryOn(
            Object.assign({}, body, {
              mannequin: tryOn.mannequin || localMannequin,
            }),
            tryOn.asset,
          );
        } else if (tryOn && tryOn._offline) {
          viewer.setStatus(
            (root.__outfitBodySource &&
            String(root.__outfitBodySource).indexOf("makehuman") === 0
              ? "MakeHuman系人体 + "
              : "") +
              "API 未接続のため布プロキシで試着プレビューしています。",
          );
        } else {
          viewer.setStatus(
            (root.__outfitBodySource &&
            String(root.__outfitBodySource).indexOf("makehuman") === 0
              ? "MakeHuman系人体 + "
              : "") +
              "実 GLB が無いため布プロキシで試着プレビューしています。",
          );
        }
      } catch (e) {
        // Last resort: still attempt a local mannequin.
        try {
          await viewer.applyTryOn(body, null);
          root.dispatchEvent(
            new CustomEvent("outfit:tryon:ready", { bubbles: true }),
          );
        } catch (e2) {
          if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = "試着プレビューの生成に失敗しました。";
          }
          viewer.setStatus("試着プレビューの生成に失敗しました。");
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "マネキンを作成して試着";
        }
        if (viewer.resize) viewer.resize();
      }
    }

    root.__outfitTryOnCreate = createPreview;
    root.__outfitTryOnViewer = viewer;

    // Gallery: show product-only before mannequin create.
    if (
      root.hasAttribute("data-outfit-gallery-slide") &&
      viewer.showProductOnlyPreview
    ) {
      viewer.showProductOnlyPreview();
    }

    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        createPreview();
      });
    }

    if (root.__outfitTryOnPendingCreate) {
      root.__outfitTryOnPendingCreate = false;
      createPreview();
    }
  }

  var libsPromise = null;

  async function boot() {
    var roots = document.querySelectorAll("[data-outfit-tryon]");
    if (!roots.length) return;
    try {
      if (!libsPromise) libsPromise = ensureThree(roots);
      var libs = await libsPromise;
      roots.forEach(function (root) {
        bindRoot(root, libs);
      });
    } catch (e) {
      libsPromise = null;
      roots.forEach(function (root) {
        var statusEl = root.querySelector("[data-tryon-status]");
        if (statusEl) {
          statusEl.textContent =
            "3D ライブラリの読み込みに失敗しました。テーマアセット（try-on-three.bundle.js）または CDN を確認してください。";
        }
      });
    }
  }

  window.OutfitTryOn = {
    boot: boot,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Theme editor section reload + gallery slide injection
  document.addEventListener("shopify:section:load", boot);
  document.addEventListener("outfit:tryon:boot", boot);
})();
