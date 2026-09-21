(function() {
  const DEFAULT_TILE_LAYER = {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  };

  function getEditModeValue() {
    const params = new URLSearchParams(window.location.search);
    return params.get("hm") || "";
  }

  function getFocusQuery() {
    const params = new URLSearchParams(window.location.search);
    return (params.get("focus") || "").trim();
  }

  function isEditMode(mapId) {
    const editValue = getEditModeValue();
    if (!editValue) {
      return false;
    }

    return !!mapId && editValue === String(mapId);
  }

  function getPreferredMetaValue(meta, key) {
    if (!meta || typeof meta !== "object") {
      return undefined;
    }

    const editKey = `edit${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (meta[editKey] !== undefined) {
      return meta[editKey];
    }

    return meta[key];
  }

  function getActiveTileLayerConfig(meta) {
    const tileLayer = getPreferredMetaValue(meta, "tileLayer");
    return tileLayer !== undefined ? tileLayer : DEFAULT_TILE_LAYER;
  }

  function getActiveZoom(meta, key) {
    const value = getPreferredMetaValue(meta, key);
    return typeof value === "number" ? value : null;
  }

  function getActiveBoolean(meta, key, fallback) {
    const value = getPreferredMetaValue(meta, key);
    return typeof value === "boolean" ? value : fallback;
  }

  function getRoot() {
    if (!window.HMAP_CONFIG || !window.HMAP_CONFIG.root) {
      return "/";
    }

    const root = window.HMAP_CONFIG.root;
    return root.endsWith("/") ? root : root + "/";
  }

  function toSiteUrl(path) {
    return getRoot() + String(path || "").replace(/^\/+/, "");
  }

  async function fetchJson(path) {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }

    return response.json();
  }

  function buildPopupContent(properties, popupFields) {
    if (!properties) return "";

    const fields = Array.isArray(popupFields) && popupFields.length
      ? popupFields
      : Object.keys(properties).filter(function(key) {
          return typeof properties[key] === "string" && properties[key].trim();
        });

    return fields.map(function(field) {
      const value = properties[field];
      if (value == null || value === "") return "";

      if (field === "name") {
        return `<strong>${value}</strong>`;
      }

      return `<div>${value}</div>`;
    }).filter(Boolean).join("");
  }

  function getFeatureSearchValues(properties) {
    if (!properties || typeof properties !== "object") {
      return [];
    }

    const candidates = [
      properties.name,
      properties.title,
      properties.name_en,
      properties.name_zh,
      properties.title_en,
      properties.title_zh,
      properties.alias,
      properties.aliases,
      properties.description_en,
      properties.description_zh
    ];

    return candidates
      .filter(function(value) {
        return typeof value === "string" && value.trim();
      })
      .map(normalizeSearchToken)
      .filter(Boolean);
  }

  function getLayerLatLng(layer) {
    if (!layer) {
      return null;
    }

    if (typeof layer.getLatLng === "function") {
      return layer.getLatLng();
    }

    if (typeof layer.getBounds === "function") {
      return layer.getBounds().getCenter();
    }

    return null;
  }

  function createFocusPopupHtml(featureRecord, lang) {
    if (!featureRecord || !featureRecord.properties) {
      return "";
    }

    const properties = featureRecord.properties;
    const localizedLabel = lang === "zh"
      ? properties.name_zh || properties.title_zh || properties.title || properties.name
      : properties.name_en || properties.title_en || properties.title || properties.name;
    const description = lang === "zh"
      ? properties.description_zh || properties.description_en
      : properties.description_en || properties.description_zh;

    return [
      localizedLabel ? `<strong>${localizedLabel}</strong>` : "",
      description ? `<div>${description}</div>` : ""
    ].filter(Boolean).join("");
  }

  function applyFocusQuery(map, layerEntries, referenceFeatures, activeLangRef) {
    const focusQuery = getFocusQuery();
    if (!focusQuery) {
      return;
    }

    const normalizedQuery = normalizeSearchToken(focusQuery);
    if (!normalizedQuery) {
      return;
    }

    let matchedLayer = null;
    let matchedFeature = null;

    layerEntries.forEach(function(entry) {
      if (matchedLayer || !entry.layer || typeof entry.layer.eachLayer !== "function") {
        return;
      }

      entry.layer.eachLayer(function(layer) {
        if (matchedLayer || !layer || !layer.feature) {
          return;
        }

        const values = getFeatureSearchValues(layer.feature.properties);
        if (values.some(function(value) { return value.indexOf(normalizedQuery) !== -1; })) {
          matchedLayer = layer;
          matchedFeature = { properties: layer.feature.properties || {} };
        }
      });
    });

    if (!matchedLayer && Array.isArray(referenceFeatures)) {
      referenceFeatures.some(function(featureRecord) {
        const values = getFeatureSearchValues(featureRecord.properties);
        if (values.some(function(value) { return value.indexOf(normalizedQuery) !== -1; })) {
          matchedFeature = featureRecord;
          return true;
        }
        return false;
      });
    }

    const latlng = matchedLayer
      ? getLayerLatLng(matchedLayer)
      : matchedFeature && matchedFeature.latlng
        ? L.latLng(matchedFeature.latlng)
        : null;

    if (!latlng) {
      return;
    }

    map.setView(latlng, Math.max(map.getZoom(), 8), { animate: false });

    const focusLayer = L.circleMarker(latlng, {
      radius: 13,
      color: "#5c4121",
      weight: 2,
      fillColor: "#d1a047",
      fillOpacity: 0.28
    }).addTo(map);

    window.setTimeout(function() {
      if (map.hasLayer(focusLayer)) {
        map.removeLayer(focusLayer);
      }
    }, 3200);

    if (matchedLayer && typeof matchedLayer.openPopup === "function") {
      matchedLayer.openPopup();
      return;
    }

    const popupHtml = createFocusPopupHtml(matchedFeature, activeLangRef.value);
    if (popupHtml) {
      L.popup({
        autoClose: true,
        closeButton: true,
        offset: [0, -8]
      }).setLatLng(latlng).setContent(popupHtml).openOn(map);
    }
  }

  function resolveLocalizedValue(configValue, lang, fallback) {
    if (Array.isArray(configValue) || typeof configValue === "string") {
      return configValue;
    }

    if (configValue && typeof configValue === "object") {
      return configValue[lang] || configValue[fallback] || null;
    }

    return null;
  }

  function normalizeLabelValue(value) {
    if (value == null) {
      return "";
    }

    const text = String(value).trim();
    return text;
  }

  function normalizeSearchToken(value) {
    return normalizeLabelValue(value)
      .toLowerCase()
      .replace(/[（）()[\]{}.,;:!?/\\'"`~@#$%^&*+=<>|·\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getFeatureLabelText(properties, layerConfig, lang) {
    const props = properties || {};
    const localizedField = resolveLocalizedValue(layerConfig.labelFields, lang, "en");
    const fallbackLangField = resolveLocalizedValue(layerConfig.labelFields, "en", null);
    const fallbackCandidates = [
      localizedField,
      fallbackLangField,
      layerConfig.labelField,
      "name",
      "title",
      "name_en",
      "name_zh"
    ].filter(Boolean);

    for (let index = 0; index < fallbackCandidates.length; index += 1) {
      const field = fallbackCandidates[index];
      const value = normalizeLabelValue(props[field]);
      if (value) {
        return value;
      }
    }

    return "";
  }

  function createEmptyKeepRules() {
    return {
      coreKeep: new Set(),
      majorKeep: new Set()
    };
  }

  function parseKeepRules(data) {
    const rules = createEmptyKeepRules();
    const tiers = data && typeof data === "object" ? data.tiers : null;
    const coreKeep = tiers && Array.isArray(tiers.core_keep) ? tiers.core_keep : [];
    const majorKeep = tiers && Array.isArray(tiers.major_keep) ? tiers.major_keep : [];

    coreKeep.forEach(function(id) {
      const value = normalizeLabelValue(id);
      if (value) {
        rules.coreKeep.add(value);
      }
    });

    majorKeep.forEach(function(id) {
      const value = normalizeLabelValue(id);
      if (value) {
        rules.majorKeep.add(value);
      }
    });

    return rules;
  }

  function renderAttribution(el, meta) {
    if (!meta || !meta.attributionHtml) {
      return;
    }

    const existing = el.querySelector(".hmap-attribution");
    if (existing) {
      existing.remove();
    }

    const attribution = document.createElement("div");
    attribution.className = "hmap-attribution";
    attribution.innerHTML = meta.attributionHtml;
    el.appendChild(attribution);
  }

  function getViewerToggleMarkup() {
    return '<span class="hmap-viewer-toggle__icon" aria-hidden="true"></span>';
  }

  function formatCoordinate(value) {
    return Number(value).toFixed(6);
  }

  function stopDomEventPropagation(node) {
    if (!node || !L || !L.DomEvent) {
      return;
    }

    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);

    ["dblclick", "contextmenu", "mousedown", "mouseup", "pointerdown", "touchstart"].forEach(function(eventName) {
      L.DomEvent.on(node, eventName, L.DomEvent.stopPropagation);
    });
  }

  function getMapTheme(el) {
    const styles = window.getComputedStyle(el);

    function readVar(name, fallback) {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    }

    return {
      accent: readVar("--hmap-accent", "#d1a047"),
      accentStrong: readVar("--hmap-accent-strong", "#8b673d"),
      accentFill: readVar("--hmap-accent-fill", "#d8c5a4"),
      ink: readVar("--hmap-ink", "#4a3f31")
    };
  }

  function syncViewerTheme(layout) {
    if (!layout || !layout.wrapper || !layout.modal) {
      return;
    }

    const styles = window.getComputedStyle(layout.wrapper);
    [
      "--hmap-accent",
      "--hmap-accent-soft",
      "--hmap-accent-muted",
      "--hmap-accent-hover",
      "--hmap-accent-strong",
      "--hmap-accent-fill",
      "--hmap-accent-glow",
      "--hmap-accent-contrast",
      "--hmap-ink",
      "--hmap-meta",
      "--hmap-filter-width"
    ].forEach(function(name) {
      const value = styles.getPropertyValue(name).trim();
      if (value) {
        layout.modal.style.setProperty(name, value);
      }
    });
  }

  function createEditor(map, el, mapId) {
    if (!isEditMode(mapId)) {
      return null;
    }

    const theme = getMapTheme(el);

    const editor = document.createElement("div");
    editor.className = "hmap-editor";
    editor.innerHTML = [
      '<div class="hmap-editor__bar">',
      '  <div class="hmap-editor__modes">',
      '    <button type="button" data-mode="point" title="Point" aria-label="Point"><span class="hmap-editor__icon hmap-editor__icon--point"></span></button>',
      '    <button type="button" data-mode="line" title="Line" aria-label="Line"><span class="hmap-editor__icon hmap-editor__icon--line"></span></button>',
      '    <button type="button" data-mode="polygon" title="Area" aria-label="Area"><span class="hmap-editor__icon hmap-editor__icon--polygon"></span></button>',
      '  </div>',
      '  <span class="hmap-editor__divider" aria-hidden="true"></span>',
      '  <div class="hmap-editor__tools">',
      '    <button type="button" data-action="undo" title="Undo" aria-label="Undo"><span class="hmap-editor__icon hmap-editor__icon--undo"></span></button>',
      '    <button type="button" data-action="clear" title="Clear" aria-label="Clear"><span class="hmap-editor__icon hmap-editor__icon--clear"></span></button>',
      '  </div>',
      '  <span class="hmap-editor__divider" aria-hidden="true"></span>',
      '  <div class="hmap-editor__tools hmap-editor__tools--output">',
      '    <button type="button" data-action="copy-current" title="Copy current" aria-label="Copy"><span class="hmap-editor__icon hmap-editor__icon--copy"></span></button>',
      '  </div>',
      '  <button type="button" class="hmap-editor__toggle" data-action="toggle-panel" aria-expanded="false" title="Expand toolbar" aria-label="Expand toolbar"><span class="hmap-editor__icon hmap-editor__icon--toggle" aria-hidden="true"></span></button>',
      '</div>',
      '<div class="hmap-editor__feedback" aria-live="polite"></div>'
    ].join("");
    el.appendChild(editor);
    stopDomEventPropagation(editor);

    const modeButtons = Array.from(editor.querySelectorAll("[data-mode]"));
    const toggleButton = editor.querySelector(".hmap-editor__toggle");
    const feedbackEl = editor.querySelector(".hmap-editor__feedback");

    const state = {
      mode: null,
      lastLatLng: null,
      vertices: [],
      cursorLatLng: null,
      completed: false,
      panelOpen: true,
      drawLayer: L.layerGroup().addTo(map),
      feedbackTimer: null
    };

    function syncPanelState() {
      editor.classList.toggle("is-open", state.panelOpen);
      toggleButton.setAttribute("aria-expanded", state.panelOpen ? "true" : "false");
      toggleButton.title = state.panelOpen ? "Collapse toolbar" : "Expand toolbar";
      toggleButton.setAttribute("aria-label", state.panelOpen ? "Collapse toolbar" : "Expand toolbar");
      toggleButton.classList.toggle("is-active", state.panelOpen);
    }

    function toLonLat(latlng) {
      return [Number(formatCoordinate(latlng.lng)), Number(formatCoordinate(latlng.lat))];
    }

    function flashFeedback(text, tone) {
      if (!feedbackEl) {
        return;
      }

      if (state.feedbackTimer) {
        window.clearTimeout(state.feedbackTimer);
      }

      feedbackEl.textContent = text;
      feedbackEl.className = `hmap-editor__feedback is-visible${tone ? ` is-${tone}` : ""}`;

      state.feedbackTimer = window.setTimeout(function() {
        feedbackEl.className = "hmap-editor__feedback";
      }, 1600);
    }

    async function copyText(text, successMessage) {
      try {
        await navigator.clipboard.writeText(text);
        flashFeedback(successMessage || "Copied.", "success");
      } catch (error) {
        console.log(text);
        flashFeedback("Copy failed.", "error");
      }
    }

    function updateModeButtons() {
      modeButtons.forEach(function(button) {
        button.classList.toggle("is-active", !!state.mode && button.dataset.mode === state.mode);
      });
    }

    function clearDrawing() {
      state.lastLatLng = null;
      state.vertices = [];
      state.cursorLatLng = null;
      state.completed = false;
      state.drawLayer.clearLayers();
    }

    function setMode(mode) {
      state.mode = mode;
      clearDrawing();
      updateModeButtons();
    }

    function pointFeature() {
      if (!state.lastLatLng) return null;
      return {
        type: "Feature",
        properties: {
          name_en: "New Place",
          name_zh: "",
          description_en: "",
          description_zh: ""
        },
        geometry: {
          type: "Point",
          coordinates: toLonLat(state.lastLatLng)
        }
      };
    }

    function lineFeature() {
      if (state.vertices.length < 2) return null;
      return {
        type: "Feature",
        properties: {
          name_en: "New Route",
          name_zh: "",
          description_en: "",
          description_zh: ""
        },
        geometry: {
          type: "LineString",
          coordinates: state.vertices.map(toLonLat)
        }
      };
    }

    function polygonFeature() {
      if (state.vertices.length < 3) return null;
      const ring = state.vertices.map(toLonLat);
      const first = ring[0];
      const last = ring[ring.length - 1];

      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }

      return {
        type: "Feature",
        properties: {
          name_en: "New Region",
          name_zh: ""
        },
        geometry: {
          type: "Polygon",
          coordinates: [ring]
        }
      };
    }

    function currentFeature() {
      if (!state.mode) return null;
      if (state.mode === "point") return pointFeature();
      if (state.mode === "line") return lineFeature();
      return polygonFeature();
    }

    function renderDrawing() {
      state.drawLayer.clearLayers();

      if (!state.mode) {
        return;
      }

      if (state.mode === "point") {
        if (state.lastLatLng) {
          L.circleMarker(state.lastLatLng, {
            radius: 4,
            color: theme.ink,
            weight: 1,
            fillColor: theme.accent,
            fillOpacity: 0.95
          }).addTo(state.drawLayer);
        }
        return;
      }

      state.vertices.forEach(function(latlng) {
        L.circleMarker(latlng, {
          radius: 3.5,
          color: theme.ink,
          weight: 1,
          fillColor: theme.accent,
          fillOpacity: 0.95
        }).addTo(state.drawLayer);
      });

      const previewVertices = state.cursorLatLng && !state.completed
        ? state.vertices.concat([state.cursorLatLng])
        : state.vertices.slice();

      if (state.mode === "line" && previewVertices.length >= 2) {
        L.polyline(previewVertices, {
          color: theme.accentStrong,
          weight: 2,
          dashArray: state.cursorLatLng ? "6 5" : null,
          opacity: 0.92
        }).addTo(state.drawLayer);
      }

      if (state.mode === "polygon" && previewVertices.length >= 2) {
        L.polygon(previewVertices, {
          color: theme.accentStrong,
          weight: 1.4,
          dashArray: state.cursorLatLng ? "6 5" : null,
          fillColor: theme.accentFill,
          fillOpacity: previewVertices.length >= 3 ? 0.14 : 0.04
        }).addTo(state.drawLayer);
      }
    }

    function finishDrawing(options) {
      const opts = Object.assign({
        copy: false
      }, options || {});

      const feature = currentFeature();
      if (!feature) {
        flashFeedback("Not enough points.", "error");
        return;
      }

      state.completed = true;
      state.cursorLatLng = null;
      renderDrawing();

      if (opts.copy) {
        copyText(JSON.stringify(feature, null, 2), `${feature.geometry.type} copied to clipboard.`);
      }
    }

    map.on("click", function(event) {
      if (!state.mode) {
        return;
      }

      if (state.mode === "point") {
        state.completed = true;
        state.lastLatLng = event.latlng;
        renderDrawing();
        return;
      }

      if (state.completed) {
        state.vertices = [];
        state.completed = false;
      }

      state.vertices.push(event.latlng);
      renderDrawing();
    });

    map.on("mousemove", function(event) {
      if (!state.mode || state.mode === "point" || state.completed) {
        return;
      }

      state.cursorLatLng = event.latlng;
      renderDrawing();
    });

    map.on("dblclick", function(event) {
      if (state.mode && state.mode !== "point") {
        if (event && event.originalEvent) {
          L.DomEvent.stop(event.originalEvent);
        }
        finishDrawing({ copy: true });
      }
    });

    map.on("contextmenu", function(event) {
      if (state.mode && state.mode !== "point") {
        if (event && event.originalEvent) {
          L.DomEvent.stop(event.originalEvent);
        }
        finishDrawing({ copy: true });
      }
    });

    editor.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();

      const modeButton = event.target.closest("[data-mode]");
      if (modeButton) {
        setMode(state.mode === modeButton.dataset.mode ? null : modeButton.dataset.mode);
        return;
      }

      const button = event.target.closest("[data-action]");
      if (!button) return;

      const action = button.dataset.action;

      if (action === "toggle-panel") {
        state.panelOpen = !state.panelOpen;
        syncPanelState();
        return;
      }

      if (action === "copy-current") {
        const feature = currentFeature();
        if (!feature) {
          flashFeedback("Nothing to copy.", "error");
          return;
        }

        copyText(JSON.stringify(feature, null, 2), `${feature.geometry.type} copied to clipboard.`);
        return;
      }

      if (action === "undo") {
        if (state.mode === "point") {
          state.lastLatLng = null;
        } else {
          state.vertices.pop();
        }
        renderDrawing();
        return;
      }

      if (action === "clear") {
        clearDrawing();
      }
    });

    updateModeButtons();
    syncPanelState();
    renderDrawing();
    return editor;
  }

  function applyFeatureLocale(layer, feature, layerConfig, lang) {
    const properties = feature.properties || {};
    const labelText = getFeatureLabelText(properties, layerConfig, lang);

    if (typeof layer.unbindTooltip === "function") {
      layer.unbindTooltip();
    }

    if (typeof layer.unbindPopup === "function") {
      layer.unbindPopup();
    }

    if (layerConfig.labels !== false && labelText && typeof layer.bindTooltip === "function") {
      const labelOptions = Object.assign({
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "hmap-label"
      }, layerConfig.labelOptions || {});

      layer.bindTooltip(String(labelText), labelOptions);
    }

    const popupFields = resolveLocalizedValue(layerConfig.popupFields, lang, "en");
    const popupContent = buildPopupContent(properties, popupFields);
    if (popupContent && layerConfig.popup !== false) {
      layer.bindPopup(popupContent);
    }
  }

  function createGeoJsonLayer(layerConfig, geojson, lang, theme) {
    const markerOptions = Object.assign({
      radius: 3.5,
      fillColor: theme.accent,
      color: theme.ink,
      weight: 1.25,
      opacity: 1,
      fillOpacity: 1
    }, layerConfig.marker || {});

    return L.geoJSON(geojson, {
      style: function() {
        return layerConfig.style || {};
      },
      pointToLayer: function(feature, latlng) {
        if (layerConfig.kind === "point" || !layerConfig.kind) {
          return L.circleMarker(latlng, markerOptions);
        }

        return L.marker(latlng);
      },
      onEachFeature: function(feature, layer) {
        applyFeatureLocale(layer, feature, layerConfig, lang);
      }
    });
  }

  function isPointFeatureVisible(feature, bounds) {
    if (!feature || !feature.geometry || feature.geometry.type !== "Point") {
      return false;
    }

    const coordinates = feature.geometry.coordinates || [];
    if (coordinates.length < 2) {
      return false;
    }

    return bounds.contains([coordinates[1], coordinates[0]]);
  }

  function normalizeReferenceToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  const REFERENCE_ICON_MAP = {
    settlement: { icon: "city", color: "#767676" },
    "settlement-modern": { icon: "city", color: "#767676" },
    "archaeological-site": { icon: "ruins", color: "#8b6f47" },
    sanctuary: { icon: "sanctuary", color: "#7a3db8" },
    "temple-2": { icon: "temple", color: "#5b4bc4" },
    temple: { icon: "temple", color: "#5b4bc4" },
    theatre: { icon: "theatre", color: "#00897b" },
    theater: { icon: "theatre", color: "#00897b" },
    stadium: { icon: "stadium", color: "#00897b" },
    gymnasium: { icon: "civic", color: "#00897b" },
    agora: { icon: "civic", color: "#00897b" },
    stoa: { icon: "civic", color: "#00897b" },
    fort: { icon: "fort", color: "#6d4c41" },
    fortification: { icon: "fort", color: "#6d4c41" },
    wall: { icon: "fort", color: "#6d4c41" },
    gate: { icon: "gate", color: "#6d4c41" },
    tower: { icon: "tower", color: "#6d4c41" },
    cemetery: { icon: "burial", color: "#455a64" },
    necropolis: { icon: "burial", color: "#455a64" },
    tomb: { icon: "burial", color: "#455a64" },
    island: { icon: "island", color: "#1e88e5" },
    river: { icon: "river", color: "#1e88e5" },
    mountain: { icon: "mountain", color: "#546e7a" },
    hill: { icon: "hill", color: "#546e7a" },
    cave: { icon: "cave", color: "#546e7a" },
    region: { icon: "region", color: "#f9a825" },
    province: { icon: "region", color: "#f9a825" },
    road: { icon: "road", color: "#3949ab" },
    station: { icon: "road", color: "#3949ab" },
    harbor: { icon: "harbor", color: "#039be5" },
    port: { icon: "harbor", color: "#039be5" }
  };

  const REFERENCE_CATEGORY_FALLBACK = {
    settlement: { icon: "city", color: "#767676" },
    sanctuary: { icon: "sanctuary", color: "#7a3db8" },
    temple: { icon: "temple", color: "#5b4bc4" },
    fortification: { icon: "fort", color: "#6d4c41" },
    civic: { icon: "civic", color: "#00897b" },
    burial: { icon: "burial", color: "#455a64" },
    infrastructure: { icon: "road", color: "#3949ab" },
    "natural-feature": { icon: "landscape", color: "#1e88e5" },
    "admin-region": { icon: "region", color: "#f9a825" },
    unknown: { icon: "dot", color: "#757575" }
  };

  function resolveReferenceTypeKey(properties) {
    const placeTypeKey = normalizeReferenceToken(properties.primaryPlaceType);
    const categoryKey = normalizeReferenceToken(properties.category);
    const markerKey = normalizeReferenceToken(properties.marker);

    const aliases = {
      "city-gate": "gate",
      "gate-2": "gate",
      "tower-defensive": "tower",
      "tower-single": "tower",
      "wall-2": "wall",
      "city-wall": "wall",
      "defensive-wall": "wall",
      "fort-2": "fort",
      "church-2": "temple-2",
      church: "temple",
      shrine: "sanctuary",
      basilica: "temple",
      plain: "region",
      district: "region",
      territory: "region",
      valley: "landscape",
      spring: "landscape",
      lake: "landscape",
      bridge: "bridge",
      aqueduct: "aqueduct",
      road: "road",
      harbor: "harbor",
      port: "port",
      settlement: "settlement",
      "archaeological-site": "archaeological-site"
    };

    return aliases[placeTypeKey] || placeTypeKey || aliases[categoryKey] || categoryKey || aliases[markerKey] || markerKey || "unknown";
  }

  function getPlaceStyle(properties) {
    const props = properties || {};
    const categoryKey = normalizeReferenceToken(props.category);
    const typeKey = resolveReferenceTypeKey(props);
    const base = REFERENCE_ICON_MAP[typeKey]
      || REFERENCE_CATEGORY_FALLBACK[categoryKey]
      || REFERENCE_CATEGORY_FALLBACK.unknown;
    const priority = normalizeReferenceToken(props.priority);

    if (priority === "major") {
      return Object.assign({ typeKey: typeKey }, base, { radius: 8, weight: 2, fillOpacity: 0.95 });
    }

    if (priority === "notable") {
      return Object.assign({ typeKey: typeKey }, base, { radius: 6, weight: 1.5, fillOpacity: 0.85 });
    }

    return Object.assign({ typeKey: typeKey }, base, { radius: 4, weight: 1, fillOpacity: 0.75 });
  }

  function getReferencePriority(feature) {
    const properties = feature && feature.properties ? feature.properties : {};
    return normalizeReferenceToken(properties.priority) || "notable";
  }

  function getReferenceKeepTier(feature, keepRules) {
    const properties = feature && feature.properties ? feature.properties : {};
    const id = normalizeLabelValue(properties.id);
    if (!id || !keepRules) {
      return "";
    }

    if (keepRules.coreKeep && keepRules.coreKeep.has(id)) {
      return "core_keep";
    }

    if (keepRules.majorKeep && keepRules.majorKeep.has(id)) {
      return "major_keep";
    }

    return "";
  }

  function getReferenceSortRank(feature, keepRules) {
    const keepTier = getReferenceKeepTier(feature, keepRules);
    if (keepTier === "core_keep") {
      return 0;
    }

    if (keepTier === "major_keep") {
      return 1;
    }

    const priorityOrder = {
      major: 2,
      notable: 3
    };
    const priority = priorityOrder[getReferencePriority(feature)];
    return Number.isFinite(priority) ? priority : 9;
  }

  function compareReferenceFeatures(a, b, keepRules) {
    const aRank = getReferenceSortRank(a, keepRules);
    const bRank = getReferenceSortRank(b, keepRules);

    if (aRank !== bRank) {
      return aRank - bRank;
    }

    const aTitle = (((a || {}).properties || {}).title || "").toLowerCase();
    const bTitle = (((b || {}).properties || {}).title || "").toLowerCase();
    return aTitle.localeCompare(bTitle);
  }

  function getReferenceSvgMarkup(style) {
    const size = Math.max(14, Math.round(style.radius * 2 + 4));
    const strokeWidth = style.weight >= 2 ? 1.75 : 1.45;
    const common = `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
    let body = "";

    switch (style.icon) {
      case "city":
        body = '<circle cx="12" cy="12" r="2.3" fill="currentColor"/>';
        break;
      case "ruins":
        body = `<path d="M6 18h12M8 18v-6m4 6v-4m4 4V9M7 10h2m6 1h2" ${common}/>`;
        break;
      case "temple":
        body = `<path d="M6 10h12M7 10l5-3 5 3M7 16v-4m3 4v-4m4 4v-4m3 4v-4M5 17h14" ${common}/>`;
        break;
      case "sanctuary":
        body = `<circle cx="12" cy="9" r="1.6" fill="currentColor"/><path d="M7 17c1.3-2.8 3.1-4.2 5-4.2S15.7 14.2 17 17M9 12h6" ${common}/>`;
        break;
      case "theatre":
        body = `<path d="M7 15a5 5 0 0 1 10 0M8.5 15a3.5 3.5 0 0 1 7 0M10 15a2 2 0 0 1 4 0M7 17h10" ${common}/>`;
        break;
      case "stadium":
        body = `<rect x="6.5" y="8.5" width="11" height="7" rx="3.5" ${common}/><path d="M9 12h6" ${common}/>`;
        break;
      case "civic":
        body = `<path d="M8 16v-5m4 5v-7m4 7v-5M7 17h10M9 9h6" ${common}/>`;
        break;
      case "fort":
        body = `<path d="M7 17V9h2v2h2V9h2v2h2V9h2v8M7 17h10" ${common}/>`;
        break;
      case "gate":
        body = `<path d="M8 17V9h8v8M10.5 17v-4a1.5 1.5 0 0 1 3 0v4" ${common}/>`;
        break;
      case "tower":
        body = `<path d="M10 17V9h4v8M9 9h6M10 12h4M9 17h6" ${common}/>`;
        break;
      case "burial":
        body = `<path d="M10 17v-6a2 2 0 0 1 4 0v6M9 17h6M11 12h2" ${common}/>`;
        break;
      case "island":
        body = `<path d="M7 15c1.5-2.2 2.9-3.2 5-3.2 1.8 0 3.2 1 5 3.2M7 17c1.6.6 3 .6 5 0 1.8-.6 3.4-.6 5 0" ${common}/>`;
        break;
      case "river":
        body = `<path d="M9 7c2 1.2 1.2 2.5 0 3.9s-1.3 2.6 3 5.1" ${common}/>`;
        break;
      case "mountain":
      case "hill":
      case "cave":
        body = `<path d="M7 17 11 11l2 3 2-5 3 8" ${common}/>`;
        break;
      case "region":
        body = `<path d="M8 8.5 15.5 9.5 17 13.5 13.8 17 8.5 16 6.8 11.5Z" ${common}/>`;
        break;
      case "road":
        body = `<path d="M9 17c.8-3.5 1.8-5 4-8 1-1.2 1.8-2 3-3" ${common}/>`;
        break;
      case "harbor":
        body = `<path d="M12 7v7M9 10c1 .8 2 1.2 3 1.2s2-.4 3-1.2M9 14c0 1.7 1.3 3 3 3s3-1.3 3-3" ${common}/>`;
        break;
      case "landscape":
        body = `<circle cx="15.8" cy="8.2" r="1.4" fill="currentColor"/><path d="M7 17c1.8-2.4 3.1-3.5 4.8-3.5 1.4 0 2.3.8 5.2-1.8" ${common}/>`;
        break;
      default:
        body = '<circle cx="12" cy="12" r="2.2" fill="currentColor"/>';
        break;
    }

    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  }

  function createReferenceMarker(feature, latlng, layerConfig) {
    const properties = feature && feature.properties ? feature.properties : {};
    const style = getPlaceStyle(properties);
    const priority = getReferencePriority(feature);
    const keepTier = getReferenceKeepTier(feature, layerConfig && layerConfig.keepRules);
    const markerSize = Math.max(14, Math.round(style.radius * 2 + 4));
    const iconHtml = [
      `<span class="hmap-ref-icon hmap-ref-icon--${style.icon} hmap-ref-icon--priority-${priority}"`,
      ` style="--hmap-ref-color:${style.color};--hmap-ref-size:${markerSize}px">`,
      getReferenceSvgMarkup(style),
      "</span>"
    ].join("");

    return L.marker(latlng, {
      icon: L.divIcon({
        className: "hmap-ref-marker-wrap",
        html: iconHtml,
        iconSize: [markerSize, markerSize],
        iconAnchor: [Math.round(markerSize / 2), Math.round(markerSize / 2)]
      }),
      keyboard: false,
      zIndexOffset: keepTier === "core_keep" ? 600 : priority === "major" ? 400 : 200
    });
  }

  function getReferenceFeatureKey(feature) {
    const properties = feature && feature.properties ? feature.properties : {};
    return String(properties.id || properties.title || JSON.stringify(feature.geometry || {}));
  }

  function getReferenceFilterLabel(icon) {
    const labels = {
      city: "City",
      ruins: "Ruins",
      sanctuary: "Sanctuary",
      temple: "Temple",
      theatre: "Theatre",
      stadium: "Stadium",
      civic: "Civic",
      fort: "Fort",
      gate: "Gate",
      tower: "Tower",
      burial: "Burial",
      island: "Island",
      river: "River",
      mountain: "Mountain",
      hill: "Hill",
      cave: "Cave",
      region: "Region",
      road: "Road",
      harbor: "Harbor",
      landscape: "Landscape",
      dot: "Other"
    };

    return labels[icon] || icon;
  }

  function getReferenceFilterIconMarkup(icon) {
    const style = {
      icon: icon,
      radius: 6,
      weight: 1.4
    };
    return getReferenceSvgMarkup(style);
  }

  function getReferenceFilterGroup(icon) {
    const groups = {
      city: "Settlements",
      harbor: "Settlements",
      ruins: "Sites",
      temple: "Sacred",
      sanctuary: "Sacred",
      theatre: "Civic",
      stadium: "Civic",
      civic: "Civic",
      fort: "Military",
      gate: "Military",
      tower: "Military",
      road: "Infrastructure",
      region: "Regions",
      landscape: "Landscape",
      mountain: "Landscape",
      hill: "Landscape",
      river: "Landscape",
      island: "Landscape",
      cave: "Landscape",
      burial: "Burial",
      dot: "Other"
    };

    return groups[icon] || "Other";
  }

  function getMergedReferenceFilterGroups(options) {
    const groupedOptions = (Array.isArray(options) ? options : []).reduce(function(result, option) {
      const group = getReferenceFilterGroup(option.icon);
      if (!result[group]) {
        result[group] = [];
      }
      result[group].push(option);
      return result;
    }, {});

    Object.keys(groupedOptions).forEach(function(group) {
      if (group === "Other") {
        return;
      }

      if (groupedOptions[group].length === 1) {
        if (!groupedOptions.Other) {
          groupedOptions.Other = [];
        }
        groupedOptions.Other = groupedOptions.Other.concat(groupedOptions[group]);
        delete groupedOptions[group];
      }
    });

    const orderedGroups = ["Settlements", "Sacred", "Civic", "Military", "Infrastructure", "Regions", "Landscape", "Burial", "Sites", "Other"]
      .filter(function(group) { return groupedOptions[group] && groupedOptions[group].length; });

    return {
      groupedOptions: groupedOptions,
      orderedGroups: orderedGroups
    };
  }

  function collectReferenceIcons(geojson) {
    const features = Array.isArray(geojson && geojson.features) ? geojson.features : [];
    const counts = new Map();

    features.forEach(function(feature) {
      const style = getPlaceStyle((feature && feature.properties) || {});
      counts.set(style.icon, (counts.get(style.icon) || 0) + 1);
    });

    const order = {
      city: 0,
      temple: 1,
      sanctuary: 2,
      fort: 3,
      gate: 4,
      tower: 5,
      theatre: 6,
      stadium: 7,
      civic: 8,
      harbor: 9,
      road: 10,
      region: 11,
      landscape: 12,
      mountain: 13,
      hill: 14,
      river: 15,
      island: 16,
      cave: 17,
      burial: 18,
      ruins: 19,
      dot: 20
    };

    return Array.from(counts.entries()).sort(function(a, b) {
      const aOrder = Object.prototype.hasOwnProperty.call(order, a[0]) ? order[a[0]] : 999;
      const bOrder = Object.prototype.hasOwnProperty.call(order, b[0]) ? order[b[0]] : 999;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a[0].localeCompare(b[0]);
    }).map(function(entry) {
      return { icon: entry[0], count: entry[1] };
    });
  }

  function getReferenceDeclutterRadius(map, layerConfig) {
    if (layerConfig && layerConfig.declutter && typeof layerConfig.declutter.radius === "number") {
      return layerConfig.declutter.radius;
    }

    const currentZoom = map.getZoom();
    if (currentZoom <= 6) return 54;
    if (currentZoom <= 7) return 46;
    if (currentZoom <= 8) return 38;
    if (currentZoom <= 9) return 30;
    return 22;
  }

  function getSparseReferenceFeatures(map, features, layerConfig, keepRules) {
    const minDistance = getReferenceDeclutterRadius(map, layerConfig);
    const groupedFeatures = new Map();
    const kept = [];

    features.forEach(function(feature) {
      const properties = feature && feature.properties ? feature.properties : {};
      const style = getPlaceStyle(properties);
      const groupKey = style.icon || "dot";

      if (!groupedFeatures.has(groupKey)) {
        groupedFeatures.set(groupKey, []);
      }

      groupedFeatures.get(groupKey).push(feature);
    });

    groupedFeatures.forEach(function(group) {
      const occupied = [];

      group.sort(function(a, b) {
        return compareReferenceFeatures(a, b, keepRules);
      }).forEach(function(feature) {
        const coordinates = ((feature || {}).geometry || {}).coordinates || [];
        if (coordinates.length < 2) {
          return;
        }

        const point = map.latLngToContainerPoint([coordinates[1], coordinates[0]]);
        const keepTier = getReferenceKeepTier(feature, keepRules);
        const forceKeep = keepTier === "core_keep";
        const blocked = occupied.some(function(existing) {
          const dx = existing.x - point.x;
          const dy = existing.y - point.y;
          return Math.sqrt(dx * dx + dy * dy) < minDistance;
        });

        if (blocked && !forceKeep) {
          return;
        }

        occupied.push(point);
        kept.push(feature);
      });
    });

    return kept.sort(function(a, b) {
      return compareReferenceFeatures(a, b, keepRules);
    });
  }

  function getReferenceFilterToggleMarkup() {
    return [
      '<span class="hmap-ref-filter__toggle-icon" aria-hidden="true">',
      '  <svg viewBox="0 0 16 16" focusable="false">',
      '    <path d="M2.5 4.25h11M4.5 8h7M6.5 11.75h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
      "  </svg>",
      "</span>"
    ].join("");
  }

  function createViewerLayout(el, mapId) {
    const wrapper = el.closest(".hmap-wrapper");
    if (!wrapper) {
      return null;
    }

    const inlineShell = document.createElement("div");
    inlineShell.className = "hmap-viewer-inline-shell";
    wrapper.insertBefore(inlineShell, el);
    inlineShell.appendChild(el);

    const modal = document.createElement("div");
    modal.className = "hmap-viewer-modal";
    modal.hidden = true;
    modal.innerHTML = [
      '<div class="hmap-viewer-modal__backdrop"></div>',
      '<div class="hmap-viewer-modal__dialog" role="dialog" aria-modal="true" aria-label="Historical map viewer">',
      '  <div class="hmap-viewer-modal__map-shell"></div>',
      "</div>"
    ].join("");

    const dialog = modal.querySelector(".hmap-viewer-modal__dialog");
    const mapShell = modal.querySelector(".hmap-viewer-modal__map-shell");
    const backdrop = modal.querySelector(".hmap-viewer-modal__backdrop");
    const listeners = [];
    let resizeObserver = null;
    const state = {
      open: false
    };

    function notify() {
      listeners.forEach(function(listener) {
        listener(state.open);
      });
    }

    function syncInlineShellHeight() {
      if (state.open) {
        inlineShell.style.removeProperty("--hmap-shell-height");
        return;
      }

      const rect = el.getBoundingClientRect();
      if (rect.height > 0) {
        inlineShell.style.setProperty("--hmap-shell-height", `${Math.round(rect.height)}px`);
      }
    }

    function syncDom() {
      document.body.classList.toggle("hmap-viewer-body", state.open);
      modal.hidden = !state.open;

      if (state.open) {
        if (!modal.parentNode) {
          document.body.appendChild(modal);
        }
        mapShell.appendChild(el);
      } else {
        inlineShell.appendChild(el);
        if (modal.parentNode) {
          modal.remove();
        }
      }

      syncInlineShellHeight();
    }

    function open() {
      if (state.open) {
        return;
      }

      state.open = true;
      syncDom();
      notify();
    }

    function close() {
      if (!state.open) {
        return;
      }

      state.open = false;
      syncDom();
      notify();
    }

    function toggle() {
      if (state.open) {
        close();
      } else {
        open();
      }
    }

    function handleKeydown(event) {
      if (event.key === "Escape" && state.open) {
        close();
      }
    }

    backdrop.addEventListener("click", close);
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("resize", syncInlineShellHeight);

    if (typeof window.ResizeObserver === "function") {
      resizeObserver = new window.ResizeObserver(function() {
        syncInlineShellHeight();
      });
      resizeObserver.observe(el);
    }

    syncInlineShellHeight();

    return {
      wrapper: wrapper,
      inlineShell: inlineShell,
      modal: modal,
      shell: dialog,
      isOpen: function() {
        return state.open;
      },
      getToggleHost: function() {
        return state.open ? dialog : inlineShell;
      },
      getPanelStateHost: function() {
        return state.open ? modal : inlineShell;
      },
      onChange: function(listener) {
        if (typeof listener === "function") {
          listeners.push(listener);
        }
      },
      syncInlineShellHeight: syncInlineShellHeight,
      open: open,
      close: close,
      toggle: toggle
    };
  }

  function renderViewerToggle(el, layout) {
    if (!layout) {
      return;
    }

    [el, el.parentElement, layout.wrapper, layout.shell].filter(Boolean).forEach(function(node) {
      const existing = node.querySelector(".hmap-viewer-toggle");
      if (existing) {
        existing.remove();
      }
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "hmap-viewer-toggle";
    button.innerHTML = getViewerToggleMarkup();

    function mountButton() {
      const host = (layout.getToggleHost && layout.getToggleHost()) || el.parentElement || el;
      if (host && button.parentNode !== host) {
        host.appendChild(button);
      }
    }

    function syncState() {
      const expanded = layout.isOpen();
      mountButton();
      button.classList.toggle("is-open", expanded);
      button.title = expanded ? "Close large map" : "Open large map";
      button.setAttribute("aria-label", expanded ? "Close large map" : "Open large map");
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

    button.addEventListener("click", function() {
      layout.toggle();
    });

    layout.onChange(syncState);
    syncState();
    stopDomEventPropagation(button);
  }

  function renderReferenceFilterControl(el, state, layout) {
    const host = (layout && layout.getToggleHost && layout.getToggleHost()) || el.parentElement || el;

    [el.parentElement, layout && layout.wrapper, layout && layout.shell].filter(Boolean).forEach(function(node) {
      const existing = node.querySelector(".hmap-ref-filter");
      if (existing) {
        existing.remove();
      }
    });

    if (!state || !Array.isArray(state.options) || state.options.length < 2) {
      return;
    }

    const root = document.createElement("div");
    const mergedGroups = getMergedReferenceFilterGroups(state.options);
    const groupedOptions = mergedGroups.groupedOptions;
    const orderedGroups = mergedGroups.orderedGroups;

    root.className = "hmap-ref-filter";
    root.innerHTML = [
      '<button type="button" class="hmap-ref-filter__toggle" aria-expanded="false" title="Filter places" aria-label="Filter places">',
      getReferenceFilterToggleMarkup(),
      "</button>",
      '<div class="hmap-ref-filter__panel" hidden>',
      '  <div class="hmap-ref-filter__panel-body">',
      orderedGroups.map(function(group) {
        return [
          '<section class="hmap-ref-filter__group">',
          `  <div class="hmap-ref-filter__group-title">${group}</div>`,
          '  <div class="hmap-ref-filter__group-body">',
          groupedOptions[group].map(function(option) {
            return [
              `<button type="button" class="hmap-ref-filter__chip is-active" data-filter="${option.icon}"`,
              ` title="${getReferenceFilterLabel(option.icon)}" aria-label="${getReferenceFilterLabel(option.icon)}">`,
              `<span class="hmap-ref-filter__icon" style="--hmap-ref-color:${REFERENCE_ICON_MAP[option.icon] ? REFERENCE_ICON_MAP[option.icon].color : '#757575'}">`,
              getReferenceFilterIconMarkup(option.icon),
              "</span>",
              "</button>"
            ].join("");
          }).join(""),
          "  </div>",
          "</section>"
        ].join("");
      }).join(""),
      "  </div>",
      "</div>"
    ].join("");

    const toggle = root.querySelector(".hmap-ref-filter__toggle");
    const panel = root.querySelector(".hmap-ref-filter__panel");
    const panelStateHost = (layout && layout.getPanelStateHost && layout.getPanelStateHost()) || host;

    function syncWrapperState() {
      const isOpen = root.classList.contains("is-open");
      if (layout && layout.inlineShell) {
        layout.inlineShell.classList.remove("hmap-viewer-inline-shell--filter-open");
      }
      if (layout && layout.modal) {
        layout.modal.classList.remove("hmap-viewer-modal--filter-open");
      }
      if (layout && layout.isOpen && layout.isOpen()) {
        panelStateHost.classList.toggle("hmap-viewer-modal--filter-open", isOpen);
      } else {
        panelStateHost.classList.toggle("hmap-viewer-inline-shell--filter-open", isOpen);
      }
    }

    function syncButtons() {
      const buttons = Array.from(root.querySelectorAll(".hmap-ref-filter__chip[data-filter]"));

      buttons.forEach(function(button) {
        button.classList.toggle("is-active", state.selectedIcons.has(button.dataset.filter));
      });
    }

    toggle.addEventListener("click", function() {
      const isOpen = root.classList.toggle("is-open");
      panel.hidden = !isOpen;
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      syncWrapperState();
    });

    panel.addEventListener("click", function(event) {
      const button = event.target.closest("[data-filter]");
      if (!button) return;

      const filter = button.dataset.filter;
      if (state.selectedIcons.has(filter)) {
        state.selectedIcons.delete(filter);
      } else {
        state.selectedIcons.add(filter);
      }

      syncButtons();
      state.listeners.forEach(function(listener) {
        listener();
      });
    });

    syncButtons();
    host.appendChild(root);
    stopDomEventPropagation(root);
    syncWrapperState();
  }

  function getReferenceLabelClassName(feature, layerConfig) {
    const properties = feature && feature.properties ? feature.properties : {};
    const style = getPlaceStyle(properties);
    const priority = getReferencePriority(feature);
    const baseClassName = (layerConfig.labelOptions && layerConfig.labelOptions.className) || "hmap-ref-label";
    return `${baseClassName} hmap-ref-label--${style.icon} hmap-ref-label--priority-${priority}`;
  }

  function mountReferenceLayer(map, geojson, layerConfig, referenceState, keepRules, focusRegistry) {
    const sourceFeatures = Array.isArray(geojson.features) ? geojson.features : [];
    const featureLayer = L.layerGroup().addTo(map);

    if (Array.isArray(focusRegistry)) {
      sourceFeatures.forEach(function(feature) {
        const coordinates = ((feature || {}).geometry || {}).coordinates || [];
        if (coordinates.length < 2) {
          return;
        }

        focusRegistry.push({
          properties: (feature && feature.properties) || {},
          latlng: [coordinates[1], coordinates[0]]
        });
      });
    }

    function render() {
      featureLayer.clearLayers();

      const currentZoom = map.getZoom();
      const bounds = map.getBounds().pad(0.2);
      const labelMinZoom = typeof layerConfig.labelMinZoom === "number" ? layerConfig.labelMinZoom : 10;
      const pointMinZoom = typeof layerConfig.pointMinZoom === "number" ? layerConfig.pointMinZoom : 8;
      const maxVisible = typeof layerConfig.maxVisible === "number" ? layerConfig.maxVisible : 400;
      const showLabels = currentZoom >= labelMinZoom;

      if (currentZoom < pointMinZoom) {
        return;
      }

      const visibleFeatures = sourceFeatures.filter(function(feature) {
        const style = getPlaceStyle((feature && feature.properties) || {});
        return isPointFeatureVisible(feature, bounds)
          && (!referenceState || referenceState.selectedIcons.has(style.icon));
      }).sort(function(a, b) {
        return compareReferenceFeatures(a, b, keepRules);
      });
      const sparseFeatures = getSparseReferenceFeatures(map, visibleFeatures, layerConfig, keepRules).slice(0, maxVisible);

      sparseFeatures.forEach(function(feature) {
        const coordinates = ((feature || {}).geometry || {}).coordinates || [];
        if (coordinates.length < 2) {
          return;
        }

        const layer = createReferenceMarker(
          feature,
          [coordinates[1], coordinates[0]],
          Object.assign({}, layerConfig, { keepRules: keepRules })
        );
        const properties = feature.properties || {};
        const labelText = getFeatureLabelText(properties, {
          labelField: layerConfig.labelField || "title"
        });

        if (showLabels && layerConfig.labels !== false && labelText && typeof layer.bindTooltip === "function") {
          layer.bindTooltip(String(labelText), Object.assign({
            permanent: true,
            direction: "top",
            offset: [0, -6],
            className: getReferenceLabelClassName(feature, layerConfig)
          }, layerConfig.labelOptions || {}));
        }

        layer.addTo(featureLayer);
      });
    }

    render();
    map.on("moveend zoomend", render);
    if (referenceState) {
      referenceState.listeners.push(render);
    }
  }

  async function loadReferenceLayers(map, el, basePath, meta, layout, focusRegistry) {
    const referenceLayers = Array.isArray(meta.referenceLayers)
      ? meta.referenceLayers
      : Array.isArray(meta.editReferenceLayers)
        ? meta.editReferenceLayers
        : [];

    if (!referenceLayers.length) {
      return;
    }

    const referenceState = {
      options: [],
      selectedIcons: new Set(),
      listeners: []
    };
    const keepRulesCache = new Map();

    for (const layerConfig of referenceLayers) {
      const geojson = await fetchJson(basePath + layerConfig.file);
      let keepRules = createEmptyKeepRules();
      if (layerConfig.keepRulesFile) {
        if (!keepRulesCache.has(layerConfig.keepRulesFile)) {
          keepRulesCache.set(
            layerConfig.keepRulesFile,
            fetchJson(basePath + layerConfig.keepRulesFile).then(parseKeepRules).catch(function(error) {
              console.warn("Failed to load keep rules:", error);
              return createEmptyKeepRules();
            })
          );
        }
        keepRules = await keepRulesCache.get(layerConfig.keepRulesFile);
      }
      collectReferenceIcons(geojson).forEach(function(option) {
        if (!referenceState.options.some(function(item) { return item.icon === option.icon; })) {
          referenceState.options.push(option);
        }
      });
      if (layerConfig.visible !== false) {
        mountReferenceLayer(map, geojson, layerConfig, referenceState, keepRules, focusRegistry);
      }
    }

    referenceState.selectedIcons = new Set(
      referenceState.options.some(function(option) {
        return option.icon === "city";
      }) ? ["city"] : []
    );
    referenceState.listeners.forEach(function(listener) {
      listener();
    });
    renderReferenceFilterControl(el, referenceState, layout);
    if (layout) {
      layout.onChange(function() {
        renderReferenceFilterControl(el, referenceState, layout);
      });
    }
  }

  function updateLayerLocale(geoLayer, layerConfig, lang) {
    if (!geoLayer || typeof geoLayer.eachLayer !== "function") {
      return;
    }

    geoLayer.eachLayer(function(layer) {
      if (layer && layer.feature) {
        applyFeatureLocale(layer, layer.feature, layerConfig, lang);
      }
    });
  }

  function renderLanguageSwitch(el, meta, layerEntries, activeLangRef) {
    if (!meta.labelToggle || !Array.isArray(meta.labelLanguages) || meta.labelLanguages.length < 2) {
      return;
    }

    const existing = el.querySelector(".hmap-lang-switch");
    if (existing) {
      existing.remove();
    }

    const labels = meta.labelLanguageLabels || {};
    const switcher = document.createElement("div");
    switcher.className = "hmap-lang-switch";

    meta.labelLanguages.forEach(function(lang) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hmap-lang-switch__button";
      button.textContent = labels[lang] || lang.toUpperCase();

      if (lang === activeLangRef.value) {
        button.classList.add("is-active");
      }

      button.addEventListener("click", function() {
        activeLangRef.value = lang;
        Array.from(switcher.querySelectorAll(".hmap-lang-switch__button")).forEach(function(node) {
          node.classList.toggle("is-active", node === button);
        });
        layerEntries.forEach(function(entry) {
          updateLayerLocale(entry.layer, entry.config, activeLangRef.value);
        });
      });

      switcher.appendChild(button);
    });

    el.appendChild(switcher);
  }

  function applyBoundsConstraints(map, meta) {
    if (!Array.isArray(meta.maxBounds) || meta.maxBounds.length !== 2) {
      return;
    }

    const bounds = L.latLngBounds(meta.maxBounds);
    map.setMaxBounds(bounds);

    if (typeof meta.maxBoundsViscosity === "number") {
      map.options.maxBoundsViscosity = meta.maxBoundsViscosity;
    }

    const enforceBoundsMinZoom = getActiveBoolean(meta, "enforceBoundsMinZoom", true);
    if (!enforceBoundsMinZoom) {
      return;
    }

    const syncMinZoomToBounds = function() {
      const minZoomFromBounds = map.getBoundsZoom(bounds, false, L.point(20, 20));
      if (Number.isFinite(minZoomFromBounds)) {
        map.setMinZoom(minZoomFromBounds);
        if (map.getZoom() < minZoomFromBounds) {
          map.setZoom(minZoomFromBounds, { animate: false });
        }
      }
    };

    map.whenReady(syncMinZoomToBounds);
    map.on("resize", syncMinZoomToBounds);
  }

  async function initMap(el) {
    const mapId = el.dataset.mapId;
    if (!mapId) return;

    el.setAttribute("aria-busy", "true");

    const basePath = toSiteUrl(`maps/${mapId}/`);
    const meta = await fetchJson(basePath + "meta.json");
    const view = meta.view || {};
    const isInteractive = meta.interactive !== false;
    const activeLangRef = {
      value: meta.defaultLabelLang || "en"
    };
    const theme = getMapTheme(el);
    const viewerLayout = createViewerLayout(el, mapId);
    syncViewerTheme(viewerLayout);

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: meta.attributionControl === true,
      dragging: isInteractive,
      scrollWheelZoom: isInteractive,
      touchZoom: isInteractive,
      doubleClickZoom: isInteractive,
      boxZoom: false,
      keyboard: isInteractive,
      tap: isInteractive,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      preferCanvas: true
    }).setView(view.center || [0, 0], view.zoom || 2);

    const minZoom = getActiveZoom(meta, "minZoom");
    if (typeof minZoom === "number") {
      map.setMinZoom(minZoom);
    }

    const maxZoom = getActiveZoom(meta, "maxZoom");
    if (typeof maxZoom === "number") {
      map.setMaxZoom(maxZoom);
    }

    applyBoundsConstraints(map, meta);

    const activeTileLayer = getActiveTileLayerConfig(meta);
    if (activeTileLayer !== false) {
      const tileLayer = activeTileLayer || DEFAULT_TILE_LAYER;
      const tileOptions = Object.assign(
        {},
        DEFAULT_TILE_LAYER.options || {},
        {
          detectRetina: true,
          updateWhenIdle: true,
          updateWhenZooming: false
        },
        tileLayer.options || {}
      );
      L.tileLayer(tileLayer.url || DEFAULT_TILE_LAYER.url, tileOptions).addTo(map);
    }

    const overlayMaps = {};
    const loadedLayers = [];
    const layerEntries = [];
    const referenceFocusRegistry = [];

    for (const layerConfig of Array.isArray(meta.layers) ? meta.layers : []) {
      const geojson = await fetchJson(basePath + layerConfig.file);
      const geoLayer = createGeoJsonLayer(layerConfig, geojson, activeLangRef.value, theme);

      if (layerConfig.visible !== false) {
        geoLayer.addTo(map);
      }

      loadedLayers.push(geoLayer);
      layerEntries.push({ layer: geoLayer, config: layerConfig });
      overlayMaps[layerConfig.label || layerConfig.file] = geoLayer;
    }

    await loadReferenceLayers(map, el, basePath, meta, viewerLayout, referenceFocusRegistry);

    if (meta.layerControl !== false && Object.keys(overlayMaps).length) {
      L.control.layers(null, overlayMaps, {
        collapsed: window.innerWidth < 820
      }).addTo(map);
    }

    if (Array.isArray(view.bounds) && view.bounds.length === 2) {
      map.fitBounds(view.bounds, {
        animate: false,
        padding: [20, 20]
      });
    } else if (meta.fitBounds !== false && loadedLayers.length) {
      const bounds = L.featureGroup(loadedLayers).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          animate: false,
          padding: [20, 20]
        });
      }
    }

    if (meta.scaleControl === true) {
      L.control.scale().addTo(map);
    }

    window.setTimeout(function() {
      map.invalidateSize(false);
      if (viewerLayout) {
        viewerLayout.syncInlineShellHeight();
      }
    }, 0);
    window.setTimeout(function() {
      map.invalidateSize(false);
      if (viewerLayout) {
        viewerLayout.syncInlineShellHeight();
      }
    }, 180);
    if (viewerLayout) {
      viewerLayout.onChange(function() {
        window.setTimeout(function() {
          map.invalidateSize(false);
          viewerLayout.syncInlineShellHeight();
        }, 0);
        window.setTimeout(function() {
          map.invalidateSize(false);
          viewerLayout.syncInlineShellHeight();
        }, 180);
      });
    }

    renderAttribution(el, meta);
    renderViewerToggle(el, viewerLayout);
    createEditor(map, el, mapId);
    renderLanguageSwitch(el, meta, layerEntries, activeLangRef);
    applyFocusQuery(map, layerEntries, referenceFocusRegistry, activeLangRef);
    el.removeAttribute("aria-busy");
  }

  function renderError(el, error) {
    el.classList.add("historical-map--error");
    el.innerHTML = `<div class="historical-map__message">Map failed to load: ${error.message}</div>`;
    el.removeAttribute("aria-busy");
  }

  function bootstrap() {
    const nodes = document.querySelectorAll(".js-hmap");
    if (!nodes.length || typeof window.L === "undefined") {
      return;
    }

    nodes.forEach(function(node) {
      initMap(node).catch(function(error) {
        renderError(node, error);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();



