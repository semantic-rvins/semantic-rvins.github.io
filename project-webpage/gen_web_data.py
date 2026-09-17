#!/usr/bin/env python3
"""Export the final benchmark's selected antenna trajectories for the review map.

Python 3.9+; no third-party packages required. From any working directory:
    python /path/to/project-webpage/gen_web_data.py --results /path/to/results/final
    python /path/to/project-webpage/gen_web_data.py --check

The default input is the sibling urban-navigation-benchmark/results/final folder.
The final collection's comparison, protocol and table selections are authoritative.
Every output point corresponds to a scoring epoch; missing estimates remain null.
Actual matched timestamps and segment boundaries prevent joining missing intervals.
Coordinates are WGS84 antenna positions, not approximations reconstructed from errors.
Only filenames and content hashes are published as provenance, never local run paths.
"""

import argparse
from bisect import bisect_left
import csv
import hashlib
import json
import math
from pathlib import Path


HERE = Path(__file__).resolve().parent
DEFAULT_RESULTS = HERE.parent.parent / "urban-navigation-benchmark/results/final"
A = 6378137.0
E2 = 6.69437999014e-3
GAP_S = 1.5
COLORS = {
    "RTKLIB": "#D55E00",
    "GICI-RTK": "#0072B2",
    "GICI-RRR": "#56B4E9",
    "VINS-Fusion": "#CC79A7",
    "IC-GVINS": "#AA4499",
    "GVINS": "#A6761D",
    "SeA-RVINS-batch-robust": "#009E73",
    "SeA-RVINS-latent-robust": "#008C95",
    "SeA-RVINS-scalar-robust": "#7A9E20",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def seconds(clock):
    hour, minute, second = map(float, clock.split(":"))
    require(0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60,
            "Invalid UTC time")
    return hour * 3600 + minute * 60 + second


def lla_to_ecef(lla):
    lat, lon, height = lla
    lat, lon = math.radians(lat), math.radians(lon)
    n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    return ((n + height) * math.cos(lat) * math.cos(lon),
            (n + height) * math.cos(lat) * math.sin(lon),
            (n * (1 - E2) + height) * math.sin(lat))


def ecef_to_lla(xyz):
    """Iterative WGS84 conversion, retaining full floating-point precision."""
    x, y, z = xyz
    p = math.hypot(x, y)
    if p < 1e-8:
        require(abs(z) > 1, "Undefined geodetic position at the Earth center")
        return (math.copysign(90.0, z), 0.0, abs(z) - A * math.sqrt(1 - E2))
    lat = math.atan2(z, p * (1 - E2))
    for _ in range(20):
        n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
        update = math.atan2(z + E2 * n * math.sin(lat), p)
        if abs(update - lat) < 1e-15:
            lat = update
            break
        lat = update
    n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    height = p / math.cos(lat) - n
    result = (math.degrees(lat), math.degrees(math.atan2(y, x)), height)
    require(math.dist(lla_to_ecef(result), xyz) < 1e-5,
            "ECEF-to-geodetic round-trip exceeded 0.01 mm")
    return result


def increasing_finite(times, label):
    require(all(math.isfinite(t) for t in times), f"{label}: nonfinite timestamps")
    require(all(a < b for a, b in zip(times, times[1:])),
            f"{label}: timestamps must be strictly increasing")


def load_gt(path, date):
    times, coordinates = [], []
    # This original sensor log contains a non-UTF-8 character in a comment.
    with path.open(encoding="utf-8", errors="replace") as source:
        for line in source:
            values = line.split()
            if not values or values[0].startswith("#"):
                continue
            require(len(values) >= 6 and values[0].replace("/", "-") == date,
                    "Ground truth date or row format differs from the protocol")
            times.append(seconds(values[1]))
            coordinates.append(tuple(map(float, values[3:6])))
    increasing_finite(times, path.name)
    require(times and all(all(math.isfinite(v) for v in p) for p in coordinates),
            "Ground truth must contain finite coordinates")
    return times, coordinates


def load_estimates(path):
    times, lla, ecef = [], [], []
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        is_ecef = "ecef_x" in (reader.fieldnames or [])
        fields = ("ecef_x", "ecef_y", "ecef_z") if is_ecef else ("lat_deg", "lon_deg", "h_ell")
        require({"utc_sec", *fields}.issubset(reader.fieldnames or []),
                f"{path.name}: missing coordinate columns")
        for row in reader:
            times.append(float(row["utc_sec"]))
            coordinate = tuple(float(row[key]) for key in fields)
            require(all(math.isfinite(value) for value in coordinate),
                    f"{path.name}: nonfinite position")
            lla.append(ecef_to_lla(coordinate) if is_ecef else coordinate)
            ecef.append(coordinate if is_ecef else lla_to_ecef(coordinate))
    increasing_finite(times, path.name)
    return times, lla, ecef


def nearest_index(times, epoch):
    """Match evaluator tie-breaking: select the later sample at equal distance."""
    if not times:
        return None
    right = min(bisect_left(times, epoch), len(times) - 1)
    left = max(right - 1, 0)
    return right if abs(times[right] - epoch) <= abs(times[left] - epoch) else left


def segment_starts(samples):
    return [i for i, value in enumerate(samples) if value is not None and
            (i == 0 or samples[i - 1] is None or value - samples[i - 1] > GAP_S)]


def interpolate(times, positions, time):
    right = bisect_left(times, time)
    if right == 0:
        return positions[0]
    if right == len(times):
        return positions[-1]
    left = right - 1
    ratio = (time - times[left]) / (times[right] - times[left])
    return tuple(a + ratio * (b - a) for a, b in zip(positions[left], positions[right]))


def validate_errors(path, epochs, chosen, times, ecef, gt_times, gt_ecef, gt_origin, cutoff):
    """Cross-check each displayed position against the saved scoring result."""
    with path.open(newline="", encoding="utf-8") as source:
        errors = list(csv.DictReader(source))
    require(len(errors) == len(epochs), f"{path.name}: wrong evaluation grid length")
    lat, lon = map(math.radians, gt_origin[:2])
    sin_lat, cos_lat, sin_lon, cos_lon = math.sin(lat), math.cos(lat), math.sin(lon), math.cos(lon)
    for epoch, index, row in zip(epochs, chosen, errors):
        require(float(row["utc_sec"]) == epoch, f"{path.name}: wrong evaluation epoch")
        h, v = float(row["hor_err_m(nan=no solution)"]), float(row["ver_err_m"])
        solved = math.isfinite(h) and math.isfinite(v) and (cutoff is None or epoch < cutoff)
        require(solved == (index is not None), f"{path.name}: map and scoring gaps disagree at {epoch}")
        if index is None:
            continue
        reference = interpolate(gt_times, gt_ecef, times[index])
        dx, dy, dz = (a - b for a, b in zip(ecef[index], reference))
        east = -sin_lon * dx + cos_lon * dy
        north = -sin_lat * cos_lon * dx - sin_lat * sin_lon * dy + cos_lat * dz
        up = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz
        require(abs(math.hypot(east, north) - h) < 1e-6 and abs(abs(up) - v) < 1e-6,
                f"{path.name}: exported position does not reproduce the saved error at {epoch}")


def export(results):
    comparison = read_json(results / "comparison.json")
    manifest = read_json(results / "manifest.json")
    statistics = read_json(results / "statistics.json")
    selections_path = results / "table_selections.json"
    selections = read_json(selections_path) if selections_path.exists() else {}
    protocol = statistics["protocol"]
    require(protocol == manifest["protocol"], "Statistics and manifest protocols disagree")
    require(comparison == statistics["comparison"], "Statistics and comparison methods disagree")
    require(selections == statistics.get("table_selections", {}), "Statistics and table selections disagree")
    start, end = seconds(protocol["start_utc"]), seconds(protocol["end_utc"])
    tolerance = protocol["match_tolerance_s"]
    gt_file = results / "ground_truth.log"
    require(digest(gt_file) == manifest["ground_truth_sha256"], "Ground truth differs from the final collection")
    gt_times, gt_lla = load_gt(gt_file, protocol["date_utc"])
    gt_ecef = [lla_to_ecef(p) for p in gt_lla]
    grid_indexes = [i for i, t in enumerate(gt_times) if start <= t <= end]
    epochs = [gt_times[i] for i in grid_indexes]
    require(len(epochs) == protocol["n_window"] and epochs == list(range(int(start), int(end) + 1)),
            "Expected the complete inclusive 1 Hz evaluation grid")
    gt_coords = [list(gt_lla[i][:2]) for i in grid_indexes]
    gt = {"color": "#334155", "coords": gt_coords, "sample_utc_s": epochs,
          "height_ellipsoid_m": [gt_lla[i][2] for i in grid_indexes],
          "segment_starts": [0], "reference": "TEX-CUP antenna 2 / ALT1"}
    methods, order = {}, []
    source_files = ["comparison.json", "manifest.json", "statistics.json", "ground_truth.log"]
    if selections_path.exists():
        source_files.append("table_selections.json")
    ids = [entry["id"] for entry in comparison["methods"]]
    require(ids and len(ids) == len(set(ids)), "Comparison requires unique method IDs")
    for entry in comparison["methods"]:
        method, label = entry["id"], entry["label"]
        require(method.replace("-", "").replace("_", "").isalnum(), "Invalid method ID")
        require(label not in methods, "Comparison requires unique display labels")
        est_file = results / f"{method}.est.csv"
        sha = digest(est_file)
        record = manifest["methods"][method]
        require(sha == record["trajectory_sha256"], f"{method}: trajectory differs from final manifest")
        times, lla, ecef = load_estimates(est_file)
        require(len(times) == record["trajectory_rows"], f"{method}: source row count differs")
        # Match the evaluator: crop source samples before nearest-epoch matching.
        retained = [i for i, t in enumerate(times) if start <= t <= end and gt_times[0] <= t <= gt_times[-1]]
        times, lla, ecef = ([values[i] for i in retained] for values in (times, lla, ecef))
        selection = selections.get(method)
        cutoff = seconds(selection["end_utc_exclusive"]) if selection else None
        if selection:
            require(selection["trajectory_sha256"] == sha, f"{method}: selection is for another trajectory")
            require(start < cutoff <= end + 1, f"{method}: cutoff is outside the evaluation window")
        chosen = []
        for epoch in epochs:
            index = nearest_index(times, epoch)
            if (index is None or abs(times[index] - epoch) > tolerance or
                    (cutoff is not None and epoch >= cutoff)):
                index = None
            chosen.append(index)
        errors_file = results / f"{method}.errors.csv"
        validate_errors(errors_file, epochs, chosen, times, ecef, gt_times, gt_ecef, gt_lla[0], cutoff)
        stats = statistics["methods"][method]
        n_solved = sum(index is not None for index in chosen)
        require(n_solved == stats["n_solved"] and stats["n_window"] == len(epochs),
                f"{method}: displayed availability differs from the selected statistics")
        samples = [times[i] if i is not None else None for i in chosen]
        track = {"id": method, "color": COLORS.get(method, "#6366F1"),
                 "status": statistics["statuses"][method], "stats": stats,
                 "coords": [list(lla[i][:2]) if i is not None else None for i in chosen],
                 "height_ellipsoid_m": [lla[i][2] if i is not None else None for i in chosen],
                 "sample_utc_s": samples, "segment_starts": segment_starts(samples),
                 "source": {"trajectory": est_file.name, "trajectory_sha256": sha,
                            "trajectory_rows": record["trajectory_rows"]}}
        if selection:
            track["selection"] = selection
        methods[label] = track
        order.append(label)
        source_files.extend([est_file.name, errors_file.name])
    return {"schema_version": 2, "center": [sum(p[i] for p in gt_coords) / len(gt_coords) for i in (0, 1)],
            "step_s": 1, "protocol": protocol, "epochs_utc_s": epochs,
            "coordinate_reference": "WGS84 geodetic latitude/longitude; TEX-CUP antenna 2 / ALT1",
            "gap_policy": {"missing_epoch": "null", "max_connected_sample_gap_s": GAP_S,
                           "segment_starts": "Indices that begin separate polylines; never connect across these boundaries"},
            "provenance": {"collection": "final benchmark results",
                           "files_sha256": {name: digest(results / name) for name in source_files}},
            "order": order, "gt": gt, "methods": methods}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS, help="Final benchmark collection directory")
    parser.add_argument("--output", type=Path, default=HERE / "data/trajectories.json", help="Output JSON file")
    parser.add_argument("--check", action="store_true", help="Validate sources and check that output is current; do not write")
    args = parser.parse_args()
    try:
        data = export(args.results.expanduser())
        serialized = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
        output = args.output.expanduser()
        if args.check:
            require(output.read_text(encoding="utf-8") == serialized, "Output is stale; rerun without --check")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(serialized, encoding="utf-8")
        for label, track in data["methods"].items():
            print(f'{label}: {track["stats"]["n_solved"]}/{data["protocol"]["n_window"]} epochs, '
                  f'{len(track["segment_starts"])} segments')
        print(f'{"Verified" if args.check else "Wrote"} {output.name}: {len(serialized.encode("utf-8")):,} bytes')
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Export failed: {error}\n")


if __name__ == "__main__":
    main()
