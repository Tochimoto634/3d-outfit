/**
 * 3D OUTFIT storefront try-on viewer (Theme App Extension).
 * Parametric mannequin + garment GLB or cloth proxy + 360° turntable.
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
    camera.position.set(0, 1.1, 3.2);

    var controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.target.set(0, 0.95, 0);
    controls.autoRotate = false;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 6;
    // Yaw / horizontal 360 only — lock polar angle at front-fixed height.
    controls.update();
    var lockedPolar = controls.getPolarAngle();
    controls.minPolarAngle = lockedPolar;
    controls.maxPolarAngle = lockedPolar;

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
      setEnabled: setOrbitEnabled,
      isEnabled: function () {
        return !!controls.enabled;
      },
    };

    function lockOrbitHeight() {
      controls.update();
      lockedPolar = controls.getPolarAngle();
      controls.minPolarAngle = lockedPolar;
      controls.maxPolarAngle = lockedPolar;
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    var key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(2.5, 4, 2);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xfff2e0, 0.45);
    fill.position.set(-2, 1.5, -1);
    scene.add(fill);

    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 48),
      new THREE.MeshStandardMaterial({
        color: 0xcfc6b8,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    var turntable = new THREE.Group();
    scene.add(turntable);
    var mannequinGroup = new THREE.Group();
    var garmentGroup = new THREE.Group();
    turntable.add(mannequinGroup);
    turntable.add(garmentGroup);

    var skinMat = new THREE.MeshStandardMaterial({
      color: 0xd4b39a,
      roughness: 0.85,
      metalness: 0.02,
    });
    var jointMat = new THREE.MeshStandardMaterial({
      color: 0xc4a48c,
      roughness: 0.9,
    });

    function limb(radius, length, mat) {
      var mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10),
        mat || skinMat,
      );
      return mesh;
    }

    function rebuildMannequin(p) {
      while (mannequinGroup.children.length) {
        var child = mannequinGroup.children.pop();
        if (child.geometry) child.geometry.dispose();
      }

      var s = p.overallScale;
      var torsoH = p.torsoLength;
      var legH = p.legLength;
      var chestR = 0.14 * p.chestScale;
      var waistR = 0.11 * p.waistScale;
      var hipR = 0.13 * p.hipScale;
      var shoulderW = 0.28 * p.shoulderScale;
      var limbR = 0.045 * p.limbThickness;

      // hips
      var hips = new THREE.Mesh(
        new THREE.SphereGeometry(hipR, 20, 16),
        skinMat,
      );
      hips.position.y = legH;
      hips.scale.set(1.15, 0.7, 0.85);
      mannequinGroup.add(hips);

      // torso (lathe-like via scaled capsule)
      var torso = limb((chestR + waistR) / 2, torsoH, skinMat);
      torso.position.y = legH + torsoH * 0.55;
      torso.scale.set(1.05, 1, 0.85);
      mannequinGroup.add(torso);

      // chest plate for bust emphasis
      var chest = new THREE.Mesh(
        new THREE.SphereGeometry(chestR * 0.95, 18, 14),
        skinMat,
      );
      chest.position.y = legH + torsoH * 0.75;
      chest.scale.set(1.2, 0.7, 0.75);
      mannequinGroup.add(chest);

      // head
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 20, 16), skinMat);
      head.position.y = legH + torsoH + 0.16 * s;
      mannequinGroup.add(head);
      var neck = limb(0.04 * s, 0.08 * s, jointMat);
      neck.position.y = legH + torsoH + 0.04 * s;
      mannequinGroup.add(neck);

      // shoulders / arms
      [-1, 1].forEach(function (side) {
        var shoulder = new THREE.Mesh(
          new THREE.SphereGeometry(0.055 * p.shoulderScale, 12, 10),
          jointMat,
        );
        shoulder.position.set(side * shoulderW * 0.55, legH + torsoH * 0.85, 0);
        mannequinGroup.add(shoulder);

        var upper = limb(limbR, 0.28 * s);
        upper.position.set(
          side * (shoulderW * 0.55 + 0.02),
          legH + torsoH * 0.55,
          0,
        );
        upper.rotation.z = side * 0.12;
        mannequinGroup.add(upper);

        var lower = limb(limbR * 0.9, 0.26 * s);
        lower.position.set(
          side * (shoulderW * 0.6 + 0.04),
          legH + torsoH * 0.22,
          0.02,
        );
        lower.rotation.z = side * 0.05;
        mannequinGroup.add(lower);
      });

      // legs
      [-1, 1].forEach(function (side) {
        var thigh = limb(limbR * 1.15, legH * 0.52);
        thigh.position.set(side * hipR * 0.55, legH * 0.72, 0);
        mannequinGroup.add(thigh);
        var calf = limb(limbR * 0.95, legH * 0.48);
        calf.position.set(side * hipR * 0.55, legH * 0.28, 0);
        mannequinGroup.add(calf);
      });

      controls.target.set(0, (legH + torsoH) * 0.55, 0);
      camera.position.set(0, (legH + torsoH) * 0.65, 2.4 + s);
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

    function addClothProxy(p) {
      clearGarment();
      var color = new THREE.Color(garmentColor);
      var clothMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      var s = p.overallScale;
      var torsoH = p.torsoLength;
      var legH = p.legLength;
      var chestR = 0.155 * p.chestScale;
      var shirt = new THREE.Mesh(
        new THREE.CylinderGeometry(
          chestR * 1.05,
          0.13 * p.waistScale,
          torsoH * 0.95,
          28,
          1,
          true,
        ),
        clothMat,
      );
      shirt.position.y = legH + torsoH * 0.5;
      garmentGroup.add(shirt);

      // simple sleeves
      [-1, 1].forEach(function (side) {
        var sleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06 * p.limbThickness, 0.05 * p.limbThickness, 0.22 * s, 12),
          clothMat,
        );
        sleeve.position.set(side * 0.22 * p.shoulderScale, legH + torsoH * 0.72, 0);
        sleeve.rotation.z = side * (Math.PI / 2.4);
        garmentGroup.add(sleeve);
      });

      // collar ring
      var collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.08 * s, 0.015 * s, 8, 20),
        clothMat,
      );
      collar.position.y = legH + torsoH * 0.95;
      collar.rotation.x = Math.PI / 2;
      garmentGroup.add(collar);
    }

    function fitLoadedModel(rootObj, p) {
      var box = new THREE.Box3().setFromObject(rootObj);
      var size = new THREE.Vector3();
      box.getSize(size);
      var targetH = (p.torsoLength + p.legLength) * 0.95;
      var scale = size.y > 0.001 ? targetH / size.y : 1;
      rootObj.scale.setScalar(scale);
      box.setFromObject(rootObj);
      var center = new THREE.Vector3();
      box.getCenter(center);
      rootObj.position.x -= center.x;
      rootObj.position.z -= center.z;
      rootObj.position.y -= box.min.y;
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
      var w = wrap.clientWidth || 320;
      var h = wrap.clientHeight || 320;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }

    var raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }

    resize();
    animate();
    window.addEventListener("resize", resize);

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
        rebuildMannequin(p);
        this.hideOverlay();
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
          this.setStatus(
            "実 GLB が無いため布プロキシで試着プレビューしています（TRELLIS 未接続）。",
          );
        }
        resize();
      },
      dispose: function () {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
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
    endpoints.push(proxyPath);

    var lastError = null;
    for (var i = 0; i < endpoints.length; i++) {
      try {
        var res = await fetch(endpoints[i], {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
          credentials: apiBase ? "omit" : "same-origin",
        });
        if (!res.ok) {
          lastError = "API エラー (" + res.status + ")";
          continue;
        }
        var data = await res.json();
        if (data && data.tryOn) return data.tryOn;
        lastError = data && data.error ? data.error : "応答形式が不正です。";
      } catch (err) {
        lastError = "通信に失敗しました。";
      }
    }

    // Offline demo path — still build mannequin locally
    return {
      asset: null,
      limitations: [
        "API に接続できませんでした（" + (lastError || "不明") + "）。ローカル体型プレビューのみ表示します。",
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

    if (form) {
      form.addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var body = formValues(form);
        var err = validate(body);
        if (errorEl) {
          errorEl.hidden = !err;
          errorEl.textContent = err || "";
        }
        if (err) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "作成中…";
        }
        viewer.setStatus("体型を計算し、アセットを取得しています…");

        try {
          var tryOn = await fetchTryOn(root, body);
          viewer.setLimitations(tryOn.limitations || []);
          await viewer.applyTryOn(
            Object.assign({}, body, { mannequin: tryOn.mannequin }),
            tryOn.asset,
          );
          root.dispatchEvent(
            new CustomEvent("outfit:tryon:ready", { bubbles: true }),
          );
        } catch (e) {
          if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = "試着プレビューの生成に失敗しました。";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "マネキンを作成して試着";
          }
        }
      });
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
