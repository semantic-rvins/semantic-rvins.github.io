# SeA-RVINS anonymous review supplement

Static companion page for **SeA-RVINS: Semantic-Aware Tightly Coupled
RTK-Visual-Inertial System with Correlation-Preserving Robust Estimation for
Urban Navigation**.

The page contains the system architecture, learned stereo frontend, horizontal
results from manuscript Table I, the IAR summary from Table II, and interactive
antenna trajectories. Author information, publication links, and identifying
repository links are intentionally absent. Benchmark setup and reproduction
instructions, two remaining baseline trajectories, and the 3D video are pending.

## Preview

From this directory:

```sh
python3 -m http.server 8065 --bind 127.0.0.1
```

Open `http://127.0.0.1:8065`. Use HTTP rather than opening `index.html` directly;
the map fetches its JSON data. MapLibre GL JS 5.20.0 is bundled locally. Hosted
OpenFreeMap styles, fonts, sprites, and map tiles require internet access; the
tables, figures, and track data are local. No building dataset or API key is
needed. The map requires a browser with WebGL support.

The optional OSM streets basemap requires a valid HTTP Referer. Keep the page
referrer policy set to `strict-origin-when-cross-origin`, which sends only the
site origin to the tile server, and use the canonical
`https://tile.openstreetmap.org/{z}/{x}/{y}.png` endpoint. Do not suppress the
Referer header when anonymizing the page. Browser caching remains enabled.

## Map controls

- **Map:** OpenFreeMap with OSM buildings (default), or the OSM streets basemap.
- **2D / 3D:** switch between an overhead camera and a tilted view.
- **3D buildings:** independently show or hide extruded buildings on OpenFreeMap.
- **Heading / Tilt:** adjust camera orientation; controls follow rotation gestures.
- Two-finger trackpad scrolling and pinch gestures zoom while over the map.
  Drag to pan; right-drag to rotate/tilt. Touchscreens also support pinch,
  two-finger rotation, and two-finger pitch gestures.
- Method selections persist when changing basemap or camera settings.

Building height is visual context only; trajectories show their horizontal
positions on the map plane. Antenna ellipsoid heights are not used as building-
relative trajectory altitude. No route points or gaps are changed for rendering.
OpenFreeMap/OpenMapTiles/OSM attribution remains visible in the map.

## Files

- `index.html` and `style.css`: responsive anonymous supplement and paper tables.
- `app.js`: MapLibre viewer, building/camera controls, and trajectory comparison.
- `assets/system_diagram.png`: latest corrected system architecture.
- `assets/vision_frontend.png`: current manuscript stereo frontend figure.
- `data/trajectories.json`: ground truth plus the nine available final method tracks.
- `gen_web_data.py`: portable trajectory export from the final benchmark directory.
- `vendor/maplibre-gl.js`, `vendor/maplibre-gl.css`, `vendor/maplibre-LICENSE.txt`:
  pinned MapLibre GL JS 5.20.0 distribution and BSD license from the npm package.

## Update the trajectories

With the benchmark repository next to this repository:

```sh
python3 gen_web_data.py --results ../../urban-navigation-benchmark/results/final
```

The exporter reads `comparison.json`, `table_selections.json`, the final
trajectories, and the final antenna-2 / ALT1 ground truth. The evaluation window
is May 9, 2019, 18:09:40–19:16:59 UTC inclusive: 4,040 epochs at 1 Hz. Missing
solutions remain gaps; finite outliers within each reporting interval are
retained. IC-GVINS uses only the selected prefix before 18:35:00 UTC, matching
the combined final statistics. Threshold percentages use the entire evaluation
window. The map initially shows ground truth and SeA-RVINS (latent).

InGVIO and OKVIS2-X metrics are transcribed from the manuscript, but their
trajectories are deliberately not included until the final files are available.
The manuscript tables are static: verify them against the current paper when
updating results. The batch label refers to batch-wise robust weighting within
the fixed-lag estimator, not an offline full-route solution.

## Publication

Serve the contents of this directory as the site root. This revision does not
publish or deploy the site. Keep author information, personal source paths,
identifying external links, and source PDFs out of the anonymous web bundle.
Search indexing is discouraged through `noindex, nofollow` metadata.
