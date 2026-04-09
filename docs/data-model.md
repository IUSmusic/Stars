# Data model

`data/atlas-v1.0.json` is the canonical dataset for the v1.0 release candidate.

```json
{
  "version": "v1.0",
  "metadata": { ... },
  "categories": [{ "id": "society", "label": "Society & Ethics", ... }],
  "nodes": [{ "id": 71, "label": "Trust", "cat": "society", ... }],
  "edges": {
    "confirmed": [{ "a": 71, "b": 73, "status": "confirmed" }],
    "possible": []
  }
}
```

The browser renderer treats `confirmed` as stable ontology and `possible` as hypothesis-layer edges.
