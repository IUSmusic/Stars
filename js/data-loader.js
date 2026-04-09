export async function loadAtlas(version = 'v1.0') {
  const path = `data/atlas-${version}.json`;
  const resp = await fetch(path, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Failed to load atlas dataset from ${path}`);
  const atlas = await resp.json();
  const confirmedEdges = Array.isArray(atlas?.edges)
    ? atlas.edges
    : (atlas?.edges?.confirmed || []);
  const candidateEdges = atlas?.edges?.possible || [];
  return {
    version: atlas.version || version,
    title: atlas.title || 'Project Stars Atlas',
    metadata: atlas.metadata || {},
    categories: atlas.categories || [],
    nodes: atlas.nodes || [],
    confirmedEdges: confirmedEdges.map(edge => Array.isArray(edge)
      ? { a: edge[0], b: edge[1], status: 'confirmed' }
      : { ...edge, status: edge.status || 'confirmed' }),
    candidateEdges: candidateEdges.map(edge => ({ ...edge, status: edge.status || 'possible' })),
    edgePairs: confirmedEdges.map(edge => Array.isArray(edge) ? edge : [edge.a, edge.b]),
    raw: atlas,
  };
}

export async function loadCandidateGroundtruth() {
  const path = 'data/candidates-groundtruth.json';
  const resp = await fetch(path, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Failed to load candidate ground-truth from ${path}`);
  return resp.json();
}

export function rebuildCategoryMap(categories = []) {
  return categories.reduce((acc, category) => {
    acc[category.id] = { ...category };
    return acc;
  }, {});
}
