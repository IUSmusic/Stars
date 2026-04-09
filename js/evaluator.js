import { DEFAULT_SCENARIO_PRESETS, createSeededRandom, gaussianRandom, edgeKey } from './simulator.js';

    const STOP_WORDS = new Set(['the','and','for','with','from','that','this','into','about','when','where','what','why','how','than','then','they','them','their','have','has','had','its','our','your','his','her','also','more','less','very','across','within','without','between','under','over','not','all','are','was','were','can','yet','but','too','via','use']);
    const HARMFUL_KEYWORDS = ['crime','harm','coercion','exploitation','distrust','dehumanization','fragmentation','fear contagion'];
    const PROSOCIAL_KEYWORDS = ['kindness','empathy','compassion','cooperation','trust','repair','law','education','collective intention','incentive','legitimacy','collective identity','justice','solidarity','consensus'];

    export function tokenize(text = '') {
      return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(token => token.length > 2 && !STOP_WORDS.has(token));
    }

    export function unique(values = []) {
      return [...new Set(values)];
    }

    export function dedupeCompact(values = []) {
      return unique((values || []).map(value => String(value || '').trim()).filter(Boolean));
    }

    export function extractYears(text = '') {
      return (text.match(/(?:19|20)\d{2}/g) || []).map(Number);
    }

    export function parseCitationTokens(ref = '') {
      return dedupeCompact(ref.split(/[;,]|\s{2,}/).map(part => part.trim()).filter(Boolean));
    }

    function avg(values = []) {
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }

    function intersectCount(a, b) {
      let count = 0;
      a.forEach(value => { if (b.has(value)) count += 1; });
      return count;
    }

    function jaccard(a, b) {
      const sa = new Set(a || []);
      const sb = new Set(b || []);
      const inter = intersectCount(sa, sb);
      const union = new Set([...sa, ...sb]).size || 1;
      return inter / union;
    }

    function nodeText(node) {
      return [node.label, node.desc, node.ref].filter(Boolean).join(' ');
    }

    export function computeNodeSignals(node) {
      const localTokens = tokenize(nodeText(node));
      const ext = (node.research && node.research.signals) || {};
      const topicSeeds = [node.cat, ...localTokens.filter(token => token.length > 5).slice(0, 10), ...(ext.topics || [])];
      const refTokens = [...(node.ref ? tokenize(node.ref) : []), ...(ext.references || []), ...(ext.venues || [])];
      const descTokens = [...localTokens, ...(ext.abstractTokens || []), ...(ext.entities || []), ...(ext.authors || [])];
      const years = [...extractYears(node.ref || ''), ...((ext.years || []).filter(Boolean))];
      return {
        tokenSet: new Set(unique(descTokens)),
        refSet: new Set(unique(refTokens)),
        topicSet: new Set(unique(topicSeeds)),
        authorSet: new Set(unique(ext.authors || [])),
        entitySet: new Set(unique(ext.entities || [])),
        yearAvg: avg(years),
        externalScore: ext.qualityScore || 0,
      };
    }

    export function buildNodeMap(nodes = []) {
      return new Map(nodes.map(node => [node.id, node]));
    }

    export function buildNeighborMap(nodes = [], edges = []) {
      const map = new Map(nodes.map(node => [node.id, new Set()]));
      edges.forEach(edge => {
        if (!map.has(edge.a) || !map.has(edge.b)) return;
        map.get(edge.a).add(edge.b);
        map.get(edge.b).add(edge.a);
      });
      return map;
    }

    export function scoreCandidate(a, b, neighborMap) {
      const sa = a._signals || computeNodeSignals(a);
      const sb = b._signals || computeNodeSignals(b);
      const semantic = jaccard(sa.tokenSet, sb.tokenSet);
      const citation = jaccard(sa.refSet, sb.refSet);
      const sharedTopics = jaccard(sa.topicSet, sb.topicSet);
      const sharedNeighbors = jaccard(neighborMap.get(a.id) || new Set(), neighborMap.get(b.id) || new Set());
      const sharedAuthors = jaccard(sa.authorSet || new Set(), sb.authorSet || new Set());
      const sharedEntities = jaccard(sa.entitySet || new Set(), sb.entitySet || new Set());
      const ontology = ((a.cat === b.cat) ? 0.55 : 0) + ((intersectCount(sa.topicSet, sb.topicSet) > 2) ? 0.22 : 0) + (sharedEntities * 0.23);
      let recency = 0.35;
      if (sa.yearAvg && sb.yearAvg) recency = Math.max(0, 1 - Math.abs(sa.yearAvg - sb.yearAvg) / 25);
      const sourceQuality = Math.min(1, ((sa.externalScore || 0) + (sb.externalScore || 0)) / 2);
      const score = semantic * 0.24 + citation * 0.2 + sharedTopics * 0.16 + sharedNeighbors * 0.14 + ontology * 0.11 + recency * 0.05 + sharedAuthors * 0.06 + sharedEntities * 0.02 + sourceQuality * 0.02;
      const basis = [];
      if (semantic > 0.14) basis.push(`semantic overlap ${semantic.toFixed(2)}`);
      if (citation > 0.05) basis.push(`citation overlap ${citation.toFixed(2)}`);
      if (sharedTopics > 0.12) basis.push(`shared topics ${sharedTopics.toFixed(2)}`);
      if (sharedNeighbors > 0.05) basis.push(`shared neighbors ${sharedNeighbors.toFixed(2)}`);
      if (sharedAuthors > 0.02) basis.push(`shared authors ${sharedAuthors.toFixed(2)}`);
      if (sharedEntities > 0.02) basis.push(`ontology entities ${sharedEntities.toFixed(2)}`);
      if (ontology > 0.4) basis.push(a.cat === b.cat ? 'same domain' : 'ontology match');
      if (sourceQuality > 0.25) basis.push(`source quality ${sourceQuality.toFixed(2)}`);
      if (!basis.length) basis.push('multi-signal weak match');
      return {
        score,
        components: {
          semanticSimilarity: semantic,
          citationOverlap: citation,
          sharedTopics,
          sharedNeighbors,
          ontologyMatch: ontology,
          recencyWeight: recency,
          sharedAuthors,
          entityMatch: sharedEntities,
          sourceQuality,
        },
        basis,
      };
    }

    export function buildRankedCandidates(atlas, options = {}) {
      const nodes = (atlas.nodes || []).map(node => ({ ...node, _signals: computeNodeSignals(node) }));
      const nodeMap = buildNodeMap(nodes);
      const confirmedEdges = (atlas.confirmedEdges || atlas.edges?.confirmed || atlas.edges || [])
        .map(edge => Array.isArray(edge) ? { a: edge[0], b: edge[1], status: 'confirmed' } : edge)
        .filter(edge => edge.a && edge.b);
      const confirmedPairSet = new Set(confirmedEdges.map(edge => edgeKey(edge.a, edge.b)));
      const baseNeighborMap = buildNeighborMap(nodes, confirmedEdges);
      const ranked = [];
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          if (confirmedPairSet.has(edgeKey(a.id, b.id))) continue;
          const scored = scoreCandidate(a, b, baseNeighborMap);
          ranked.push({
            a: a.id,
            b: b.id,
            labelA: a.label,
            labelB: b.label,
            catA: a.cat,
            catB: b.cat,
            score: Number(scored.score.toFixed(6)),
            basis: scored.basis,
            components: scored.components,
          });
        }
      }
      ranked.sort((left, right) => right.score - left.score);
      if (options.topK) return ranked.slice(0, options.topK);
      return ranked;
    }

    function aucFromScores(positives, negatives) {
      let wins = 0;
      let ties = 0;
      positives.forEach(pos => {
        negatives.forEach(neg => {
          if (pos.score > neg.score) wins += 1;
          else if (pos.score === neg.score) ties += 1;
        });
      });
      const total = positives.length * negatives.length || 1;
      return (wins + (ties * 0.5)) / total;
    }

    function precisionAtK(rankedGroundTruth, k) {
      const slice = rankedGroundTruth.slice(0, Math.max(1, k));
      const positives = slice.filter(item => item.expected === 'candidate').length;
      return positives / Math.max(1, slice.length);
    }

    function meanReciprocalRank(rankedGroundTruth) {
      const positiveRanks = rankedGroundTruth
        .map((item, index) => ({ ...item, rank: index + 1 }))
        .filter(item => item.expected === 'candidate')
        .map(item => 1 / item.rank);
      return positiveRanks.length ? positiveRanks.reduce((sum, value) => sum + value, 0) / positiveRanks.length : 0;
    }

    export function evaluateCandidateRanking(atlas, groundtruth) {
      const ranked = buildRankedCandidates(atlas);
      const scoreMap = new Map(ranked.map(item => [edgeKey(item.a, item.b), item]));
      const labeled = [
        ...(groundtruth?.positive || []).map(item => ({ ...item, expected: 'candidate' })),
        ...(groundtruth?.negative || []).map(item => ({ ...item, expected: 'not-candidate' })),
      ].map(item => {
        const scoreEntry = scoreMap.get(edgeKey(item.a, item.b)) || { score: 0, basis: ['pair absent from ranked candidate list'], components: {} };
        return { ...item, score: scoreEntry.score, basis: scoreEntry.basis, components: scoreEntry.components };
      }).sort((left, right) => right.score - left.score);
      const positives = labeled.filter(item => item.expected === 'candidate');
      const negatives = labeled.filter(item => item.expected === 'not-candidate');
      return {
        totalPairsScored: ranked.length,
        benchmarkSize: labeled.length,
        metrics: {
          aucRoc: Number(aucFromScores(positives, negatives).toFixed(4)),
          precisionAt5: Number(precisionAtK(labeled, 5).toFixed(4)),
          precisionAt10: Number(precisionAtK(labeled, 10).toFixed(4)),
          meanReciprocalRank: Number(meanReciprocalRank(labeled).toFixed(4)),
        },
        rankedGroundTruth: labeled,
        topSuggestions: ranked.slice(0, 20),
      };
    }

    function isHarmful(node) {
      const label = (node.label || '').toLowerCase();
      return HARMFUL_KEYWORDS.some(keyword => label.includes(keyword));
    }

    function isProsocial(node) {
      const label = (node.label || '').toLowerCase();
      return PROSOCIAL_KEYWORDS.some(keyword => label.includes(keyword));
    }

    function edgeActivity(edge, nodeMap, scenario) {
      const a = nodeMap.get(edge.a);
      const b = nodeMap.get(edge.b);
      if (!a || !b) return 1;
      const positivity = Math.max(0, scenario.polarity || 0);
      const negativity = Math.max(0, -(scenario.polarity || 0));
      let factor = 1 + ((scenario.intention || 0.5) - 0.5) * 0.4 + ((scenario.rq || 0.5) - 0.5) * 0.25;
      if (isProsocial(a) || isProsocial(b)) factor += positivity * 0.6 + ((scenario.empathy || 0.5) - 0.5) * 0.4;
      if (isHarmful(a) || isHarmful(b)) factor += negativity * 0.7 + (0.5 - (scenario.empathy || 0.5)) * 0.3;
      if (edge.status === 'possible') factor *= 0.65 + ((edge.confidence || 0.5) * 0.35);
      return Math.max(0.2, Math.min(1.8, factor));
    }

    function adjacency(nodes, edges) {
      const adj = new Map(nodes.map(node => [node.id, []]));
      edges.forEach(edge => {
        if (!adj.has(edge.a) || !adj.has(edge.b)) return;
        adj.get(edge.a).push({ id: edge.b, weight: edge.weight ?? 1 });
        adj.get(edge.b).push({ id: edge.a, weight: edge.weight ?? 1 });
      });
      return adj;
    }

    function componentSizes(nodes, adj) {
      const visited = new Set();
      const sizes = [];
      nodes.forEach(node => {
        if (visited.has(node.id)) return;
        const queue = [node.id];
        visited.add(node.id);
        let size = 0;
        while (queue.length) {
          const current = queue.shift();
          size += 1;
          (adj.get(current) || []).forEach(({ id }) => {
            if (visited.has(id)) return;
            visited.add(id);
            queue.push(id);
          });
        }
        sizes.push(size);
      });
      sizes.sort((a, b) => b - a);
      return sizes;
    }

    function clusteringCoefficient(nodes, adj) {
      let sum = 0;
      let counted = 0;
      nodes.forEach(node => {
        const neighbors = (adj.get(node.id) || []).map(entry => entry.id);
        const degree = neighbors.length;
        if (degree < 2) return;
        let links = 0;
        for (let i = 0; i < neighbors.length; i += 1) {
          for (let j = i + 1; j < neighbors.length; j += 1) {
            const ni = neighbors[i];
            const nj = neighbors[j];
            if ((adj.get(ni) || []).some(entry => entry.id === nj)) links += 1;
          }
        }
        const possible = degree * (degree - 1) / 2;
        sum += links / possible;
        counted += 1;
      });
      return counted ? sum / counted : 0;
    }

    function betweennessCentrality(nodes, adj) {
      const ids = nodes.map(node => node.id);
      const bc = new Map(ids.map(id => [id, 0]));
      ids.forEach(source => {
        const stack = [];
        const predecessors = new Map(ids.map(id => [id, []]));
        const sigma = new Map(ids.map(id => [id, 0]));
        const distance = new Map(ids.map(id => [id, -1]));
        sigma.set(source, 1);
        distance.set(source, 0);
        const queue = [source];
        while (queue.length) {
          const v = queue.shift();
          stack.push(v);
          (adj.get(v) || []).forEach(({ id: w }) => {
            if (distance.get(w) < 0) {
              queue.push(w);
              distance.set(w, distance.get(v) + 1);
            }
            if (distance.get(w) === distance.get(v) + 1) {
              sigma.set(w, sigma.get(w) + sigma.get(v));
              predecessors.get(w).push(v);
            }
          });
        }
        const delta = new Map(ids.map(id => [id, 0]));
        while (stack.length) {
          const w = stack.pop();
          predecessors.get(w).forEach(v => {
            const contrib = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
            delta.set(v, delta.get(v) + contrib);
          });
          if (w !== source) bc.set(w, bc.get(w) + delta.get(w));
        }
      });
      const values = [...bc.values()].map(value => value / 2);
      return {
        mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
        max: values.length ? Math.max(...values) : 0,
      };
    }

    export function computeGraphMetrics(atlas, options = {}) {
      const scenario = options.scenario || DEFAULT_SCENARIO_PRESETS.balanced;
      const includeCandidates = options.includeCandidates ?? false;
      const nodes = (atlas.nodes || []).map(node => ({ ...node }));
      const nodeMap = buildNodeMap(nodes);
      const confirmed = (atlas.confirmedEdges || atlas.edges?.confirmed || atlas.edges || []).map(edge => Array.isArray(edge) ? { a: edge[0], b: edge[1], status: 'confirmed' } : { ...edge, status: edge.status || 'confirmed' });
      const possible = includeCandidates
        ? (atlas.candidateEdges || atlas.edges?.possible || []).map(edge => ({ ...edge, status: 'possible' }))
        : [];
      const workingEdges = [...confirmed, ...possible].map(edge => ({
        ...edge,
        weight: edgeActivity(edge, nodeMap, scenario) * (edge.status === 'confirmed' ? 1 : (edge.confidence || 0.5)),
      })).filter(edge => edge.weight > 0.01);
      const adj = adjacency(nodes, workingEdges);
      const degrees = nodes.map(node => (adj.get(node.id) || []).length);
      const sizes = componentSizes(nodes, adj);
      const totalWeight = workingEdges.reduce((sum, edge) => sum + edge.weight, 0) || 1;
      const crossCategoryWeight = workingEdges.reduce((sum, edge) => {
        const a = nodeMap.get(edge.a);
        const b = nodeMap.get(edge.b);
        return sum + ((a && b && a.cat !== b.cat) ? edge.weight : 0);
      }, 0);
      const harmfulWeight = workingEdges.reduce((sum, edge) => {
        const a = nodeMap.get(edge.a);
        const b = nodeMap.get(edge.b);
        return sum + ((a && b && (isHarmful(a) || isHarmful(b))) ? edge.weight : 0);
      }, 0);
      const prosocialWeight = workingEdges.reduce((sum, edge) => {
        const a = nodeMap.get(edge.a);
        const b = nodeMap.get(edge.b);
        return sum + ((a && b && (isProsocial(a) || isProsocial(b))) ? edge.weight : 0);
      }, 0);
      const coherence = 1 - ((sizes[0] ? (nodes.length - sizes[0]) / nodes.length : 1));
      const fragmentation = 1 - (sizes[0] || 0) / Math.max(1, nodes.length);
      const layoutEnergyProxy = workingEdges.length ? workingEdges.reduce((sum, edge) => sum + (1 / Math.max(edge.weight, 0.05)), 0) / workingEdges.length : 0;
      const modularityProxy = 1 - (crossCategoryWeight / totalWeight);
      const betweenness = betweennessCentrality(nodes, adj);
      return {
        scenario: scenario.label,
        includeCandidates,
        nodeCount: nodes.length,
        edgeCount: workingEdges.length,
        meanDegree: Number((degrees.reduce((sum, value) => sum + value, 0) / Math.max(1, degrees.length)).toFixed(4)),
        maxDegree: Math.max(...degrees, 0),
        fragmentation: Number(fragmentation.toFixed(4)),
        coherenceXi: Number(coherence.toFixed(4)),
        clustering: Number(clusteringCoefficient(nodes, adj).toFixed(4)),
        modularityProxy: Number(modularityProxy.toFixed(4)),
        moralValenceBalance: Number(((prosocialWeight - harmfulWeight) / totalWeight).toFixed(4)),
        layoutEnergyProxy: Number(layoutEnergyProxy.toFixed(4)),
        betweennessMean: Number(betweenness.mean.toFixed(4)),
        betweennessMax: Number(betweenness.max.toFixed(4)),
      };
    }

    export function runShockTrials(atlas, scenario, options = {}) {
      const trials = options.trials ?? 50;
      const removalRate = options.removalRate ?? 0.15;
      const noiseScale = options.noiseScale ?? 0.12;
      const rng = createSeededRandom(options.seed ?? 42);
      const baseline = computeGraphMetrics(atlas, { scenario, includeCandidates: true });
      const confirmed = (atlas.confirmedEdges || atlas.edges?.confirmed || atlas.edges || []).map(edge => Array.isArray(edge) ? { a: edge[0], b: edge[1], status: 'confirmed' } : { ...edge, status: edge.status || 'confirmed' });
      const possible = (atlas.candidateEdges || atlas.edges?.possible || []).map(edge => ({ ...edge, status: 'possible' }));
      const allEdges = [...confirmed, ...possible];
      const deltas = [];
      for (let trial = 0; trial < trials; trial += 1) {
        const shockedEdges = allEdges.flatMap(edge => {
          if (rng() < removalRate) return [];
          const perturb = 1 + gaussianRandom(rng) * noiseScale;
          const confidence = edge.status === 'possible'
            ? Math.max(0.05, Math.min(0.99, (edge.confidence || 0.5) * perturb))
            : edge.confidence;
          return [{ ...edge, confidence }];
        });
        const shocked = computeGraphMetrics({ ...atlas, confirmedEdges: shockedEdges.filter(edge => edge.status === 'confirmed'), candidateEdges: shockedEdges.filter(edge => edge.status === 'possible') }, { scenario, includeCandidates: true });
        deltas.push({
          coherenceDelta: shocked.coherenceXi - baseline.coherenceXi,
          layoutEnergyDelta: shocked.layoutEnergyProxy - baseline.layoutEnergyProxy,
          clusterDelta: shocked.modularityProxy - baseline.modularityProxy,
        });
      }
      const summarize = key => {
        const values = deltas.map(delta => delta[key]);
        const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
        const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, values.length);
        return { mean: Number(mean.toFixed(4)), std: Number(Math.sqrt(variance).toFixed(4)) };
      };
      return {
        scenario: scenario.label,
        trials,
        baseline,
        deltas: {
          coherenceXi: summarize('coherenceDelta'),
          layoutEnergyProxy: summarize('layoutEnergyDelta'),
          modularityProxy: summarize('clusterDelta'),
        },
      };
    }

    export function runEvaluationSuite(atlas, groundtruth, options = {}) {
      const presets = options.scenarioPresets || DEFAULT_SCENARIO_PRESETS;
      const candidateRanking = evaluateCandidateRanking(atlas, groundtruth);
      const rankedCandidates = buildRankedCandidates(atlas);
      const candidateEdges = rankedCandidates.filter(item => item.score >= (options.candidateThreshold ?? 0.17)).map(item => ({ ...item, status: 'possible', confidence: item.score }));
      const atlasWithCandidates = { ...atlas, candidateEdges };
      const ablations = {
        confirmedOnlyVsFull: {
          confirmedOnly: computeGraphMetrics(atlas, { scenario: presets.balanced, includeCandidates: false }),
          fullGraph: computeGraphMetrics(atlasWithCandidates, { scenario: presets.balanced, includeCandidates: true }),
        },
        balancedVsWorld: {
          balanced: computeGraphMetrics(atlasWithCandidates, { scenario: presets.balanced, includeCandidates: true }),
          world: computeGraphMetrics(atlasWithCandidates, { scenario: presets.world, includeCandidates: true }),
        },
        lowQVsHighQ: {
          lowQ: computeGraphMetrics(atlasWithCandidates, { scenario: presets.lowQ, includeCandidates: true }),
          highQ: computeGraphMetrics(atlasWithCandidates, { scenario: presets.highQ, includeCandidates: true }),
        },
        crisisShockVsRepair: {
          crisis: runShockTrials(atlasWithCandidates, presets.crisis, { seed: 42 }),
          repair: runShockTrials(atlasWithCandidates, presets.repair, { seed: 84 }),
        },
      };
      return {
        generatedAt: new Date().toISOString(),
        atlasVersion: atlas.version || 'v1.0',
        dataset: atlas.metadata || {},
        candidateRanking,
        topCandidates: rankedCandidates.slice(0, 12),
        candidateThreshold: options.candidateThreshold ?? 0.17,
        ablations,
      };
    }

    export function summarizeEvaluationReport(report) {
      const ranking = report.candidateRanking.metrics;
      const confirmed = report.ablations.confirmedOnlyVsFull.confirmedOnly;
      const full = report.ablations.confirmedOnlyVsFull.fullGraph;
      const balanced = report.ablations.balancedVsWorld.balanced;
      const world = report.ablations.balancedVsWorld.world;
      return [
        `Candidate ranking AUC-ROC: ${ranking.aucRoc.toFixed(3)}`,
        `Precision@5: ${ranking.precisionAt5.toFixed(3)} · MRR: ${ranking.meanReciprocalRank.toFixed(3)}`,
        `Confirmed-only Xi: ${confirmed.coherenceXi.toFixed(3)} → full graph Xi: ${full.coherenceXi.toFixed(3)}`,
        `Balanced fragmentation: ${balanced.fragmentation.toFixed(3)} · World fragmentation: ${world.fragmentation.toFixed(3)}`,
        `Top candidate: ${report.topCandidates[0]?.labelA || 'n/a'} ↔ ${report.topCandidates[0]?.labelB || 'n/a'} (${report.topCandidates[0]?.score?.toFixed?.(3) || 'n/a'})`,
      ].join('\n');
    }
