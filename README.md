# SeA-RVINS review supplement

Anonymous companion website for **SeA-RVINS: Semantic-Aware Tightly Coupled
RTK-Visual-Inertial System with Correlation-Preserving Robust Estimation for
Urban Navigation**.

The static site is in [`project-webpage/`](project-webpage/). It includes the
system and visual frontend figures, manuscript benchmark results, and an
interactive trajectory viewer.

Preview from the repository root:

```sh
python3 -m http.server 8065 --bind 127.0.0.1 --directory project-webpage
```

Open `http://127.0.0.1:8065`. See the [site README](project-webpage/README.md)
for data regeneration and publication notes.
