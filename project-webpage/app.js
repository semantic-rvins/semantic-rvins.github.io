/* Anonymous review trajectory viewer. All methods and coordinates come from the
   final benchmark export; no points are trimmed by distance or error magnitude. */
(function () {
  'use strict';

  var container = document.getElementById('map');
  var legend = document.getElementById('legend-items');
  if (!container || !legend) return;

  var status = document.getElementById('map-status');
  if (!status) {
    status = document.createElement('p');
    status.id = 'map-status';
    status.className = 'map-status';
    container.insertAdjacentElement('afterend', status);
  }
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Loading trajectories…';
  container.setAttribute('aria-busy', 'true');

  var actions = [
    ['fit-reference', 'Fit ground truth'],
    ['fit-visible', 'Fit visible tracks'],
    ['show-all-tracks', 'Show all'],
    ['show-default-tracks', 'Reset selection']
  ];
  var controls = {};
  var controlBox = document.getElementById('map-controls');
  actions.forEach(function (action) {
    var button = document.getElementById(action[0]);
    if (!button) {
      if (!controlBox) {
        controlBox = document.createElement('div');
        controlBox.id = 'map-controls';
        controlBox.className = 'map-controls';
        legend.insertAdjacentElement('afterend', controlBox);
      }
      button = document.createElement('button');
      button.id = action[0];
      button.className = 'map-button';
      button.textContent = action[1];
      controlBox.appendChild(button);
    }
    button.type = 'button';
    button.disabled = true;
    controls[action[0]] = button;
  });
  ['map-basemap', 'map-buildings', 'map-view-2d', 'map-view-3d',
    'map-bearing', 'map-pitch'].forEach(function (id) {
    var control = document.getElementById(id);
    if (control) {
      control.disabled = true;
      controls[id] = control;
    }
  });

  // A missing epoch or an explicit matched-sample time gap ends the current run.
  // Isolated valid epochs are retained and rendered as points.
  function segments(track) {
    var starts = new Set(track.segment_starts || []);
    var result = [];
    var current = [];
    track.coords.forEach(function (coordinate, index) {
      if ((coordinate === null || starts.has(index)) && current.length) {
        result.push(current);
        current = [];
      }
      if (coordinate !== null) current.push(coordinate);
    });
    if (current.length) result.push(current);
    return result;
  }

  function validateTrack(track) {
    return track && Array.isArray(track.coords) && track.coords.every(function (point) {
      return point === null || (Array.isArray(point) && point.length >= 2 &&
        Number.isFinite(point[0]) && Number.isFinite(point[1]));
    });
  }

  function blankStyle() {
    return { version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e9eeec' } }
    ] };
  }

  function osmStyle() {
    return {
      version: 8,
      sources: {
        'osm-streets': {
          type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256, maxzoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
      },
      layers: [{ id: 'osm-streets', type: 'raster', source: 'osm-streets' }]
    };
  }

  function start(data) {
    if (!window.maplibregl) throw new Error('The map library could not be loaded.');
    if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) {
      throw new Error('WebGL is unavailable in this browser.');
    }
    if (!validateTrack(data.gt) || !data.methods || typeof data.methods !== 'object') {
      throw new Error('The trajectory export has an invalid format.');
    }
    var names = [];
    (Array.isArray(data.order) ? data.order : []).concat(Object.keys(data.methods)).forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(data.methods, name) && names.indexOf(name) === -1) {
        if (!validateTrack(data.methods[name])) throw new Error('A trajectory has invalid coordinates.');
        names.push(name);
      }
    });

    var map;
    var entries = [];
    var features = [];
    var focused = null;
    var hovered = null;
    var styleReady = false;
    var loadingBasemap = false;
    var basemapWarning = '';
    var contextLost = false;
    var basemap = controls['map-basemap'] ? controls['map-basemap'].value : 'openfreemap';
    var styleRequest = null;
    var styleVersion = 0;
    var cachedVectorStyle = null;
    var buildingsLayer = 'review-3d-buildings';
    var tracksSource = 'review-trajectories';
    var defaultName = names.indexOf('SeA-RVINS (latent)') !== -1 ? 'SeA-RVINS (latent)' :
      names.find(function (name) { return name.indexOf('SeA-RVINS') === 0; });

    function updateStatus() {
      var count = entries.filter(function (entry) { return entry.checkbox.checked; }).length;
      status.textContent = count + ' of ' + entries.length + ' tracks visible.' +
        (contextLost ? ' The graphics context was interrupted; waiting for recovery.' :
          loadingBasemap ? ' Loading basemap…' : basemapWarning ? ' ' + basemapWarning : '') +
        (basemap === 'osm' ? ' 3D buildings are available with OpenFreeMap.' : '');
      container.setAttribute('aria-busy', loadingBasemap || contextLost ? 'true' : 'false');
      controls['fit-visible'].disabled = !entries.some(function (entry) {
        return entry.checkbox.checked && !entry.bounds.isEmpty();
      });
      if (controls['map-buildings']) controls['map-buildings'].disabled = basemap !== 'openfreemap';
    }

    function emphasize() {
      if (!styleReady) return;
      var active = hovered || focused;
      if (active && !active.checkbox.checked) active = null;
      entries.forEach(function (entry) {
        var opacity = active && active !== entry ? 0.18 : entry.opacity;
        if (map.getLayer(entry.lineId)) {
          map.setPaintProperty(entry.lineId, 'line-opacity', opacity);
          map.setLayoutProperty(entry.lineId, 'visibility', entry.checkbox.checked ? 'visible' : 'none');
        }
        if (map.getLayer(entry.pointId)) {
          map.setPaintProperty(entry.pointId, 'circle-opacity', opacity);
          map.setPaintProperty(entry.pointId, 'circle-stroke-opacity', opacity);
          map.setLayoutProperty(entry.pointId, 'visibility', entry.checkbox.checked ? 'visible' : 'none');
        }
        // Restore deterministic order after a previous hover or focus.
        if (map.getLayer(entry.lineId)) map.moveLayer(entry.lineId);
        if (map.getLayer(entry.pointId)) map.moveLayer(entry.pointId);
      });
      if (active) {
        if (map.getLayer(active.lineId)) map.moveLayer(active.lineId);
        if (map.getLayer(active.pointId)) map.moveLayer(active.pointId);
      }
    }

    function addTrack(name, track, reference) {
      var id = entries.length;
      var color = track.color || (reference ? '#29323d' : '#0072b2');
      var points = track.coords.filter(function (point) { return point !== null; });
      var bounds = new maplibregl.LngLatBounds();
      points.forEach(function (point) { bounds.extend([point[1], point[0]]); });
      segments(track).forEach(function (segment) {
        // The benchmark stores [latitude, longitude]. Keep full source precision
        // and only horizontal coordinates: ellipsoid heights are not map altitude.
        var coordinates = segment.map(function (point) { return [point[1], point[0]]; });
        features.push({
          type: 'Feature', properties: { track: id },
          geometry: coordinates.length === 1 ? { type: 'Point', coordinates: coordinates[0] } :
            { type: 'LineString', coordinates: coordinates }
        });
      });

      var label = document.createElement('label');
      label.className = 'track-toggle';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'trajectory-toggle-' + id;
      checkbox.checked = points.length > 0 && (reference || name === defaultName);
      checkbox.disabled = !points.length;
      checkbox.setAttribute('aria-label', name);
      label.htmlFor = checkbox.id;
      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.borderTopColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      var text = document.createElement('span');
      text.className = 'track-label';
      text.textContent = name;
      var meta = document.createElement('span');
      meta.className = 'track-meta';
      meta.id = checkbox.id + '-meta';
      var availability = track.stats && track.stats.availability_pct;
      meta.textContent = !points.length ? 'No trajectory available' :
        (reference ? 'Reference trajectory' : Number.isFinite(availability) ?
          availability.toFixed(1) + '% available' : points.length.toLocaleString() + ' valid epochs');
      checkbox.setAttribute('aria-describedby', meta.id);
      text.appendChild(meta);
      label.appendChild(checkbox);
      label.appendChild(swatch);
      label.appendChild(text);
      legend.appendChild(label);

      var entry = { name: name, id: id, color: color, width: reference ? 4.5 : 2.8,
        lineId: 'review-track-' + id, pointId: 'review-track-point-' + id,
        bounds: bounds, checkbox: checkbox, opacity: reference ? 0.75 : 0.95,
        reference: reference };
      entries.push(entry);
      checkbox.addEventListener('change', function () { emphasize(); updateStatus(); });
      label.addEventListener('mouseenter', function () { hovered = entry; emphasize(); });
      label.addEventListener('mouseleave', function () { hovered = null; emphasize(); });
      checkbox.addEventListener('focus', function () { focused = entry; emphasize(); });
      checkbox.addEventListener('blur', function () { focused = null; emphasize(); });
    }

    legend.textContent = '';
    addTrack('Ground truth', data.gt, true);
    names.forEach(function (name) { addTrack(name, data.methods[name], false); });
    var trajectoryData = { type: 'FeatureCollection', features: features };

    container.replaceChildren();
    var center = data.center || [0, 0];
    var mapOptions = {
      container: container, style: blankStyle(), center: [center[1], center[0]],
      zoom: 2, pitch: 50, bearing: 0, maxPitch: 70, maxZoom: 20,
      scrollZoom: true, cooperativeGestures: false,
      touchZoomRotate: true, touchPitch: true, dragRotate: true,
      renderWorldCopies: false, attributionControl: false,
      canvasContextAttributes: { antialias: true },
      // OSM requires a valid Referer. Retain the site origin without page paths.
      transformRequest: function (url) {
        return { url: url, referrerPolicy: 'strict-origin-when-cross-origin' };
      }
    };
    if (!entries[0].bounds.isEmpty()) {
      mapOptions.bounds = entries[0].bounds;
      mapOptions.fitBoundsOptions = { padding: 42, maxZoom: 18 };
    }
    map = new maplibregl.Map(mapOptions);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.getCanvas().setAttribute('aria-label', 'Interactive trajectories. Use arrow keys to pan, plus and minus to zoom, or the heading and tilt controls.');

    function updateBuildings() {
      var enabled = basemap === 'openfreemap' &&
        (!controls['map-buildings'] || controls['map-buildings'].checked);
      if (map.getLayer(buildingsLayer)) {
        map.setLayoutProperty(buildingsLayer, 'visibility', enabled ? 'visible' : 'none');
      }
      // Bright's offset roof fill simulates depth in 2D; restore it when the
      // independent extrusion switch is off, avoiding double roofs in 3D.
      if (map.getLayer('building-top')) {
        map.setLayoutProperty('building-top', 'visibility', enabled ? 'none' : 'visible');
      }
      updateStatus();
    }

    function installLayers() {
      styleReady = true;
      var style = map.getStyle();
      var building = style.layers.find(function (layer) {
        return layer['source-layer'] === 'building' && style.sources[layer.source] &&
          style.sources[layer.source].type === 'vector';
      });
      if (basemap === 'openfreemap' && building && !map.getLayer(buildingsLayer)) {
        var firstLabel = style.layers.find(function (layer) { return layer.type === 'symbol'; });
        map.addLayer({
          id: buildingsLayer, type: 'fill-extrusion', source: building.source,
          'source-layer': building['source-layer'], minzoom: 13,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': '#aab9b3',
            'fill-extrusion-height': ['max', 0, ['to-number', ['get', 'render_height'], 0]],
            'fill-extrusion-base': ['max', 0, ['to-number', ['get', 'render_min_height'], 0]],
            'fill-extrusion-opacity': 0.68
          }
        }, firstLabel && firstLabel.id);
      }
      if (!map.getSource(tracksSource)) {
        map.addSource(tracksSource, {
          type: 'geojson', data: trajectoryData, tolerance: 0, maxzoom: 22
        });
      }
      entries.forEach(function (entry) {
        if (!map.getLayer(entry.lineId)) map.addLayer({
          id: entry.lineId, source: tracksSource, type: 'line',
          filter: ['all', ['==', ['get', 'track'], entry.id], ['==', ['geometry-type'], 'LineString']],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': entry.color, 'line-width': entry.width, 'line-opacity': entry.opacity }
        });
        if (!map.getLayer(entry.pointId)) map.addLayer({
          id: entry.pointId, source: tracksSource, type: 'circle',
          filter: ['all', ['==', ['get', 'track'], entry.id], ['==', ['geometry-type'], 'Point']],
          paint: { 'circle-color': entry.color, 'circle-radius': 2.5,
            'circle-stroke-color': entry.color, 'circle-stroke-width': 1,
            'circle-opacity': entry.opacity, 'circle-stroke-opacity': entry.opacity }
        });
      });
      updateBuildings();
      emphasize();
    }
    map.on('style.load', installLayers);
    map.on('error', function (event) {
      basemapWarning = 'Some map content could not load. Trajectories remain available; try another basemap or reload.';
      updateStatus();
      console.warn('Trajectory map:', event.error && event.error.message || 'Map resource unavailable.');
    });
    map.on('webglcontextlost', function () { contextLost = true; updateStatus(); });
    map.on('webglcontextrestored', function () { contextLost = false; updateStatus(); });

    function setBasemap(next) {
      basemap = next;
      var version = ++styleVersion;
      if (styleRequest) styleRequest.abort();
      basemapWarning = '';
      loadingBasemap = next === 'openfreemap';
      styleReady = false;
      // Replacing the style removes the old sources. Hidden basemaps do not
      // continue downloading tiles. Track selections and camera are preserved.
      map.setStyle(next === 'osm' ? osmStyle() : blankStyle(), { diff: false });
      updateStatus();
      if (next === 'osm') return;
      function applyVectorStyle(style) {
        if (version !== styleVersion) return;
        loadingBasemap = false;
        styleReady = false;
        map.setStyle(style, { diff: false });
        updateStatus();
      }
      if (cachedVectorStyle) {
        applyVectorStyle(cachedVectorStyle);
        return;
      }
      styleRequest = new AbortController();
      fetch('https://tiles.openfreemap.org/styles/bright', {
        signal: styleRequest.signal, referrerPolicy: 'strict-origin-when-cross-origin'
      }).then(function (response) {
        if (!response.ok) throw new Error('Basemap request returned HTTP ' + response.status + '.');
        return response.json();
      }).then(function (style) {
        if (!style || style.version !== 8 || !style.sources || !Array.isArray(style.layers)) {
          throw new Error('The basemap style has an invalid format.');
        }
        cachedVectorStyle = style;
        applyVectorStyle(style);
      }).catch(function (error) {
        if (error.name === 'AbortError' || version !== styleVersion) return;
        loadingBasemap = false;
        basemapWarning = 'OpenFreeMap is unavailable. Trajectories remain visible; choose OSM streets or reload.';
        updateStatus();
        console.warn('Trajectory basemap:', error.message);
      });
    }

    function fit(bounds) {
      if (!bounds.isEmpty()) map.fitBounds(bounds, {
        padding: 42, maxZoom: 18, bearing: map.getBearing(), pitch: map.getPitch(), duration: 500
      });
    }
    function fitVisible() {
      var bounds = new maplibregl.LngLatBounds();
      entries.forEach(function (entry) {
        if (entry.checkbox.checked && !entry.bounds.isEmpty()) bounds.extend(entry.bounds);
      });
      fit(bounds);
    }
    function select(all) {
      entries.forEach(function (entry) {
        entry.checkbox.checked = !entry.checkbox.disabled &&
          (all || entry.reference || entry.name === defaultName);
      });
      emphasize();
      updateStatus();
    }
    function syncCamera() {
      var bearing = Math.round((map.getBearing() % 360 + 360) % 360) % 360;
      var pitch = Math.round(map.getPitch());
      if (controls['map-bearing']) controls['map-bearing'].value = String(bearing);
      if (controls['map-pitch']) controls['map-pitch'].value = String(pitch);
      var bearingValue = document.getElementById('map-bearing-value');
      var pitchValue = document.getElementById('map-pitch-value');
      if (bearingValue) bearingValue.textContent = bearing + '°';
      if (pitchValue) pitchValue.textContent = pitch + '°';
      if (controls['map-bearing']) controls['map-bearing'].setAttribute('aria-valuetext', bearing + ' degrees');
      if (controls['map-pitch']) controls['map-pitch'].setAttribute('aria-valuetext', pitch + ' degrees');
      if (controls['map-view-2d']) controls['map-view-2d'].setAttribute('aria-pressed', map.getPitch() < 1 ? 'true' : 'false');
      if (controls['map-view-3d']) controls['map-view-3d'].setAttribute('aria-pressed', map.getPitch() >= 1 ? 'true' : 'false');
    }
    map.on('rotate', syncCamera);
    map.on('pitch', syncCamera);
    controls['fit-reference'].addEventListener('click', function () { fit(entries[0].bounds); });
    controls['fit-visible'].addEventListener('click', fitVisible);
    controls['show-all-tracks'].addEventListener('click', function () { select(true); });
    controls['show-default-tracks'].addEventListener('click', function () { select(false); });
    if (controls['map-basemap']) controls['map-basemap'].addEventListener('change', function () {
      setBasemap(controls['map-basemap'].value);
    });
    if (controls['map-buildings']) controls['map-buildings'].addEventListener('change', updateBuildings);
    if (controls['map-view-2d']) controls['map-view-2d'].addEventListener('click', function () {
      map.easeTo({ pitch: 0, duration: 450 });
    });
    if (controls['map-view-3d']) controls['map-view-3d'].addEventListener('click', function () {
      map.easeTo({ pitch: 50, duration: 450 });
    });
    if (controls['map-bearing']) controls['map-bearing'].addEventListener('input', function () {
      map.stop();
      map.setBearing(Number(controls['map-bearing'].value));
    });
    if (controls['map-pitch']) controls['map-pitch'].addEventListener('input', function () {
      map.stop();
      map.setPitch(Number(controls['map-pitch'].value));
    });
    Object.keys(controls).forEach(function (key) { controls[key].disabled = false; });
    controls['fit-reference'].disabled = entries[0].bounds.isEmpty();
    syncCamera();
    setBasemap(basemap);

    var summary = document.getElementById('map-summary');
    if (summary) {
      var epochs = data.epochs_utc_s ? data.epochs_utc_s.length : data.gt.coords.length;
      summary.textContent = names.length + ' methods + ground truth · ' +
        epochs.toLocaleString() + ' scoring epochs';
    }
    // A responsive layout may change the canvas dimensions without a window resize.
    if (window.ResizeObserver) new ResizeObserver(function () { map.resize(); }).observe(container);
    updateStatus();
  }

  function showError(error) {
    container.setAttribute('aria-busy', 'false');
    Object.keys(controls).forEach(function (key) { controls[key].disabled = true; });
    legend.querySelectorAll('input').forEach(function (input) { input.disabled = true; });
    status.textContent = 'Interactive trajectories unavailable.';
    var message = document.createElement('div');
    message.className = 'map-error';
    var paragraph = document.createElement('p');
    paragraph.textContent = window.location.protocol === 'file:' ?
      'Open this page through a local web server to load the trajectory data. See the project README for instructions.' :
      /WebGL|graphics|context/i.test(error.message) ?
        'This interactive map needs WebGL. Enable graphics acceleration or try another browser.' :
        'The interactive map could not be loaded. Please reload the page to try again.';
    var download = document.createElement('a');
    download.href = 'data/trajectories.json';
    download.textContent = 'Open trajectory data';
    message.appendChild(paragraph);
    message.appendChild(download);
    container.replaceChildren(message);
    console.error('Trajectory viewer:', error.message);
  }

  fetch('data/trajectories.json').then(function (response) {
    if (!response.ok) throw new Error('Trajectory request returned HTTP ' + response.status + '.');
    return response.json();
  }).then(start).catch(showError);
})();
