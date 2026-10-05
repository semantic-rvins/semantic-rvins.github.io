# SeA-RVINS introduction webpage

This repository hosts the introduction page for **SeA-RVINS: Semantic-Aware Tightly Coupled
RTK-Visual-Inertial System with Correlation-Preserving Robust Estimation for
Urban Navigation**.

**Website:** [https://semantic-rvins.github.io/](https://semantic-rvins.github.io/)

**Benchmark:** [TEX-CUP Urban-Navigation Benchmark](https://github.com/semantic-rvins/TEXCUP-UrbanNav-Benchmark) — public baseline run guides, evaluation scripts, and saved results.

The static site is in [`project-webpage/`](project-webpage/). It includes the
system and visual frontend figures, manuscript benchmark results, an interactive
trajectory viewer, and a looping visualization video.

Preview from the repository root:

```sh
python3 -m http.server 8065 --bind 127.0.0.1 --directory project-webpage
```

Open `http://127.0.0.1:8065`. See the [site README](project-webpage/README.md)
for preview and data regeneration notes.
