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

  function start(data) {
    if (!window.L) throw new Error('The map library could not be loaded.');
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

    container.replaceChildren();
    var map = L.map(container, { scrollWheelZoom: false, preferCanvas: true });
    L.control.scale({ imperial: false }).addTo(map);
    var entries = [];
    var tileWarning = false;
    var tileErrors = 0;
    var focused = null;
    var hovered = null;
    var defaultName = names.indexOf('SeA-RVINS (latent)') !== -1 ? 'SeA-RVINS (latent)' :
      names.find(function (name) { return name.indexOf('SeA-RVINS') === 0; });

    function updateStatus() {
      var count = entries.filter(function (entry) { return entry.checkbox.checked; }).length;
      status.textContent = count + ' of ' + entries.length + ' tracks visible.' +
        (tileWarning ? ' Some map tiles are unavailable. Trajectories remain visible.' : '');
      controls['fit-visible'].disabled = !entries.some(function (entry) {
        return entry.checkbox.checked && entry.bounds.isValid();
      });
    }

    function emphasize() {
      var active = hovered || focused;
      if (active && !active.checkbox.checked) active = null;
      entries.forEach(function (entry) {
        var opacity = active && active !== entry ? 0.18 : entry.opacity;
        entry.layer.eachLayer(function (layer) {
          layer.setStyle({ opacity: opacity, fillOpacity: opacity });
          if (entry.checkbox.checked) layer.bringToFront();
        });
      });
      if (active) active.layer.eachLayer(function (layer) { layer.bringToFront(); });
    }

    function addTrack(name, track, reference) {
      var color = track.color || (reference ? '#29323d' : '#0072b2');
      var width = reference ? 4.5 : 2.8;
      var opacity = reference ? 0.75 : 0.95;
      var layer = L.featureGroup();
      var points = track.coords.filter(function (point) { return point !== null; });
      segments(track).forEach(function (segment) {
        var style = { color: color, weight: width, opacity: opacity, lineJoin: 'round',
          lineCap: 'round', smoothFactor: 0, interactive: false };
        if (segment.length === 1) {
          L.circleMarker(segment[0], { color: color, radius: 2.5, weight: 1,
            fillColor: color, fillOpacity: opacity, opacity: opacity, interactive: false }).addTo(layer);
        } else {
          L.polyline(segment, style).addTo(layer);
        }
      });

      var label = document.createElement('label');
      label.className = 'track-toggle';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'trajectory-toggle-' + entries.length;
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

      var entry = { name: name, layer: layer, bounds: L.latLngBounds(points),
        checkbox: checkbox, opacity: opacity, reference: reference };
      entries.push(entry);
      if (checkbox.checked) layer.addTo(map);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) layer.addTo(map);
        else map.removeLayer(layer);
        emphasize();
        updateStatus();
      });
      label.addEventListener('mouseenter', function () { hovered = entry; emphasize(); });
      label.addEventListener('mouseleave', function () { hovered = null; emphasize(); });
      checkbox.addEventListener('focus', function () { focused = entry; emphasize(); });
      checkbox.addEventListener('blur', function () { focused = null; emphasize(); });
    }

    legend.textContent = '';
    addTrack('Ground truth', data.gt, true);
    names.forEach(function (name) { addTrack(name, data.methods[name], false); });

    function fit(bounds) {
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
    }
    function fitVisible() {
      var bounds = L.latLngBounds([]);
      entries.forEach(function (entry) {
        if (entry.checkbox.checked && entry.bounds.isValid()) bounds.extend(entry.bounds);
      });
      fit(bounds);
    }
    function select(all) {
      entries.forEach(function (entry) {
        entry.checkbox.checked = !entry.checkbox.disabled &&
          (all || entry.reference || entry.name === defaultName);
        if (entry.checkbox.checked) entry.layer.addTo(map);
        else map.removeLayer(entry.layer);
      });
      emphasize();
      updateStatus();
    }

    controls['fit-reference'].addEventListener('click', function () { fit(entries[0].bounds); });
    controls['fit-visible'].addEventListener('click', fitVisible);
    controls['show-all-tracks'].addEventListener('click', function () { select(true); });
    controls['show-default-tracks'].addEventListener('click', function () { select(false); });
    Object.keys(controls).forEach(function (key) { controls[key].disabled = false; });
    controls['fit-reference'].disabled = !entries[0].bounds.isValid();

    // Starting with the reference extent keeps the route readable. Fit visible
    // tracks includes every selected coordinate, including distant estimates.
    if (entries[0].bounds.isValid()) fit(entries[0].bounds);
    else if (entries.some(function (entry) { return entry.checkbox.checked && entry.bounds.isValid(); })) fitVisible();
    else map.setView(data.center || [0, 0], 2);

    // OSM requires a valid Referer; send the site origin without the page path.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).on('loading', function () { tileErrors = 0; })
      .on('tileerror', function () { tileErrors += 1; tileWarning = true; updateStatus(); })
      .on('load', function () { tileWarning = tileErrors > 0; updateStatus(); })
      .addTo(map);

    var summary = document.getElementById('map-summary');
    if (summary) {
      var epochs = data.epochs_utc_s ? data.epochs_utc_s.length : data.gt.coords.length;
      summary.textContent = names.length + ' methods + ground truth · ' +
        epochs.toLocaleString() + ' scoring epochs';
    }
    container.setAttribute('aria-busy', 'false');
    updateStatus();
  }

  function showError(error) {
    container.setAttribute('aria-busy', 'false');
    Object.keys(controls).forEach(function (key) { controls[key].disabled = true; });
    status.textContent = 'Interactive trajectories unavailable.';
    var message = document.createElement('div');
    message.className = 'map-error';
    var paragraph = document.createElement('p');
    paragraph.textContent = window.location.protocol === 'file:' ?
      'Open this page through a local web server to load the trajectory data. See the project README for instructions.' :
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
