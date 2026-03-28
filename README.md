# Project Stars

https://iusmusic.github.io/stars/

**Project Stars** is a browser-native research graph for modeling thoughts, concepts, and references as a hybrid geometric, relational, and dynamical system.

It is designed as a research-facing interface for studying how conceptual structures can be represented at the same time as:

- structured objects with attributes and provenance,
- nodes in a reviewed and reviewable graph,
- points in a semantic space,
- elements in a dynamic layout,
- and local sources in a continuous activation field.


Added

- Math overlay toggle added.
- Candidate edge inspector on hover 
- Export as mathematical object

## 1. Abstract

Project Stars formalizes thoughts as attributed objects embedded in a semantic space and linked through two distinct relation layers:

1. a **confirmed layer** of reviewed structural relations
2. a **candidate layer** of explainable but unconfirmed hypotheses

The system couples these layers to:

- a deterministic candidate-link scoring function,
- a force-driven visual embedding defined by confirmed structure,
- and a field-like background representation of activation and propagation.

This produces a research graph in which:

- nodes are evidence-bearing thought objects,
- edges are typed, provenance-aware relation objects,
- candidate links come from explicit signals rather than randomness,
- and visualization is treated as a dynamic embedding of the graph rather than the graph itself.

## 2. Research framing

Project Stars studies a central question:

> How can thoughts be represented as mathematically structured objects inside a research graph that preserves provenance, uncertainty, review state, and interpretable inference?

The system takes the view that a thought is not just a label or note. A thought is a structured object with:

- semantic content,
- ontology placement,
- evidence and provenance,
- graph relationships,
- and visual or dynamical behavior.

## 3. Formal model

The full system can be described as:

`M = (Theta, A, d, Rc, Rp, S, p(t), phi)`

Where:

- `Theta` = the set of thoughts
- `A` = the attribute structure carried by each thought
- `d` = a multi-part similarity or distance structure
- `Rc` = the set of confirmed relations
- `Rp` = the set of candidate relations
- `S` = the candidate-link scoring function
- `p(t)` = the time-dependent visual embedding into the display plane
- `phi` = a continuous activation or wave field over the visual space

This is intentionally a hybrid model. It is not only a graph, not only a metric space, and not only a simulation. It combines:

- an attributed object space,
- a layered graph,
- an epistemic model of review status,
- a dynamic layout process,
- and a field-based activation layer.

## 4. Thought objects

Let `Theta` be the set of all thoughts or concepts in the system.

Each thought `theta` is modeled as:

`theta = (L, D, e, C, M)`

Where:

- `L(theta)` = label
- `D(theta)` = description
- `e(theta)` = semantic embedding vector
- `C(theta)` = category or ontology class
- `M(theta)` = metadata bundle

The metadata bundle includes things already present in the node schema, such as:

- references,
- provenance,
- evidence class,
- consensus,
- review state,
- source type,
- and layout state.

In implementation terms, the current node model already approximates this through fields such as:

- `id`
- `label`
- `cat`
- `desc`
- `ref`
- `evidence`
- `consensus`
- `sourceType`
- `reviewState`
- `provenance`
- `x`, `y`, `vx`, `vy`
- `pinned`, `alpha`, `visible`


## 5. Geometry of thought

The model treats thoughts as points in a semantic feature space through the embedding map:

`e : Theta -> R^d`

A simple semantic dissimilarity can be defined as:

`d_sem(theta_i, theta_j) = 1 - cosine_similarity(e(theta_i), e(theta_j))`

More generally, the system is better understood as a **multi-metric space**:

`d(theta_i, theta_j) = sum over k of lambda_k * d_k(theta_i, theta_j)`

The component distances may include:

- semantic distance,
- citation/reference distance,
- topic distance,
- ontology distance,
- temporal distance,
- graph-structural distance.

This matters because Project Stars does not infer relations from one notion of similarity alone.

## 6. Relation layers

Project Stars maintains two distinct relation layers.

### 6.1 Confirmed relations

The confirmed relation layer is:

`Rc subset of Theta x Theta x RelationTypes`

A confirmed relation represents a reviewed or accepted relationship. These are the only relations treated as structurally binding in the layout system.

### 6.2 Candidate relations

The candidate relation layer is:

`Rp subset of Theta x Theta x RelationTypes x [0,1] x Evidence`

Where:

- the value in `[0,1]` is a confidence or composite score,
- `Evidence` is the bundle describing the basis of inference.

Candidate relations are hypotheses:

- they are generated deterministically,
- they are reviewable,
- they are visually subordinate,
- they are never auto-promoted to confirmed.

This makes the graph not only structural, but also epistemic.

---

## 7. Edge objects as evidence-bearing entities

Edges are not anonymous line segments. They are structured relation objects.

The current implementation already stores rich edge-level information through fields such as:

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

A relation object can be written as:

`r_ij = (theta_i, theta_j, type, status, basis, provenance)`

This matters because the graph stores relationship meaning and justification, not just connectivity.

## 8. Candidate-link inference

Candidate relations are computed by a deterministic scoring function.

### 8.1 Signal extraction

For each thought `theta`, define extracted signal sets such as:

- `Tok(theta)` = token set from label and description
- `Ref(theta)` = reference or citation set
- `Top(theta)` = topic set
- `Year(theta)` = representative temporal signal

These correspond to the signal extraction already described through `computeNodeSignals(node)` and fields like:

- `tokenSet`
- `refSet`
- `topicSet`
- `yearAvg`

### 8.2 Scoring function

Define the candidate-link score as:

`S(theta_1, theta_2) =`
- `0.28 * s_sem`
- `+ 0.24 * s_cit`
- `+ 0.18 * s_top`
- `+ 0.16 * s_nei`
- `+ 0.09 * s_ont`
- `+ 0.05 * s_rec`

Where each component is normalized to the range `[0,1]`, and:

- `s_sem` = semantic similarity
- `s_cit` = citation overlap
- `s_top` = shared topic signal
- `s_nei` = shared confirmed-neighbor signal
- `s_ont` = ontology or domain match
- `s_rec` = recency weight

A candidate edge is admitted only when:

`S(theta_1, theta_2) >= tau`

With the current threshold:

`tau = 0.46`

### 8.3 Determinism and explainability

A key principle is:

> Candidate relations must come from explicit, reviewable signals rather than random suggestion.

So more precisely, a candidate relation exists only if:

- the score is above threshold, and
- the basis of inference is not empty.

This captures the current design: candidate links are deterministic, thresholded, and preserve why they were created.

## 9. Modeling principles

The following principles define the scientific stance of Project Stars.

### 9.1 Thoughts are structured objects

A thought is not just a label. It is an attributed object with semantic, relational, evidential, and review-bearing structure.

### 9.2 Inference is not confirmation

Candidate links are epistemic hypotheses. Confirmed links are reviewed commitments.

### 9.3 Explainability is required

Every candidate link must preserve the reasons it was surfaced.

### 9.4 Only confirmed structure shapes stable layout

Hypothetical relations may be shown, but they should not deform the stable topology of the graph.

### 9.5 Provenance is part of the model

Sources, review state, citations, evidence class, and rationale are not optional extras. They are part of the scientific object.

### 9.6 Visualization is an embedding, not the ontology itself

The visible 2D layout is a dynamic projection of the relational system, not the thought system in full.

---

## 10. Layout dynamics

The displayed graph is not identical to the thought space. It is a time-dependent visual embedding of the graph into 2D.

Define:

`p(t) : Theta -> R^2`

Where `p(t)(theta)` is the rendered position of thought `theta` at time `t`.

Each thought also carries velocity:

`v_theta(t) = d/dt p_theta(t)`

The current force-layout design can be expressed as:

`m_theta * p_theta'' =`
- `sum of pairwise repulsion forces`
- `+ sum of spring forces over confirmed edges only`
- `+ weak centering force`
- `- damping term`

Where:

- repulsion prevents collapse,
- confirmed-edge springs preserve reviewed structure,
- centering keeps the graph bounded,
- damping reduces instability.

### 10.1 Confirmed-only spring axiom

A central axiom of the layout is:

> Spring force is zero unless the relation is confirmed.

This formalizes a key design choice: uncertain hypotheses may annotate the map, but they should not determine its equilibrium geometry.

### 10.2 Energy interpretation

The layout can also be understood as approximately minimizing an energy function made from:

- spring energy on confirmed edges,
- pairwise repulsion,
- weak centering.

That gives the visualization a more rigorous basis than just “animated nodes.”

## 11. Visual encoding as epistemic encoding

The interface uses visual hierarchy to distinguish certainty levels:

- confirmed edges = solid
- possible edges = faint and dashed
- selected possible edges = slightly more visible
- candidate-neighbor labels = faint and conditional

This should be understood as an epistemic encoding scheme, not mere styling.

### 11.1 Structural layer

Confirmed edges and confirmed topology represent accepted relational structure.

### 11.2 Hypothesis layer

Possible edges and faint related labels represent epistemic hypotheses above threshold.

### 11.3 Activation layer

Selection, hover, and wave disturbances represent temporary local activation rather than truth status.

---

## 12. Wave field and activation

The animated wave background is meant to evoke:

- oscillation,
- propagation,
- emergence,
- resonance,
- disturbance.

When a node is selected, the node acts as a local disturbance source.

A formal way to express this is through a scalar field:

`phi(x, t)`

over the 2D visual plane, behaving like a damped driven wave.

In practical terms:

- the graph provides discrete relational structure,
- the background provides a continuous activation field,
- selected thoughts act like local excitations in that field.

This supports the conceptual reading that ideas are not isolated points but sources of local influence in a surrounding system.

## 13. Inspector as research interface

The detail inspector is the main explanatory surface of the application.

For a selected node it shows:

- domain,
- confirmed degree,
- evidence class,
- consensus,
- review state,
- candidate count,
- description,
- references,
- confirmed connections,
- possible related thoughts,
- relationship notes.

Scientifically, the inspector is where the graph becomes interpretable. It translates:

- graph structure into readable relation lists,
- candidate inference into inspectable evidence,
- node metadata into explicit epistemic context.

## 14. Add-thought workflow as curation mechanism

The add-thought workflow allows new node creation and optional confirmed-edge creation with rationale, citations, provenance, and review metadata. Candidate edges are recomputed after addition.

This means the system is not just an observer of thought structure. It is also a curation environment.

Each addition extends the current graph by:

- adding a new thought object,
- optionally adding a reviewed confirmed relation,
- recomputing the candidate layer.

This makes Project Stars a dynamic research object rather than a static diagram.

## 15. Multi-view navigation

The current implementation supports several navigation modes, including:

- constellation view,
- domain view,
- focus view,

along with:

- search,
- filters,
- zoom,
- fit,
- home reset,
- minimap,
- pause or resume,
- manual rearrangement.

These are not just view presets. They are different ways of projecting the same underlying system:
- global structural inspection,
- domain grouping,
- local neighborhood analysis.

## 16. Export semantics

The export layer preserves:

- categories,
- nodes,
- edges,
- metadata,
- integration configuration,
- and the distinction between confirmed and candidate relationships.

It also preserves:

- provenance,
- uncertainty,
- review state,
- rationale,
- relation type,
- score components.

This is scientifically important. A graph export that discards uncertainty or provenance is weak as a research artifact.

## 17. External research-source layer

The current build models an external-source integration layer through:

- OpenAlex
- Crossref
- Semantic Scholar
- Wikidata

These sources support future or parallel workflows such as:

- citation overlap,
- metadata resolution,
- author-neighborhood analysis,
- recommendation expansion,
- ontology or entity matching.

This staged design is methodologically sound:

1. define the internal semantics
2. define the scoring and review model
3. connect live data once the evidence structure is stable

## 18. Research foundations

The design draws from several research areas:

- graph drawing and information visualization,
- link prediction,
- bibliometrics and citation structure,
- similarity and retrieval,
- ontology matching,
- human-centered knowledge systems.

These map onto the model as follows:

### 18.1 Graph drawing

Force-directed layout motivates the dynamic embedding `p(t)`.

### 18.2 Link prediction

Candidate-link generation is interpretable link prediction over a layered graph.

### 18.3 Bibliometrics

Citation overlap and neighborhood structure support research-grounded relation signals.

### 18.4 Information retrieval

Semantic and token-level similarity provide a retrieval-style basis for conceptual adjacency.

### 18.5 Ontology matching

Category and entity alignment help distinguish true conceptual relation from lexical coincidence.

### 18.6 Human review

Human review defines the hard boundary between surfaced hypotheses and accepted structure.

## 19. Scientific contribution

The main contribution of Project Stars is the coupling of several ideas into one interpretable system:

1. **Thoughts as structured research objects**  
   Nodes carry provenance, evidence, review, and ontology-bearing metadata.

2. **Epistemically separated relation layers**  
   Confirmed and candidate relations are kept distinct both visually and structurally.

3. **Explainable candidate inference**  
   Candidate links are generated from explicit weighted signals and preserve their basis.

4. **Structural vs perceptual separation**  
   Only confirmed relations shape equilibrium layout; candidate relations remain inspectable but non-deforming.

5. **Field-based activation metaphor**  
   Selection and local activity are modeled through a wave-like background rather than collapsed into graph structure.

6. **Research-preserving export**  
   The JSON schema retains rationale, provenance, review state, uncertainty, and score components.

This makes Project Stars interpretable as a research system for thought relations rather than merely a browser visualization.

## 20. Limitations

The current build has important limits:

1. it is client-side only
2. the force simulation is intentionally lightweight
3. token-based similarity is interpretable but not state-of-the-art
4. candidate quality depends on the quality of underlying text and references
5. the build prioritizes interpretability over automation

Additional limitations include:

- the embedding layer may be approximate or implicit,
- the score is interpretable but hand-weighted,
- the ontology layer is still modest,
- the field layer is partly metaphorical,
- there is no persistent collaborative review backend,
- large-scale graph behavior is not yet the main target.

## 21. Future extensions

Natural next steps include:

- stronger embedding-based retrieval,
- calibrated or learned score weights,
- typed morphisms between thoughts,
- explicit cluster or “tightness” measures,
- richer ontology structure,
- field behavior tied more directly to graph activation.

A deeper theoretical extension would reinterpret confirmed relations as morphisms:

`r : theta_i -> theta_j`

Another would treat the semantic space as curved rather than flat, so conceptual distance depends on local structure.

## 22. Implementation mapping

A practical mapping from theory to implementation is:

- `Theta` -> node collection (`SEED_NODES` plus added nodes)
- `A` -> node fields such as label, description, references, evidence, review, provenance
- `Rc` and `Rp` -> edge collection with relation status
- `S` -> `recomputeCandidateEdges()` and stored score components
- `p(t)` -> node position, velocity, and animation tick
- `phi` -> background wave canvas and selected-node disturbance logic
- export semantics -> JSON schema preserving relation-layer and evidence metadata


## 24. Copyright

Unless otherwise stated for third-party materials, services, or marks:

**Copyright (c) 2026 Pezhman Farhangi**

See `LICENSE` and `THIRD_PARTY_NOTICES.md` for governing terms and ownership boundaries.
