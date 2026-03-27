# Project Stars

**Project Stars** is a browser-native research graph for exploring concepts as a network of ideas, references, and reviewable relationships.
It is implemented as a **single static HTML application** with embedded CSS and JavaScript, so it can be hosted directly on GitHub Pages or any static web server.

The system is designed for students who want to study how a graph-based knowledge interface can combine:

- human-curated concepts,
- explicit provenance,
- layered relationships,
- reviewable inference,
- and scientific-style visual interaction.

---

## 1. Purpose

Project Stars treats a conceptual map as a **research object**, not just a visual toy.
Each node is intended to represent a concept, theme, or thought with supporting description and references.
Each relationship is intended to carry a reason for existing.

The core design principle is:

> **A graph may suggest candidate relationships, but only human review may confirm them.**

That principle appears throughout the data model, scoring layer, rendering logic, and export schema.

---

## 2. Repository layout

This build is intentionally minimal.

```text
.
├── index.html                  # main single-file application
├── README.md                   # technical documentation
├── LICENSE                     # copyright and license terms
└── THIRD_PARTY_NOTICES.md      # external services, fonts, and ownership notes
```

In the delivered bundle, the main application may also appear as `index%20%285%29.html` until you rename it to `index.html` for publishing.

---

## 3. Runtime architecture

Project Stars uses a **zero-build, client-side architecture**:

1. **HTML** defines the application shell and interface controls.
2. **CSS** defines the visual language, panel system, typography, and responsive behavior.
3. **JavaScript** manages:
   - graph state,
   - force layout,
   - layered edge logic,
   - candidate-link scoring,
   - canvas rendering,
   - detail-panel population,
   - search and filter state,
   - JSON export.

### 3.1 Rendering surfaces

The app uses multiple canvases:

- `#bg` for the star field and wave background,
- `#graph` for graph rendering and interaction,
- `#minimap` for overview navigation.

This separation improves clarity because the decorative background and the interactive graph do not compete for the same drawing pass.

### 3.2 UI layers

The interface is composed of:

- a header and node count,
- a research HUD,
- a search bar,
- category filters,
- zoom and navigation controls,
- a detail inspector,
- a tooltip system,
- an add-thought modal,
- an export action.

---

## 4. Data model

The graph is built from three main structures:

- `CATEGORIES`
- `SEED_NODES`
- `SEED_EDGES`

### 4.1 Categories

Categories provide domain-level grouping.
Each category includes:

- `id`
- `label`
- `color`
- `glow`

These values are used both semantically and visually.

### 4.2 Nodes

Each node represents a concept.
Typical node fields include:

- `id`
- `label`
- `cat`
- `desc`
- `ref`
- `r` (node radius)
- `evidence`
- `consensus`
- `sourceType`
- `reviewState`
- `provenance`
- layout state such as `x`, `y`, `vx`, `vy`, `pinned`, `alpha`, `visible`

### 4.3 Edges

Edges are objects created through `createEdge(a, b, overrides)`.
This is one of the most important architectural points in the project.

Each edge can store:

- `relation`
- `status`
- `confidence`
- `basis`
- `notes`
- `rationale`
- `citations`
- `evidenceClass`
- `consensus`
- `provenance`
- `review`
- `scoreComponents`

This means the graph stores **relationships as evidence-bearing objects**, not just line segments.

---

## 5. Two-layer relationship model

Project Stars keeps **two distinct relationship layers**.

### 5.1 Confirmed relationships

Confirmed relationships are the accepted, reviewed layer.
They are rendered as normal solid edges and are the only edges that directly shape the force-layout spring system.

Confirmed links are intended to represent relationships that have already been curated, checked, or otherwise accepted by a reviewer.

### 5.2 Possible relationships

Possible relationships are candidate links.
They are:

- rendered as faint dashed edges,
- kept visually subordinate to confirmed links,
- surfaced for review,
- never auto-promoted to confirmed.

When a node is selected, the system reveals labels only for **possible related thoughts**, not for confirmed ones.
That design keeps the stable structure readable while making uncertain inferences inspectable.

This separation is pedagogically useful because it teaches students an important lesson in knowledge systems:

> **inference is not the same thing as evidence acceptance.**

---

## 6. Candidate-link inference

Candidate links are recomputed through `recomputeCandidateEdges()`.
The process is deterministic and based on graph content already in the system.
It does **not** generate random suggestions.

### 6.1 Signal extraction

The function `computeNodeSignals(node)` derives reusable signals from:

- the node label,
- the description,
- the reference field.

It computes:

- `tokenSet`
- `refSet`
- `topicSet`
- `yearAvg`

### 6.2 Scoring features

The candidate score is built from the following features:

- semantic similarity,
- citation overlap,
- shared topics,
- shared confirmed neighbors,
- ontology/domain match,
- recency weight.

In the current implementation, the composite score is:

```text
score =
  semanticSimilarity * 0.28 +
  citationOverlap    * 0.24 +
  sharedTopics       * 0.18 +
  sharedNeighbors    * 0.16 +
  ontologyMatch      * 0.09 +
  recencyWeight      * 0.05
```

### 6.3 Thresholding

Only candidate edges scoring above the configured threshold are kept.
In this build:

```text
CANDIDATE_THRESHOLD = 0.46
```

This thresholding is important because it prevents the interface from filling with speculative noise.

### 6.4 Candidate metadata

Every candidate edge preserves the logic that produced it.
That includes:

- score components,
- basis strings,
- provenance,
- review state,
- confidence,
- rationale text.

This is a good example of **explainable graph inference**.
The system does not only say *that* a candidate exists; it stores *why* it exists.

---

## 7. Force-layout behavior

The layout engine is a lightweight custom force simulation.

### 7.1 Motion model

Nodes have:

- position: `x`, `y`
- velocity: `vx`, `vy`
- optional pinning

Each animation tick applies:

- repulsion between nodes,
- a weak gravity term pulling the graph inward,
- damping to reduce instability,
- spring attraction on **confirmed** edges only.

### 7.2 Why confirmed edges drive the springs

Only confirmed edges contribute to spring constraints.
This is a deliberate modeling decision.
If candidate edges also controlled the layout strongly, uncertain hypotheses could distort the perceived structure of the graph.

This preserves a useful distinction:

- **confirmed edges** shape the map,
- **possible edges** annotate the map.

---

## 8. Visual encoding

The interface uses visual hierarchy to separate certainty levels.

### 8.1 Nodes

Nodes are colored by category.
Size is encoded through each node radius.
Selection, hover, and filtering affect emphasis.

### 8.2 Edges

- **confirmed edges**: solid, normal visibility
- **possible edges**: faint, dashed
- **selected possible edges**: slightly stronger opacity than non-selected candidates

### 8.3 Labels

By default, the graph remains visually quiet.
When a node is selected, labels appear only for candidate neighbors, and those labels are intentionally faint.

This reduces clutter while still exposing uncertain nearby structure.

---

## 9. Wave background

The animated background is not purely decorative.
It is designed to evoke:

- oscillation,
- field behavior,
- propagation,
- emergence,
- resonance,
- disturbance.

The wave field is drawn on the background canvas using sinusoidal variation.
If a node is selected, the selected node acts as a local disturbance source, producing a decaying ripple-like term in the field.

Conceptually, this visual metaphor supports the product’s framing:

- ideas are not isolated points,
- they propagate through fields of relation,
- local events affect surrounding structure.

---

## 10. Inspector and review surface

The detail panel is the main explanatory interface.
For a selected node it shows:

- domain,
- confirmed degree,
- evidence class,
- consensus label,
- review state,
- candidate count,
- description,
- references,
- confirmed connections,
- possible related thoughts,
- relationship notes.

This supports both exploration and curation.
The user can see not just neighboring concepts, but also the epistemic status of those relationships.

---

## 11. Add-thought workflow

The add-thought modal allows new node creation without a backend.
A user can enter:

- concept name,
- description,
- scientific reference,
- domain,
- evidence class,
- consensus/confidence,
- an optional node to connect to,
- relationship type,
- edge rationale,
- edge citations/provenance,
- review metadata.

If a valid target node is given, the app creates a **confirmed** edge using the supplied rationale and citations.
After a node is added, candidate edges are recomputed.

This makes the app a **curation tool**, not just a viewer.

---

## 12. Search, filter, and navigation

The app supports multiple navigation modes:

- **Constellation view** for a global overview,
- **Domain view** for grouped domain inspection,
- **Focus view** for local examination.

Additional interaction features:

- text search across labels, descriptions, and references,
- domain filter chips,
- zoom in/out,
- fit-to-graph,
- home reset,
- draggable minimap,
- pause/resume,
- manual rearrangement.

Keyboard support includes:

- `/` for search focus,
- `f` for fit,
- `h` for home,
- `v` to cycle view mode,
- `Escape` to close interaction states.

---

## 13. Export schema

Export produces JSON containing:

- metadata,
- integration configuration,
- categories,
- nodes,
- edges.

The exported schema preserves relationship-layer semantics.
This is important for downstream research use because the export does not flatten confirmed and candidate relationships into one undifferentiated adjacency list.

### 13.1 Export metadata

The export includes fields such as:

- title,
- export timestamp,
- node count,
- edge count,
- domain count,
- schema version,
- a note describing the confirmed/candidate policy.

### 13.2 Why this matters

A useful research export must preserve:

- provenance,
- uncertainty,
- review state,
- rationale,
- edge type,
- score components.

Without those, a graph is visually attractive but scientifically weak.

---

## 14. External research-source layer

The current build defines an external-source integration layer through `EXTERNAL_SOURCES`.
It models four scholarly or knowledge sources:

- OpenAlex
- Crossref
- Semantic Scholar
- Wikidata

The purpose of this layer is to support future or parallel workflows such as:

- citation overlap,
- DOI and metadata resolution,
- author-neighborhood analysis,
- recommendation expansion,
- ontology/entity matching.

### 14.1 What is implemented in this build

In the current static build, the source layer is represented in the schema and export metadata, and candidate scoring is designed around the kinds of features these sources can support.

### 14.2 What students should learn from this design

This is a common pattern in research software:

1. define the ontology and evidence model first,
2. define the scoring and review policy second,
3. connect live data providers only after the internal semantics are stable.

That order reduces technical debt.

---

## 15. Research foundations behind the design

The candidate-link layer is not arbitrary.
Its design follows common families of research signals used in knowledge graphs, bibliometrics, information retrieval, and recommendation systems.

### 15.1 Citation overlap and bibliographic structure

Two classic ideas are especially relevant:

- **bibliographic coupling**: two works are related because they cite similar prior work,
- **co-citation**: two works are related because later work cites them together.

These ideas motivate citation-neighborhood overlap as a sensible signal for candidate relationships.

### 15.2 Semantic similarity

If two concepts use similar vocabulary across labels, descriptions, and reference text, they are more likely to be conceptually adjacent.
This is a basic but effective retrieval signal.

### 15.3 Shared-neighbor structure

In graph analysis, shared-neighbor and local-structure features are standard building blocks for link prediction.
If two nodes connect to similar confirmed neighbors, they may plausibly deserve review as a candidate relation.

### 15.4 Ontology alignment

When concepts share a domain or match related entities/topics, the graph gains a second layer of evidence beyond raw text overlap.
This helps prevent purely lexical matching from dominating the model.

### 15.5 Human review as a hard boundary

A scoring model can rank and surface candidates, but it should not silently convert them into facts.
That is why candidate links remain a separate layer.

---

## 16. References and research background

The following references are relevant to the ideas implemented or modeled in Project Stars.
They are included to help students connect the interface design to broader technical literature.

### Graphs, networks, and layout

- Fruchterman, T. M. J., & Reingold, E. M. (1991). *Graph drawing by force-directed placement*.
- Ware, C. (2012). *Information Visualization: Perception for Design*.

### Link prediction and graph inference

- Liben-Nowell, D., & Kleinberg, J. (2007). *The link-prediction problem for social networks*.
- Lü, L., & Zhou, T. (2011). *Link prediction in complex networks: A survey*.

### Citation structure and bibliometrics

- Kessler, M. M. (1963). *Bibliographic coupling between scientific papers*.
- Small, H. (1973). *Co-citation in the scientific literature: A new measure of the relationship between two documents*.

### Similarity and retrieval

- Jaccard, P. (1901). *Étude comparative de la distribution florale dans une portion des Alpes et des Jura*.
- Manning, C. D., Raghavan, P., & Schütze, H. (2008). *Introduction to Information Retrieval*.

### Ontology matching

- Euzenat, J., & Shvaiko, P. (2013). *Ontology Matching*.

### Human-centered knowledge systems

- Norman, D. A. (2013). *The Design of Everyday Things*.
- Munzner, T. (2014). *Visualization Analysis and Design*.

---

## 17. Official external-source references

These are the main public documentation sources relevant to the external research layer modeled in this project.

- OpenAlex API documentation: <https://developers.openalex.org/>
- OpenAlex API overview: <https://developers.openalex.org/api-reference/introduction>
- OpenAlex works schema: <https://developers.openalex.org/api-reference/works>
- OpenAlex authors schema: <https://developers.openalex.org/api-reference/authors>
- Crossref REST API documentation: <https://www.crossref.org/documentation/retrieve-metadata/rest-api/>
- Crossref REST API tips: <https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/>
- Semantic Scholar API overview: <https://www.semanticscholar.org/product/api>
- Semantic Scholar Academic Graph API docs: <https://api.semanticscholar.org/api-docs/>
- Semantic Scholar Recommendations API docs: <https://api.semanticscholar.org/api-docs/recommendations>
- Wikidata data access overview: <https://www.wikidata.org/wiki/Wikidata:Data_access>
- Wikidata Query Service: <https://query.wikidata.org/>
- Wikidata SPARQL tutorial: <https://www.wikidata.org/wiki/Wikidata:SPARQL_tutorial>

---

## 18. Limitations

Students should understand the limits of this implementation.

1. The app is client-side only.
   There is no persistence layer other than export.

2. The force simulation is intentionally lightweight.
   It is appropriate for modest graphs, not very large-scale knowledge graphs.

3. Token-based similarity is understandable and explainable, but not state-of-the-art semantic retrieval.

4. Candidate edges are only as good as the quality of the underlying text and references.

5. The current build prioritizes interpretability over automation.

These are not flaws by themselves.
They are engineering trade-offs.

---

## 19. Deployment

Because the project is static, deployment is simple.

### GitHub Pages

1. Rename the main file to `index.html`.
2. Commit `index.html`, `README.md`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`.
3. Push to your repository.
4. Enable GitHub Pages from the repository settings.

### Local use

You can also open the file directly in a browser.
For best results, use a modern Chromium- or Firefox-based browser.

---

## 20. Copyright

Unless otherwise stated for third-party materials, services, or marks:

**Copyright (c) 2026 Pezhman Farhangi**

See `LICENSE` for the governing terms and `THIRD_PARTY_NOTICES.md` for important ownership boundaries regarding external services and assets.
