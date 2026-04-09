import { evaluateCandidateRanking, buildRankedCandidates } from '../js/evaluator.js';

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

export async function runScoreCandidateTests() {
  const atlas = await loadJson('../data/atlas-v1.0.json');
  const groundtruth = await loadJson('../data/candidates-groundtruth.json');
  const ranking = evaluateCandidateRanking({
    version: atlas.version,
    metadata: atlas.metadata,
    nodes: atlas.nodes,
    confirmedEdges: atlas.edges.confirmed,
  }, groundtruth);
  const ranked = buildRankedCandidates({
    version: atlas.version,
    metadata: atlas.metadata,
    nodes: atlas.nodes,
    confirmedEdges: atlas.edges.confirmed,
  }, { topK: 10 });
  console.assert(ranking.metrics.aucRoc >= 0 && ranking.metrics.aucRoc <= 1, 'AUC should be bounded');
  console.assert(ranking.metrics.precisionAt5 >= 0 && ranking.metrics.precisionAt5 <= 1, 'Precision@5 should be bounded');
  console.assert(ranked.length === 10, 'Top-K candidate list should have 10 items');
  console.log('Stars evaluation smoke tests passed.', { ranking: ranking.metrics, topCandidate: ranked[0] });
  return { ranking: ranking.metrics, topCandidate: ranked[0] };
}

if (typeof window !== 'undefined') {
  window.runScoreCandidateTests = runScoreCandidateTests;
}
