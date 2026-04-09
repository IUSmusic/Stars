# Evaluation protocol

The packaged evaluation suite covers three lightweight benchmark families:

1. Candidate-link ranking against `data/candidates-groundtruth.json`
2. Scenario stability under shock (50 seeded perturbation trials)
3. Balanced-vs-world structural comparison under the exported scenario presets

These metrics are implemented in `js/evaluator.js` as reproducible offline proxies aligned with the app's conceptual claims. They are designed to be extended, not treated as the final statistical story for publication.
