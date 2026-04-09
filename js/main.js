
import { loadAtlas, loadCandidateGroundtruth, rebuildCategoryMap } from './data-loader.js';
import { createSeededRandom } from './simulator.js';
import { runEvaluationSuite, summarizeEvaluationReport } from './evaluator.js';
import { installEvaluationPanel } from './ui-controls.js';
import { downloadJSON } from './renderer.js';

// ------------------------------------------------------------------
// Dynamic pathway keywords
//
// HARMFUL_KEYWORDS and PROSOCIAL_KEYWORDS are used to classify edges
// as broadly harmful or prosocial based on the labels of their nodes.
// These arrays inform the dynamic edge-activation logic introduced below.
const HARMFUL_KEYWORDS = [
  'crime','harm','coercion','exploitation','distrust',
  'dehumanization','fragmentation','fear contagion'
];
const PROSOCIAL_KEYWORDS = [
  'kindness','empathy','compassion','cooperation','trust',
  'repair','law','education','collective intention',
  'incentive','legitimacy','collective identity','justice',
  'solidarity','consensus'
];
// ═══════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════
let CATEGORIES = [];
let CMAP = {};
let SEED_NODES = [];
let SEED_EDGES = [];
let ATLAS_METADATA = {};
let GROUNDTRUTH_DATA = null;
const RECEIVER_DEFAULT = 1.0;
const INTENTION_DEFAULT = 0.50;
const MORAL_DEFAULT = 0.00;
const EMPATHY_DEFAULT = 0.50;
let receiverQuality = RECEIVER_DEFAULT;
let intentionStrength = INTENTION_DEFAULT;
let moralPolarity = MORAL_DEFAULT;
let empathyField = EMPATHY_DEFAULT;
let experimentMetrics = {precision:0, coherence:0, convergence:0, receiverState:'High', moralValence:0, collectivePull:0};

// ═══════════════════════════════════════════════════════════
// NODES — 92 thoughts grounded in contemporary research


// ═══════════════════════════════════════════════════════════
// EDGES: rich web of cross-domain connections


// GRAPH STATE, LAYERS, SCORING, AND RENDERING
const EXTERNAL_SOURCES = {
  openalex:{label:'OpenAlex', role:'works, authors, topics, citation neighborhoods', status:'ready', endpoint:'https://api.openalex.org/works'},
  crossref:{label:'Crossref', role:'DOI metadata, references, funders, provenance', status:'ready', endpoint:'https://api.crossref.org/works'},
  semanticscholar:{label:'Semantic Scholar', role:'paper graph, recommendations, expansion', status:'ready', endpoint:'https://api.semanticscholar.org/graph/v1/paper/search'},
  wikidata:{label:'Wikidata', role:'entity resolution, ontology alignment, identifiers', status:'ready', endpoint:'https://www.wikidata.org/w/api.php'}
};
const CANDIDATE_THRESHOLD=0.17;
const POSSIBLE_LABEL_BASE_ALPHA=0.34;
const POSSIBLE_LABEL_SELECTED_ALPHA=0.62;
const RESEARCH_TIMEOUT_MS=9000;
let nodes=[], edges=[], nextId=200;
const researchState={lastSyncAt:null,lastSyncTarget:'none',pending:false,pendingCount:0,lastError:'',sources:{openalex:{state:'idle',hits:0,last:null},crossref:{state:'idle',hits:0,last:null},semanticscholar:{state:'idle',hits:0,last:null},wikidata:{state:'idle',hits:0,last:null}}};
let cam={x:0,y:0,z:0.85};
let drag=null, hovered=null, hoveredEdge=null, selected=null, selectedEdge=null;
let connectMode=false, connectFrom=null;
let searchTerm='', filterCat=null;
let paused=false, settled=false, simAge=0;
let W, H, waveTime=0;
let currentView='research';
let neighborhoodMode='confirmed';
let clusterDiagnostics=[];
let layoutDiagnostics={energy:0, structuralPull:0, hypothesisTension:0, settling:'settling'};
const VIEW_MODES=['research','structure','hypothesis','field'];

const bgC=document.getElementById('bg');
const bgX=bgC.getContext('2d');
const gc=document.getElementById('graph');
const ctx=gc.getContext('2d');
const mm=document.getElementById('minimap');
const mmx=mm.getContext('2d');

function getViewportSize(){
  const vv = window.visualViewport;
  return {
    width: Math.max(1, Math.round(vv ? vv.width : window.innerWidth)),
    height: Math.max(1, Math.round(vv ? vv.height : window.innerHeight))
  };
}

function resize(){
  const viewport = getViewportSize();
  W = gc.width = bgC.width = viewport.width;
  H = gc.height = bgC.height = viewport.height;
  drawStars();
}
window.addEventListener('resize', resize, { passive:true });
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', resize, { passive:true });
}
window.addEventListener('online',renderSourceStatus);
window.addEventListener('offline',renderSourceStatus);

function pr(n){const x=Math.sin(n+1)*43758.5453;return x-Math.floor(x);}
const STOP_WORDS=new Set(['the','and','for','with','from','that','this','into','about','when','where','what','why','how','than','then','they','them','their','have','has','had','its','our','your','his','her','also','more','less','very','across','within','without','between','under','over','not','all','are','was','were','can','yet','but','too','via','use']);
function tokenize(text=''){ return (text.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(t=>t.length>2&&!STOP_WORDS.has(t)); }
function unique(arr){return [...new Set(arr)];}
function intersectCount(a,b){let c=0; a.forEach(v=>{if(b.has(v))c++;}); return c;}
function jaccard(a,b){ const sa=new Set(a), sb=new Set(b); const inter=intersectCount(sa,sb); const union=new Set([...sa,...sb]).size||1; return inter/union; }
function extractYears(text=''){ return (text.match(/(?:19|20)\d{2}/g)||[]).map(Number); }
function avg(nums){ return nums.length?nums.reduce((s,v)=>s+v,0)/nums.length:null; }
function nodeText(n){ return [n.label,n.desc,n.ref].filter(Boolean).join(' '); }
function computeNodeSignals(n){
  const localTokens=tokenize(nodeText(n));
  const ext=(n.research&&n.research.signals)||{};
  const topicSeeds=[n.cat,...localTokens.filter(t=>t.length>5).slice(0,10),...(ext.topics||[])];
  const refTokens=[...(n.ref?tokenize(n.ref):[]),...(ext.references||[]),...(ext.venues||[])];
  const descTokens=[...localTokens,...(ext.abstractTokens||[]),...(ext.entities||[]),...(ext.authors||[])];
  const years=[...extractYears(n.ref||''),...((ext.years||[]).filter(Boolean))];
  return {
    tokenSet:new Set(unique(descTokens)),
    refSet:new Set(unique(refTokens)),
    topicSet:new Set(unique(topicSeeds)),
    authorSet:new Set(unique(ext.authors||[])),
    entitySet:new Set(unique(ext.entities||[])),
    yearAvg:avg(years),
    externalScore: ext.qualityScore || 0
  };
}
function edgeKey(a,b){ return a<b?`${a}::${b}`:`${b}::${a}`; }
function createEdge(a,b,overrides={}){
  const status=overrides.status||'confirmed';
  return {
    a,b,
    relation:overrides.relation||'related',
    status,
    confidence:overrides.confidence ?? (status==='confirmed'?0.95:0.58),
    basis:overrides.basis||['curated seed relation'],
    notes:overrides.notes||'',
    rationale:overrides.rationale||'',
    citations:overrides.citations||[],
    evidenceClass:overrides.evidenceClass||'research-grounded',
    consensus:overrides.consensus||'curated',
    provenance:overrides.provenance||{source:'internal-curation'},
    review:overrides.review||{state: status==='confirmed' ? 'confirmed' : 'pending-review', reviewedAt:null, reviewedBy:'human'},
    scoreComponents:overrides.scoreComponents||null
  };
}
function nodeById(id){return nodes.find(n=>n.id===id);}
function getNodeEdges(id,status=null){ return edges.filter(e=>(e.a===id||e.b===id)&&(!status||e.status===status)); }
function getConns(n,status='confirmed'){ return getNodeEdges(n.id,status).map(e=>nodeById(e.a===n.id?e.b:e.a)).filter(Boolean); }
function buildConfirmedNeighborMap(){ const m=new Map(); nodes.forEach(n=>m.set(n.id,new Set())); edges.filter(e=>e.status==='confirmed').forEach(e=>{m.get(e.a).add(e.b);m.get(e.b).add(e.a);}); return m; }
function scoreCandidate(a,b,neighborMap){
  const sa=a._signals||computeNodeSignals(a);
  const sb=b._signals||computeNodeSignals(b);
  const semantic=jaccard(sa.tokenSet,sb.tokenSet);
  const citation=jaccard(sa.refSet,sb.refSet);
  const sharedTopics=jaccard(sa.topicSet,sb.topicSet);
  const sharedNeighbors=jaccard(neighborMap.get(a.id)||new Set(),neighborMap.get(b.id)||new Set());
  const sharedAuthors=jaccard(sa.authorSet||new Set(),sb.authorSet||new Set());
  const sharedEntities=jaccard(sa.entitySet||new Set(),sb.entitySet||new Set());
  const ontology=((a.cat===b.cat)?0.55:0)+((intersectCount(sa.topicSet,sb.topicSet)>2)?0.22:0)+sharedEntities*0.23;
  let recency=0.35;
  if(sa.yearAvg&&sb.yearAvg){ recency=Math.max(0,1-Math.abs(sa.yearAvg-sb.yearAvg)/25); }
  const sourceQuality=Math.min(1, ((sa.externalScore||0)+(sb.externalScore||0))/2);
  const score=semantic*0.24+citation*0.2+sharedTopics*0.16+sharedNeighbors*0.14+ontology*0.11+recency*0.05+sharedAuthors*0.06+sharedEntities*0.02+sourceQuality*0.02;
  const basis=[];
  if(semantic>0.14) basis.push(`semantic overlap ${semantic.toFixed(2)}`);
  if(citation>0.05) basis.push(`citation overlap ${citation.toFixed(2)}`);
  if(sharedTopics>0.12) basis.push(`shared topics ${sharedTopics.toFixed(2)}`);
  if(sharedNeighbors>0.05) basis.push(`shared neighbors ${sharedNeighbors.toFixed(2)}`);
  if(sharedAuthors>0.02) basis.push(`shared authors ${sharedAuthors.toFixed(2)}`);
  if(sharedEntities>0.02) basis.push(`ontology entities ${sharedEntities.toFixed(2)}`);
  if(ontology>0.4) basis.push(a.cat===b.cat?'same domain':'ontology match');
  if(sourceQuality>0.25) basis.push(`source quality ${sourceQuality.toFixed(2)}`);
  if(!basis.length) basis.push('multi-signal weak match');
  return {score, components:{semanticSimilarity:semantic,citationOverlap:citation,sharedTopics,sharedNeighbors,ontologyMatch:ontology,recencyWeight:recency,sharedAuthors,entityMatch:sharedEntities,sourceQuality}, basis};
}

function scoreBreakdownLines(edge){
  const c=edge?.scoreComponents||{};
  const parts=[
    ['sem',0.24,c.semanticSimilarity],
    ['cit',0.20,c.citationOverlap],
    ['topic',0.16,c.sharedTopics],
    ['nbr',0.14,c.sharedNeighbors],
    ['ont',0.11,c.ontologyMatch],
    ['rec',0.05,c.recencyWeight],
    ['author',0.06,c.sharedAuthors],
    ['entity',0.02,c.entityMatch],
    ['source',0.02,c.sourceQuality]
  ];
  return parts.filter(([, ,v])=>typeof v==='number').map(([k,w,v])=>`${k}: ${w.toFixed(2)} × ${v.toFixed(2)} = ${(w*v).toFixed(3)}`);
}
function edgeHoverSummary(edge){
  const total=(edge?.confidence||0).toFixed(3);
  const cmp=edge && edge.confidence>=CANDIDATE_THRESHOLD ? '>' : '≤';
  return [...scoreBreakdownLines(edge).slice(0,6),`total = ${total} ${cmp} ${CANDIDATE_THRESHOLD.toFixed(2)} → ${edge?.confidence>=CANDIDATE_THRESHOLD?'candidate':'below threshold'}`].join('\n');
}

function reviewStateLabel(state=''){
  const s=String(state||'').toLowerCase();
  if(['confirmed','accepted'].includes(s)) return 'Confirmed';
  if(['candidate','possible'].includes(s)) return 'Candidate';
  if(['pending-review','under-review','review'].includes(s)) return 'Under review';
  if(['rejected','dismissed'].includes(s)) return 'Rejected';
  if(['insufficient-evidence','insufficient','needs-evidence'].includes(s)) return 'Insufficient evidence';
  return s ? s.replace(/-/g,' ').replace(/\b\w/g, m=>m.toUpperCase()) : 'Under review';
}
function epistemicStateForEdge(e){
  if(!e) return 'Insufficient evidence';
  if(e.status==='confirmed') return 'Confirmed';
  const rs=reviewStateLabel(e.review?.state||'candidate');
  if(rs==='Under review') return 'Candidate · Under review';
  return `Candidate · ${rs}`;
}
function getSemanticNeighborMap(){
  const map=new Map();
  nodes.forEach(a=>{
    const arr=nodes.filter(b=>b.id!==a.id).map(b=>({id:b.id, score:scoreCandidate(a,b,buildConfirmedNeighborMap()).score})).sort((x,y)=>y.score-x.score).slice(0,6);
    map.set(a.id, arr);
  });
  return map;
}
function getCitationNeighborSet(id){
  const node=nodeById(id); if(!node) return new Set();
  const base=node._signals||computeNodeSignals(node);
  return new Set(nodes.filter(n=>n.id!==id && jaccard(base.refSet,(n._signals||computeNodeSignals(n)).refSet)>0.05).map(n=>n.id));
}
function getOntologyNeighborSet(id){
  const node=nodeById(id); if(!node) return new Set();
  const base=node._signals||computeNodeSignals(node);
  return new Set(nodes.filter(n=>n.id!==id && (n.cat===node.cat || jaccard(base.entitySet,(n._signals||computeNodeSignals(n)).entitySet)>0.08)).map(n=>n.id));
}
function getNeighborHighlightSet(){
  if(!selected) return new Set();
  if(neighborhoodMode==='confirmed') return new Set(getConns(selected,'confirmed').map(n=>n.id));
  if(neighborhoodMode==='candidate') return new Set(getConns(selected,'possible').map(n=>n.id));
  if(neighborhoodMode==='citation') return getCitationNeighborSet(selected.id);
  if(neighborhoodMode==='ontology') return getOntologyNeighborSet(selected.id);
  const sem=getSemanticNeighborMap().get(selected.id)||[];
  return new Set(sem.map(x=>x.id));
}
function distancePointToSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax, dy=by-ay;
  const l2=dx*dx+dy*dy||1;
  let t=((px-ax)*dx+(py-ay)*dy)/l2;
  t=Math.max(0,Math.min(1,t));
  const x=ax+t*dx, y=ay+t*dy;
  return Math.hypot(px-x,py-y);
}
function edgeAt(wp){
  let best=null, bestD=Infinity;
  edges.forEach(e=>{
    const a=nodeById(e.a), b=nodeById(e.b); if(!a||!b) return;
    const d=distancePointToSegment(wp.x,wp.y,a.x,a.y,b.x,b.y);
    if(d<bestD && d<8/cam.z){ best=e; bestD=d; }
  });
  return best;
}
function convexHull(points){
  if(points.length<3) return points;
  const pts=[...points].sort((p,q)=>p.x===q.x?p.y-q.y:p.x-q.x);
  const cross=(o,a,b)=>((a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x));
  const lower=[]; for(const p of pts){ while(lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], p)<=0) lower.pop(); lower.push(p); }
  const upper=[]; for(const p of pts.slice().reverse()){ while(upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], p)<=0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop(); return lower.concat(upper);
}
function computeClusterDiagnostics(){
  const adjacency=new Map(nodes.map(n=>[n.id,new Set()]));
  edges.forEach(e=>{
    if(e.status==='confirmed' || (e.status==='possible' && (e.confidence||0)>=0.6)){
      adjacency.get(e.a)?.add(e.b); adjacency.get(e.b)?.add(e.a);
    }
  });
  const seen=new Set(), clusters=[];
  nodes.forEach(n=>{
    if(seen.has(n.id)) return;
    const stack=[n.id], comp=[];
    seen.add(n.id);
    while(stack.length){
      const cur=stack.pop(); comp.push(nodeById(cur));
      (adjacency.get(cur)||new Set()).forEach(nb=>{ if(!seen.has(nb)){ seen.add(nb); stack.push(nb); } });
    }
    if(comp.length<3) return;
    const centroid={x:avg(comp.map(n=>n.x))||0, y:avg(comp.map(n=>n.y))||0};
    const spread=avg(comp.map(n=>Math.hypot(n.x-centroid.x,n.y-centroid.y)))||0;
    let internalEdges=0, confirmed=0, candidate=0;
    for(let i=0;i<comp.length;i++) for(let j=i+1;j<comp.length;j++){
      const e=getEdgeBetween(comp[i].id, comp[j].id);
      if(e){ internalEdges++; if(e.status==='confirmed') confirmed++; else candidate++; }
    }
    const possiblePairs=(comp.length*(comp.length-1))/2 || 1;
    const density=internalEdges/possiblePairs;
    const ontologyCounts={}; comp.forEach(n=>ontologyCounts[n.cat]=(ontologyCounts[n.cat]||0)+1);
    const ontologyCoherence=(Math.max(...Object.values(ontologyCounts))||1)/comp.length;
    const cohesion=Math.max(0, Math.min(1, (1/(1+spread/140))*0.4 + density*0.4 + ontologyCoherence*0.2));
    const tight=cohesion>0.48 && density>0.22;
    clusters.push({
      ids:comp.map(n=>n.id), size:comp.length, centroid, spread, density,
      ontologyCoherence, cohesion, confirmed, candidate, tight,
      hull:convexHull(comp.map(n=>({x:n.x,y:n.y})))
    });
  });
  clusterDiagnostics=clusters.sort((a,b)=>b.cohesion-a.cohesion);
}
function clusterForNode(id){ return clusterDiagnostics.find(c=>c.ids.includes(id)) || null; }
function computeMoralValence(){
  const gamma=4.0, threshold=0.5;
  const empathyDriven=Math.tanh(gamma*(empathyField-threshold));
  return clamp((0.65*moralPolarity)+(0.35*empathyDriven), -1, 1);
}
function labelKey(n){ return String(n?.label||'').toLowerCase(); }
function localReceiverQ(n){
  const label=labelKey(n);
  let q=receiverQuality;
  if(label.includes('education') || label.includes('law') || label.includes('truth')) q += 0.06;
  if(label.includes('fear') || label.includes('trauma') || label.includes('dehumanization')) q -= 0.12;
  if(label.includes('historical memory') || label.includes('scarcity')) q -= 0.06;
  return clamp(q,0.20,1.00);
}
function edgeSpringWeight(e){
  if(e.status==='confirmed') return 1.0;
  return (e.confidence||0) >= 0.72 ? 0.25 : 0.0;
}
function nodeIntentGain(n){
  const label=labelKey(n);
  const valence=computeMoralValence();
  const localQ=localReceiverQ(n);
  if(label.includes('crime') || label.includes('harm') || label.includes('coercion') || label.includes('exploitation')) return (0.82 - Math.max(0,valence)*0.28) * (0.92 + (1-localQ)*0.16);
  if(label.includes('kindness') || label.includes('repair')) return (1.0 + Math.max(0,valence)*0.55) * (0.94 + localQ*0.12);
  if(label.includes('empathy') || label.includes('compassion')) return (1.0 + Math.max(0,valence)*0.45) * (0.94 + localQ*0.12);
  if(label.includes('collective') || label.includes('nation') || label.includes('identity')) return 1.0 + intentionStrength*0.45;
  if(label.includes('intention') || label.includes('action') || label.includes('moral valence') || label.includes('incentive') || label.includes('law')) return 1.0 + intentionStrength*0.60;
  return 0.96 + localQ*0.08;
}
function updateExperimentPanel(){
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
  set('receiver-value', receiverQuality.toFixed(2));
  set('metric-precision', experimentMetrics.precision.toFixed(3));
  set('metric-coherence', experimentMetrics.coherence.toFixed(3));
  set('metric-convergence', `${Math.round(experimentMetrics.convergence*100)}%`);
  set('metric-rq', experimentMetrics.receiverState);
  set('metric-moral', experimentMetrics.moralValence.toFixed(3));
  set('metric-collective', experimentMetrics.collectivePull.toFixed(3));
  set('intention-value', intentionStrength.toFixed(2));
  set('polarity-value', moralPolarity.toFixed(2));
  set('empathy-value', empathyField.toFixed(2));
  const note=document.getElementById('experiment-note');
  if(note) note.textContent = experimentMetrics.moralValence >= 0.2
    ? 'The field is currently resolving toward cooperative and kindness-weighted attractors.'
    : (experimentMetrics.moralValence <= -0.2
      ? 'The field is currently biased toward antisocial and crime-like pathways unless empathy rises.'
      : 'The field is near moral equilibrium; receiver tuning and empathy can still flip the attractor state.');
}
function updateEnergyReadout(){
  const confirmedCount=edges.filter(e=>e.status==='confirmed').length || 1;
  const candidateCount=edges.filter(e=>e.status==='possible').length;
  const hypothesisTension=Math.min(1, candidateCount/Math.max(confirmedCount,1));
  let structuralPull=0;
  let velocityMass=0;
  nodes.forEach(n=>{ velocityMass += Math.hypot(n.vx||0,n.vy||0); });
  edges.filter(e=>e.status==='confirmed').forEach(e=>{
    const a=nodeById(e.a), b=nodeById(e.b); if(!a||!b) return;
    structuralPull += Math.abs((Math.hypot(b.x-a.x,b.y-a.y))-(90+a.r+b.r));
  });
  structuralPull = structuralPull / confirmedCount;
  const energy = structuralPull + hypothesisTension*120 + velocityMass*0.18;
  const convergence = clamp(1 - (velocityMass / Math.max(nodes.length*3.4,1)), 0, 1);
  const localConfirmed = selected ? getConns(selected,'confirmed').length : 0;
  const localPossible = selected ? getConns(selected,'possible').length : 0;
  const moralValence = computeMoralValence();
  const collectivePull = clamp(intentionStrength * receiverQuality * Math.max(0, moralValence), 0, 1);
  const coherence = clamp((localConfirmed*0.10 + receiverQuality*0.44 + convergence*0.22 + collectivePull*0.16 + Math.max(0,moralValence)*0.10) - Math.min(localPossible*0.03,0.22), 0, 1);
  const precision = clamp((receiverQuality * 0.35) + (convergence * 0.22) + ((1 - Math.min(1, energy/240)) * 0.18) + (intentionStrength*0.12) + (Math.max(0,moralValence)*0.13), 0, 1);
  experimentMetrics={
    precision,
    coherence,
    convergence,
    receiverState: receiverQuality >= 0.85 ? 'High' : (receiverQuality >= 0.55 ? 'Medium' : 'Low'),
    moralValence,
    collectivePull
  };
  layoutDiagnostics={energy, structuralPull, hypothesisTension, settling:settled?'stable':'settling', velocityMass, precision, coherence, convergence, moralValence, collectivePull};
  const summary=document.getElementById('energy-summary');
  const detail=document.getElementById('energy-detail');
  if(summary) summary.innerHTML=`<strong>${settled?'Layout stable':'Layout settling'}</strong> · pull ${structuralPull.toFixed(1)} · Q ${receiverQuality.toFixed(2)} · Int ${intentionStrength.toFixed(2)}`;
  if(detail) detail.textContent=`Hypothesis tension ${hypothesisTension.toFixed(2)} · coherence ${coherence.toFixed(2)} · moral ${moralValence.toFixed(2)} · collective ${collectivePull.toFixed(2)}`;
  updateExperimentPanel();
}



function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function safeArray(v){ return Array.isArray(v)?v:[]; }
function dedupeCompact(arr){ return unique((arr||[]).map(v=>String(v||'').trim()).filter(Boolean)); }
function parseCitationTokens(ref=''){ return dedupeCompact(ref.split(/[;,]|\s{2,}/).map(s=>s.trim()).filter(Boolean)); }
function setResearchStatus(msg){ const el=document.getElementById('research-status'); if(el) el.innerHTML=msg; }
function renderSourceStatus(){
  const wrap=document.getElementById('hud-source-grid');
  if(!wrap) return;
  wrap.innerHTML='';
  const online=navigator.onLine!==false;
  const readyCount=Object.values(researchState.sources).filter(s=>s.state==='ok'||s.state==='idle').length;
  const statusEl=document.getElementById('research-status');
  if(statusEl && !researchState.pending){
    statusEl.innerHTML=`<span class="research-live-dot ${online?'':'offline'}"></span>${online?'API live':'Offline'} · ${readyCount}/${Object.keys(EXTERNAL_SOURCES).length} sources ready`;
  }
  Object.entries(EXTERNAL_SOURCES).forEach(([key,meta])=>{
    const s=researchState.sources[key]||{state:'idle',hits:0,last:null};
    const row=document.createElement('div'); row.className='source-pill';
    const name=document.createElement('div'); name.className='name'; name.textContent=meta.label;
    const state=document.createElement('div');
    const cls=s.state==='ok'?'ok':(s.state==='error'?'err':(s.state==='pending'?'warn':''));
    state.className='state '+cls;
    state.textContent=s.state==='idle'?'ready':(s.state==='pending'?'live':`${s.state}${s.hits?` · ${s.hits}`:''}`);
    row.appendChild(name); row.appendChild(state); wrap.appendChild(row);
  });
}
function setSourceState(key,state,hits=0){
  if(!researchState.sources[key]) researchState.sources[key]={state:'idle',hits:0,last:null};
  researchState.sources[key].state=state;
  researchState.sources[key].hits=hits;
  researchState.sources[key].last=new Date().toISOString();
  renderSourceStatus();
}
async function fetchJSON(url, opts={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(), opts.timeout||RESEARCH_TIMEOUT_MS);
  try{
    const res=await fetch(url,{headers:opts.headers||{},signal:controller.signal});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
function extractDoi(ref=''){ const m=String(ref).match(/10\.\d{4,9}\/[\-._;()\/:A-Z0-9]+/i); return m?m[0]:''; }
function buildResearchQuery(node){
  const base=[node.label,node.desc,node.ref].filter(Boolean).join(' ');
  return [node.label, ...tokenize(base).slice(0,10)].join(' ').trim();
}
function ensureResearchNodeShape(node){
  if(!node.research){
    node.research={lastSyncedAt:null, summary:'', sources:{}, identifiers:{}, signals:{topics:[],references:[],authors:[],entities:[],years:[],venues:[],abstractTokens:[],qualityScore:0}, notes:[]};
  }
  node.research.sources=node.research.sources||{};
  node.research.identifiers=node.research.identifiers||{};
  node.research.signals=node.research.signals||{topics:[],references:[],authors:[],entities:[],years:[],venues:[],abstractTokens:[],qualityScore:0};
  node.research.notes=node.research.notes||[];
  return node.research;
}
function mergeResearchPayload(node, payload){
  const r=ensureResearchNodeShape(node);
  const sig=r.signals;
  Object.entries(payload.sources||{}).forEach(([k,v])=>{ r.sources[k]=v; });
  Object.assign(r.identifiers, payload.identifiers||{});
  sig.topics=dedupeCompact([...(sig.topics||[]), ...safeArray(payload.signals?.topics)]);
  sig.references=dedupeCompact([...(sig.references||[]), ...safeArray(payload.signals?.references)]);
  sig.authors=dedupeCompact([...(sig.authors||[]), ...safeArray(payload.signals?.authors)]);
  sig.entities=dedupeCompact([...(sig.entities||[]), ...safeArray(payload.signals?.entities)]);
  sig.years=dedupeCompact([...(sig.years||[]), ...safeArray(payload.signals?.years)]).map(v=>Number(v)).filter(Boolean);
  sig.venues=dedupeCompact([...(sig.venues||[]), ...safeArray(payload.signals?.venues)]);
  sig.abstractTokens=dedupeCompact([...(sig.abstractTokens||[]), ...safeArray(payload.signals?.abstractTokens)]);
  sig.qualityScore=clamp(Math.max(sig.qualityScore||0, payload.signals?.qualityScore||0),0,1);
  r.notes=dedupeCompact([...(r.notes||[]), ...safeArray(payload.notes)]);
  r.lastSyncedAt=new Date().toISOString();
  const sources=Object.keys(r.sources).filter(k=>r.sources[k]?.hitCount);
  r.summary=sources.length ? `${sources.length} sources linked · ${sources.map(k=>EXTERNAL_SOURCES[k]?.label||k).join(', ')}` : 'No external matches linked yet';
  node._signals=computeNodeSignals(node);
}
async function fetchOpenAlex(node, query){
  setSourceState('openalex','pending');
  try{
    const url=`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=3&mailto=research-map@example.com`;
    const json=await fetchJSON(url);
    const results=safeArray(json.results).slice(0,3);
    const topics=results.flatMap(w=>safeArray(w.concepts).map(c=>c.display_name));
    const authors=results.flatMap(w=>safeArray(w.authorships).map(a=>a.author?.display_name));
    const refs=results.flatMap(w=>safeArray(w.referenced_works));
    const venues=results.map(w=>w.primary_location?.source?.display_name).filter(Boolean);
    const years=results.map(w=>w.publication_year).filter(Boolean);
    setSourceState('openalex', results.length?'ok':'idle', results.length);
    return {sources:{openalex:{hitCount:results.length, query, works:results.map(w=>({id:w.id,title:w.display_name,year:w.publication_year,citedBy:w.cited_by_count||0,doi:w.doi||'',topics:safeArray(w.concepts).slice(0,5).map(c=>c.display_name)}))}}, identifiers:{openalex:results[0]?.id||''}, signals:{topics,authors,references:refs,venues,years,abstractTokens:tokenize(results.map(w=>w.display_name).join(' ')),qualityScore:results.length?0.78:0}, notes:results.length?[`OpenAlex matched ${results.length} work(s).`]:[]};
  } catch(err){ setSourceState('openalex','error'); return {sources:{openalex:{hitCount:0,error:String(err.message||err)}} ,notes:[`OpenAlex sync error: ${err.message||err}`]}; }
}
async function fetchCrossref(node, query){
  setSourceState('crossref','pending');
  try{
    const doi=extractDoi(node.ref||'');
    const url=doi ? `https://api.crossref.org/works/${encodeURIComponent(doi)}` : `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=3`;
    const json=await fetchJSON(url,{headers:{'Accept':'application/json'}});
    const items=doi ? [json.message].filter(Boolean) : safeArray(json.message?.items).slice(0,3);
    const authors=items.flatMap(it=>safeArray(it.author).map(a=>[a.given,a.family].filter(Boolean).join(' ')));
    const refs=items.flatMap(it=>safeArray(it.reference).map(r=>r.DOI||r.article-title||r.unstructured));
    const venues=items.map(it=>safeArray(it['container-title'])[0]).filter(Boolean);
    const years=items.map(it=>it.issued?.['date-parts']?.[0]?.[0]).filter(Boolean);
    setSourceState('crossref', items.length?'ok':'idle', items.length);
    return {sources:{crossref:{hitCount:items.length, query, works:items.map(it=>({doi:it.DOI||'',title:safeArray(it.title)[0]||'',year:it.issued?.['date-parts']?.[0]?.[0]||'',publisher:it.publisher||'',referenceCount:it['reference-count']||0}))}}, identifiers:{doi:doi||items[0]?.DOI||''}, signals:{authors,references:refs,venues,years,topics:items.flatMap(it=>safeArray(it.subject||[])),abstractTokens:tokenize(items.map(it=>safeArray(it.title)[0]||'').join(' ')),qualityScore:items.length?0.72:0}, notes:items.length?[`Crossref linked ${items.length} bibliographic record(s).`]:[]};
  } catch(err){ setSourceState('crossref','error'); return {sources:{crossref:{hitCount:0,error:String(err.message||err)}} ,notes:[`Crossref sync error: ${err.message||err}`]}; }
}
async function fetchSemanticScholar(node, query){
  setSourceState('semanticscholar','pending');
  try{
    const url=`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=3&fields=paperId,title,year,authors,citationCount,externalIds,fieldsOfStudy`;
    const json=await fetchJSON(url);
    const items=safeArray(json.data).slice(0,3);
    const authors=items.flatMap(it=>safeArray(it.authors).map(a=>a.name));
    const topics=items.flatMap(it=>safeArray(it.fieldsOfStudy));
    const years=items.map(it=>it.year).filter(Boolean);
    const refs=items.flatMap(it=>Object.values(it.externalIds||{}));
    setSourceState('semanticscholar', items.length?'ok':'idle', items.length);
    return {sources:{semanticscholar:{hitCount:items.length, query, papers:items.map(it=>({paperId:it.paperId,title:it.title,year:it.year,citationCount:it.citationCount||0,externalIds:it.externalIds||{}}))}}, identifiers:{semanticScholar:items[0]?.paperId||''}, signals:{authors,topics,references:refs,years,abstractTokens:tokenize(items.map(it=>it.title).join(' ')),qualityScore:items.length?0.74:0}, notes:items.length?[`Semantic Scholar linked ${items.length} paper graph record(s).`]:[]};
  } catch(err){ setSourceState('semanticscholar','error'); return {sources:{semanticscholar:{hitCount:0,error:String(err.message||err)}} ,notes:[`Semantic Scholar sync error: ${err.message||err}`]}; }
}
async function fetchWikidata(node, query){
  setSourceState('wikidata','pending');
  try{
    const url=`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(node.label)}&language=en&limit=3&format=json&origin=*`;
    const json=await fetchJSON(url);
    const items=safeArray(json.search).slice(0,3);
    const entities=items.map(it=>it.label).filter(Boolean);
    const topics=items.flatMap(it=>tokenize(`${it.label||''} ${it.description||''}`));
    setSourceState('wikidata', items.length?'ok':'idle', items.length);
    return {sources:{wikidata:{hitCount:items.length, query, entities:items.map(it=>({id:it.id,label:it.label,description:it.description||'',concepturi:it.concepturi||''}))}}, identifiers:{wikidata:items[0]?.id||''}, signals:{entities,topics,abstractTokens:topics,qualityScore:items.length?0.6:0}, notes:items.length?[`Wikidata linked ${items.length} entity match(es).`]:[]};
  } catch(err){ setSourceState('wikidata','error'); return {sources:{wikidata:{hitCount:0,error:String(err.message||err)}} ,notes:[`Wikidata sync error: ${err.message||err}`]}; }
}
async function enrichNodeFromSources(node, opts={}){
  if(!node) return null;
  ensureResearchNodeShape(node);
  const query=buildResearchQuery(node);
  if(!opts.silent) setResearchStatus(`Syncing research for ${node.label}…`);
  researchState.pending=true;
  researchState.pendingCount=(researchState.pendingCount||0)+1;
  const payloads=await Promise.allSettled([fetchOpenAlex(node,query), fetchCrossref(node,query), fetchSemanticScholar(node,query), fetchWikidata(node,query)]);
  payloads.forEach(p=>{ if(p.status==='fulfilled' && p.value) mergeResearchPayload(node,p.value); });
  node.research.lastQuery=query;
  node.research.lastSyncedAt=new Date().toISOString();
  researchState.lastSyncAt=node.research.lastSyncedAt;
  researchState.lastSyncTarget=node.label;
  researchState.pendingCount=Math.max(0,(researchState.pendingCount||1)-1);
  researchState.pending=researchState.pendingCount>0;
  recomputeCandidateEdges();
  updateCounter();
  if(selected && selected.id===node.id) showPanel(node);
  const sourceHits=Object.values(node.research.sources||{}).reduce((sum,s)=>sum+(s?.hitCount||0),0);
  if(!opts.silent) setResearchStatus(sourceHits?`Last sync: ${node.label} · ${sourceHits} linked record(s).`:`Last sync: ${node.label} · no strong matches.`);
  return node;
}
async function enrichNodeSet(nodeSet, opts={}){
  const targets=(nodeSet||[]).filter(Boolean);
  if(!targets.length){ toast('No nodes available for research sync'); return; }
  setResearchStatus(`Syncing ${targets.length} thought${targets.length===1?'':'s'}…`);
  for(const node of targets){ await enrichNodeFromSources(node,{silent:true}); }
  const label=opts.label||`${targets.length} thoughts`;
  setResearchStatus(`Last sync: ${label} · ${new Date().toLocaleString()}`);
  toast(`Research sync complete · ${targets.length} thought${targets.length===1?'':'s'}`);
  if(selected) showPanel(selected);
}
function drawStars(){
  bgX.clearRect(0,0,W,H);
  [[W*.3,H*.35,W*.55,'rgba(40,24,90,0.05)'],[W*.72,H*.6,W*.45,'rgba(20,40,80,0.04)'],[W*.5,H*.8,W*.3,'rgba(80,20,60,0.03)']].forEach(([cx,cy,rad,col])=>{
    const g=bgX.createRadialGradient(cx,cy,0,cx,cy,rad);
    g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');
    bgX.fillStyle=g;bgX.fillRect(0,0,W,H);
  });
  for(let i=0;i<500;i++){
    const x=pr(i*3+7)*W,y=pr(i*3+8)*H,r=pr(i*3+9)*1.6,a=0.1+pr(i+7)*.7;
    bgX.beginPath();bgX.arc(x,y,r,0,Math.PI*2);
    bgX.fillStyle=`rgba(${175+Math.floor(pr(i*7)*70)},${175+Math.floor(pr(i*7+1)*70)},${215+Math.floor(pr(i*7+2)*35)},${a})`;
    bgX.fill();
  }
}
function drawWaveField(){
  drawStars();
  bgX.save();
  const fieldGain = 0.18 + receiverQuality*0.24;
  bgX.globalAlpha=fieldGain;
  const spacing=Math.max(24, Math.min(42, 32/Math.max(cam.z,0.55)));
  const sx=Math.floor(W/spacing)+3;
  const sy=Math.floor(H/spacing)+3;
  const disturbance=selected?{x:W/2+cam.x+selected.x*cam.z,y:H/2+cam.y+selected.y*cam.z}:null;
  const disturbanceScale = 5 + receiverQuality*15;
  const longScale = 6 + receiverQuality*4;
  for(let yi=-1; yi<sy; yi++){
    bgX.beginPath();
    for(let xi=-1; xi<sx; xi++){
      const x=xi*spacing, y=yi*spacing;
      const long=Math.sin(x*0.007 + waveTime*(0.55+receiverQuality*0.7)) * Math.cos(y*0.01 - waveTime*(0.35+receiverQuality*0.4));
      let disturbanceTerm=0;
      if(disturbance){
        const dx=x-disturbance.x, dy=y-disturbance.y;
        const d=Math.sqrt(dx*dx+dy*dy)+1;
        disturbanceTerm=Math.sin(d*0.045-waveTime*(1.1+receiverQuality*1.4))*Math.exp(-d/(260-(receiverQuality*70)))*disturbanceScale;
      }
      const yy=y+long*longScale+disturbanceTerm;
      if(xi===-1) bgX.moveTo(x,yy); else bgX.lineTo(x,yy);
    }
    bgX.strokeStyle=`rgba(132,145,214,${(0.05+receiverQuality*0.10).toFixed(3)})`;
    bgX.lineWidth=1;
    bgX.stroke();
  }
  bgX.restore();
}


const SCENARIO_PRESETS = {
  balanced:{label:'Balanced Test', rq:0.74, intention:0.55, polarity:0.00, empathy:0.56, note:'Symmetry check: balanced moral geometry with moderate receiver quality.'},
  world:{label:'World Mode', rq:0.62, intention:0.58, polarity:-0.06, empathy:0.42, note:'Realism check: institutions, scarcity, and memory create uneven pressure.'},
  crisis:{label:'Crisis Shock', rq:0.40, intention:0.72, polarity:-0.42, empathy:0.22, note:'Stress test: low receiver quality and threat amplification destabilize cooperation.'},
  repair:{label:'Repair Cycle', rq:0.82, intention:0.64, polarity:0.24, empathy:0.84, note:'Recovery check: empathy, legitimacy, and coordination pull the graph back together.'}
};
function syncExperimentSliders(){
  const rs=document.getElementById('receiver-slider'), ins=document.getElementById('intention-slider'), ps=document.getElementById('polarity-slider'), es=document.getElementById('empathy-slider');
  if(rs) rs.value=receiverQuality.toFixed(2);
  if(ins) ins.value=intentionStrength.toFixed(2);
  if(ps) ps.value=moralPolarity.toFixed(2);
  if(es) es.value=empathyField.toFixed(2);
  updateExperimentPanel();
}
function nudgeScenario(kind){
  const push=(match, fx, fy)=>nodes.forEach(n=>{ if(labelKey(n).includes(match) && !n.pinned){ n.vx += fx; n.vy += fy; }});
  if(kind==='crisis'){
    push('fear', 0.8, -0.2); push('crime', 1.1, 0.2); push('harm', 0.9, 0.3); push('trust', -0.6, 0.0); push('cooperation', -0.5, 0.0);
  }
  if(kind==='repair'){
    push('empathy', -0.5, -0.2); push('kindness', -0.6, -0.1); push('trust', -0.5, -0.1); push('law', -0.35, -0.05); push('harm', 0.45, 0.1);
  }
}
function applyScenarioPreset(name){
  const p=SCENARIO_PRESETS[name]; if(!p) return;
  receiverQuality=p.rq; intentionStrength=p.intention; moralPolarity=p.polarity; empathyField=p.empathy;
  settled=false; simAge=Math.max(0, simAge-40); syncExperimentSliders(); resetFieldDynamics(); nudgeScenario(name);
  const note=document.getElementById('scenario-note'); if(note) note.textContent=p.note;
  const exp=document.getElementById('experiment-note'); if(exp) exp.textContent=p.note;
}
function initGraph(){
  const cp={};
  CATEGORIES.forEach((c,i)=>{
    const a=(i/CATEGORIES.length)*Math.PI*2-Math.PI/2, d=260;
    cp[c.id]={x:Math.cos(a)*d,y:Math.sin(a)*d};
  });
  nodes=SEED_NODES.map(n=>{
    const p=cp[n.cat];
    const a=pr(n.id*17)*Math.PI*2, d=50+pr(n.id*31)*130;
    const node={...n,evidence:n.evidence||'research-grounded',consensus:n.consensus||'curated',sourceType:n.sourceType||'seeded-curation',reviewState:n.reviewState||'seeded-review',provenance:n.provenance||'seed-dataset',research:n.research||{lastSyncedAt:null, summary:'', sources:{}, identifiers:{}, signals:{topics:[],references:parseCitationTokens(n.ref||''),authors:[],entities:[],years:extractYears(n.ref||''),venues:[],abstractTokens:[],qualityScore:0}, notes:[]},x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d,vx:(pr(n.id)-0.5)*3,vy:(pr(n.id*2)-0.5)*3,pinned:false,alpha:1,visible:true};
    node._signals=computeNodeSignals(node);
    return node;
  });
  edges=SEED_EDGES.map(([a,b])=>createEdge(a,b,{status:'confirmed', relation:'related', notes:'Seeded confirmed relation', citations:['seed-curation'], provenance:{source:'seed-curation'}, review:{state:'confirmed', reviewedAt:'2026-03-27', reviewedBy:'curator'}}));
  recomputeCandidateEdges();
  updateCounter();
}
function recomputeCandidateEdges(){
  const confirmedPairs=new Set(edges.filter(e=>e.status==='confirmed').map(e=>edgeKey(e.a,e.b)));
  edges=edges.filter(e=>e.status==='confirmed');
  const neighborMap=buildConfirmedNeighborMap();
  const candidates=[];
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i], b=nodes[j];
      if(confirmedPairs.has(edgeKey(a.id,b.id))) continue;
      const scored=scoreCandidate(a,b,neighborMap);
      if(scored.score>=CANDIDATE_THRESHOLD){
        candidates.push(createEdge(a.id,b.id,{status:'possible', relation:a.cat===b.cat?'topic-adjacent':'candidate-bridge', confidence:Number(scored.score.toFixed(3)), basis:scored.basis, notes:'Research-grounded candidate inferred from overlap and graph structure. Never auto-promoted.', rationale:scored.basis.join(' · '), provenance:{source:'candidate-scoring-layer', sources:Object.keys(EXTERNAL_SOURCES)}, review:{state:'pending-review', reviewedAt:null, reviewedBy:'human'}, scoreComponents:scored.components, evidenceClass:'candidate-inference', consensus:'needs-review'}));
      }
    }
  }
  edges.push(...candidates.sort((x,y)=>y.confidence-x.confidence));
  computeClusterDiagnostics();
}
function centerOnNode(n, zoom=Math.max(cam.z, 1.2)){ cam.z=Math.min(zoom, 2.5); cam.x=-n.x*cam.z; cam.y=-n.y*cam.z; }
function fitAll(){
  if(!nodes.length)return;
  let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
  nodes.forEach(n=>{mnX=Math.min(mnX,n.x-n.r);mxX=Math.max(mxX,n.x+n.r);mnY=Math.min(mnY,n.y-n.r);mxY=Math.max(mxY,n.y+n.r);});
  const w=mxX-mnX+160,h=mxY-mnY+160;
  cam.z=Math.max(0.12,Math.min(1.5,Math.min(W/w,H/h)));
  cam.x=-(mnX+mxX)/2*cam.z; cam.y=-(mnY+mxY)/2*cam.z;
}
function applyViewMode(mode){
  currentView=mode;
  document.querySelectorAll('.view-btn').forEach(btn=>btn.classList.toggle('active', btn.dataset.view===mode));
  settled=false; simAge=0;
  if(mode==='research'){ fitAll(); return; }
  if(mode==='structure'){
    const spreadX=Math.min(300, W*0.18), spreadY=Math.min(180, H*0.16);
    CATEGORIES.forEach((c,i)=>{ const row=Math.floor(i/3), col=i%3; c._targetX=(col-1)*spreadX*1.9; c._targetY=(row-1.5)*spreadY*1.7; });
    nodes.forEach((n,idx)=>{ const c=CMAP[n.cat]; const angle=(idx%12)/12*Math.PI*2; const ring=24+((idx%7)*10); n.x=(c?c._targetX:0)+Math.cos(angle)*ring; n.y=(c?c._targetY:0)+Math.sin(angle)*ring; n.vx=(seededRandom()-.5)*0.5; n.vy=(seededRandom()-.5)*0.5; });
    fitAll(); return;
  }
  if(mode==='hypothesis'){ if(selected){ centerOnNode(selected, 1.42); } else if(nodes[0]) { centerOnNode(nodes[0], 1.02); } return; }
  if(mode==='field'){ if(selected){ centerOnNode(selected, 1.62); } else if(nodes[0]) { centerOnNode(nodes[0], 1.08); } }
}
function updateCounter(){
  document.getElementById('node-count').textContent=nodes.length;
  document.getElementById('metric-nodes').textContent=nodes.length;
  document.getElementById('metric-edges').textContent=edges.filter(e=>e.status==='confirmed').length;
  document.getElementById('metric-candidates').textContent=edges.filter(e=>e.status==='possible').length;
  document.getElementById('metric-domains').textContent=CATEGORIES.length;
  computeClusterDiagnostics();
  updateEnergyReadout();
}
function tick(){
  if(paused) return;
  simAge++; waveTime += 0.012 + receiverQuality*0.009;
  const cooling=Math.max(0.3, 1-simAge/400);
  const effectiveIntention=intentionStrength*receiverQuality;
  const moralValence=computeMoralValence();
  const collectivePull=clamp(effectiveIntention*Math.max(0,moralValence),0,1);
  // ------------------------------------------------------------------
  // Dynamic edge activation
  //
  // For each edge we compute an activity factor that reflects how
  // salient the pathway should be under current receiver quality,
  // intention strength, moral polarity, empathy field, and local
  // conditions. Confirmed relations and strong candidate hypotheses
  // remain epistemically separate; the activity factor influences
  // visual emphasis and spring strength without altering the
  // underlying evidence graph.
  edges.forEach(e=>{
    const a=nodeById(e.a), b=nodeById(e.b);
    if(!a||!b){ e.activeFactor=1; return; }
    // Average node intent gain as baseline
    const ig=(nodeIntentGain(a)+nodeIntentGain(b))/2;
    // Local receiver quality averaged across the edge
    const localQ=(localReceiverQ(a)+localReceiverQ(b))/2;
    // Positive and negative moral components
    const v=moralValence;
    const positivity=Math.max(0,v);
    const negativity=Math.max(0,-v);
    // Determine whether this edge connects concepts that are broadly
    // prosocial or harmful based on keyword matches
    const la=labelKey(a);
    const lb=labelKey(b);
    let isHarmful=false, isProsocial=false;
    HARMFUL_KEYWORDS.forEach(k=>{ if(!isHarmful && (la.includes(k)||lb.includes(k))) isHarmful=true; });
    PROSOCIAL_KEYWORDS.forEach(k=>{ if(!isProsocial && (la.includes(k)||lb.includes(k))) isProsocial=true; });
    // Start with neutral factor
    let factor=1;
    // Prosocial edges are emphasised when moral valence is positive
    // and empathy is high. Local receiver quality also boosts prosocial clarity.
    if(isProsocial){
      factor += positivity*0.6 + (empathyField-0.5)*0.4;
      factor *= (localQ*0.5 + 0.5);
    }
    // Harmful edges are emphasised when moral valence is negative
    // or empathy is low. Lower receiver quality amplifies harmful perception.
    if(isHarmful){
      factor += negativity*0.6 + (0.5-empathyField)*0.4;
      factor *= ((1-localQ)*0.5 + 0.5);
    }
    // Combine with baseline intent gain and clamp to reasonable range
    const activity=ig*factor;
    e.activeFactor=Math.max(0.2, Math.min(1.8, activity));
  });
  const REPEL=(3200*cooling+800)*(0.82 + receiverQuality*0.36 - collectivePull*0.06);
  const SPRING=0.009 + receiverQuality*0.008 + effectiveIntention*0.004;
  const DAMP=clamp(0.70 + receiverQuality*0.18 + Math.max(0,moralValence)*0.03, 0.70, 0.90);
  const GRAVITY=0.009 - receiverQuality*0.004 + Math.max(0,moralValence)*0.0008;
  nodes.forEach(n=>{
    if(n.pinned)return;
    n.vx-=n.x*GRAVITY;n.vy-=n.y*GRAVITY;
    nodes.forEach(m=>{ if(m===n)return; const dx=n.x-m.x,dy=n.y-m.y,d2=dx*dx+dy*dy+4,f=REPEL/d2; n.vx+=dx*f;n.vy+=dy*f; });
    n.vx*=DAMP;n.vy*=DAMP; n.x+=n.vx;n.y+=n.vy;
  });
  edges.forEach(e=>{
    const weight=edgeSpringWeight(e);
    if(weight<=0) return;
    const a=nodeById(e.a),b=nodeById(e.b);if(!a||!b)return;
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
    const localGain=((nodeIntentGain(a)+nodeIntentGain(b))*0.5) * (1 + effectiveIntention*0.55 + Math.max(0,moralValence)*0.20);
    const antisocial=(labelKey(a).includes('crime')||labelKey(b).includes('crime')||labelKey(a).includes('harm')||labelKey(b).includes('harm')||labelKey(a).includes('coercion')||labelKey(b).includes('coercion'));
    const moralShift=antisocial ? (1 - Math.max(0,moralValence)*0.25) : 1;
    const tgt=90+a.r+b.r,f=(d-tgt)*SPRING*localGain*moralShift*weight;
    const fx=dx/d*f,fy=dy/d*f;
    if(!a.pinned){a.vx+=fx;a.vy+=fy;} if(!b.pinned){b.vx-=fx;b.vy-=fy;}
  });
  const collectiveNodes=nodes.filter(n=>{ const l=labelKey(n); return l.includes('collective') || l.includes('cooperation') || l.includes('trust'); });
  const collectiveCentroid=collectiveNodes.length ? {
    x: collectiveNodes.reduce((s,n)=>s+n.x,0)/collectiveNodes.length,
    y: collectiveNodes.reduce((s,n)=>s+n.y,0)/collectiveNodes.length
  } : {x:0,y:0};
  nodes.forEach(n=>{
    if(!n.pinned){
      const label=labelKey(n);
      if(label.includes('crime') || label.includes('harm') || label.includes('coercion') || label.includes('exploitation')){
        n.vx += (n.x-collectiveCentroid.x)*0.0008*Math.max(0,moralValence);
        n.vy += (n.y-collectiveCentroid.y)*0.0008*Math.max(0,moralValence);
      }
      if(label.includes('kindness') || label.includes('empathy') || label.includes('compassion') || label.includes('collective') || label.includes('cooperation') || label.includes('law') || label.includes('education')){
        n.vx += (collectiveCentroid.x-n.x)*(0.0012*collectivePull + 0.0006*Math.max(0,moralValence));
        n.vy += (collectiveCentroid.y-n.y)*(0.0012*collectivePull + 0.0006*Math.max(0,moralValence));
      }
      let layerY=null;
      if(['emotion','self','cognitive','neuroscience'].includes(n.cat)) layerY=-120;
      else if(['society'].includes(n.cat)) layerY=70;
      if(layerY!==null){ n.vy += (layerY - n.y) * 0.00035; }
    }
    const matchSearch=!searchTerm||(n.label.toLowerCase().includes(searchTerm)||n.desc.toLowerCase().includes(searchTerm));
    const matchCat=!filterCat||n.cat===filterCat;
    n.visible=matchSearch&&matchCat; n.alpha=n.visible?1:0.07;
  });
  if(simAge>350&&!settled){settled=true;}
  document.getElementById('sim-status').textContent=settled ? `layout stable · tension ${layoutDiagnostics.hypothesisTension.toFixed(2)} · Q ${receiverQuality.toFixed(2)} · M ${layoutDiagnostics.moralValence.toFixed(2)}` : `layout settling · pull ${layoutDiagnostics.structuralPull.toFixed(1)} · Q ${receiverQuality.toFixed(2)} · Int ${intentionStrength.toFixed(2)}`;
  updateEnergyReadout();
}
function getEdgeBetween(a,b,status=null){
  return edges.find(e=>((e.a===a&&e.b===b)||(e.a===b&&e.b===a)) && (!status || e.status===status)) || null;
}
function selectedPossibleLabelIds(){ return selected ? new Set(getConns(selected,'possible').map(n=>n.id)) : new Set(); }
function selectedPossibleEdgeMap(){
  const map=new Map();
  if(!selected) return map;
  edges.forEach(e=>{
    if(e.status!=='possible') return;
    if(e.a===selected.id) map.set(e.b,e);
    else if(e.b===selected.id) map.set(e.a,e);
  });
  return map;
}
function selectedConfirmedLabelIds(){ return selected ? new Set(getConns(selected,'confirmed').map(n=>n.id)) : new Set(); }
function nodeIsInViewport(n, pad=42){
  const sx=W/2+cam.x+n.x*cam.z;
  const sy=H/2+cam.y+n.y*cam.z;
  const rr=(n.r*cam.z)+pad;
  return sx>=-rr && sx<=W+rr && sy>=-rr && sy<=H+rr;
}
function shouldShowNodeLabel(n, possibleEdgeMap, confirmedLabelSet){
  const isH=hovered===n, isS=selected===n;
  const confirmedRelatedLabel=confirmedLabelSet.has(n.id);
  const possibleEdge=possibleEdgeMap.get(n.id)||null;
  const possibleRelatedLabel=Boolean(possibleEdge);
  const viewportZoomLabel=cam.z>=1.12 && n.visible && nodeIsInViewport(n, 18);
  const baseShowLabel=cam.z>0.62||isH||isS||currentView==='structure'||viewportZoomLabel||confirmedRelatedLabel;
  return {baseShowLabel, possibleRelatedLabel, confirmedRelatedLabel, possibleEdge, viewportZoomLabel};
}
function draw(){
  drawWaveField();
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2+cam.x,H/2+cam.y); ctx.scale(cam.z,cam.z);
  const possibleLabelSet=selectedPossibleLabelIds();
  const possibleEdgeMap=selectedPossibleEdgeMap();
  const confirmedLabelSet=selectedConfirmedLabelIds();
  const modeHighlightSet=getNeighborHighlightSet();
  clusterDiagnostics.filter(c=>c.tight && c.hull.length>=3).slice(0,6).forEach(c=>{
    ctx.beginPath();
    c.hull.forEach((p,idx)=>{ if(idx===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
    ctx.closePath();
    ctx.fillStyle='rgba(245,217,122,0.035)';
    ctx.strokeStyle='rgba(245,217,122,0.20)';
    ctx.lineWidth=1.1;
    ctx.setLineDash([8,6]);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  });
  edges.forEach(e=>{
    const a=nodeById(e.a),b=nodeById(e.b);if(!a||!b)return;
    const al=Math.min(a.alpha,b.alpha), isSel=selected&&(selected.id===a.id||selected.id===b.id);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    const highlight = selected && (selected.id===e.a||selected.id===e.b || (modeHighlightSet.has(e.a)&&modeHighlightSet.has(e.b)));
    // Dynamic edge visual weighting
    const active = typeof e.activeFactor==='number' ? e.activeFactor : 1;
    // Clamp dynamic factor to avoid extreme scaling
    const weightFactor = clamp(active, 0.6, 1.5);
    if(e.status==='possible'){
      ctx.setLineDash([7,7]);
      const baseAlpha = currentView==='structure' ? 0.04 : currentView==='field' ? 0.12 : currentView==='hypothesis' ? 0.24 : 0.14;
      // Scale the base alpha by the dynamic weight factor so that edges become brighter or dimmer
      const dynamicAlpha = baseAlpha * weightFactor;
      const widthBase = highlight?1.25:(isSel?1.1:0.82);
      ctx.strokeStyle=`rgba(168,174,184,${(highlight?0.52:(isSel?0.42:dynamicAlpha))*al})`;
      ctx.lineWidth = widthBase * weightFactor;
    } else {
      ctx.setLineDash([]);
      const goldAlpha = currentView==='hypothesis' ? 0.46 : currentView==='field' ? 0.32 : currentView==='structure' ? 0.72 : 0.58;
      // Scale confirmed-edge alpha similarly to emphasise or de-emphasise pathways
      const dynamicAlpha = goldAlpha * weightFactor;
      const widthBase = highlight?1.95:(isSel?1.75:1.35);
      ctx.strokeStyle=`rgba(245,217,122,${(highlight?0.92:(isSel?0.82:dynamicAlpha))*al})`;
      ctx.lineWidth = widthBase * weightFactor;
    }
    ctx.stroke(); ctx.setLineDash([]);
  });
  nodes.forEach(n=>{
    const cat=CMAP[n.cat]||CMAP.philosophy, isH=hovered===n, isS=selected===n, a=n.alpha;
    const selectedPossibleEdge=possibleEdgeMap.get(n.id)||null;
    const isPossibleNeighbor=possibleLabelSet.has(n.id);
    const isConfirmedNeighbor=confirmedLabelSet.has(n.id);
    const modeNeighbor=modeHighlightSet.has(n.id);
    const displayAlpha=(isPossibleNeighbor && selectedPossibleEdge) ? Math.max(a, 0.78) : (isConfirmedNeighbor ? Math.max(a,0.92) : (modeNeighbor ? Math.max(a,0.76) : a));
    if(isH||isS||modeNeighbor){ const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r*(isS?5.2:4.1)); g.addColorStop(0,isS?'rgba(120,160,255,0.22)':cat.glow.replace('.55',`.${Math.round(38*displayAlpha)}`)); g.addColorStop(1,'rgba(0,0,0,0)'); ctx.beginPath();ctx.arc(n.x,n.y,n.r*(isS?5.2:4.1),0,Math.PI*2);ctx.fillStyle=g;ctx.fill(); }
    if(isS){
      const pulse=1+0.08*Math.sin(waveTime*3.2);
      for(let ring=1; ring<=3; ring++){
        ctx.beginPath();
        ctx.arc(n.x,n.y,(n.r+10*ring)*pulse,0,Math.PI*2);
        ctx.strokeStyle=`rgba(120,160,255,${0.16-(ring*0.03)})`;
        ctx.lineWidth=1.2-(ring*0.18);
        ctx.stroke();
      }
    }
    if(connectMode&&connectFrom===n){ const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r*5); g.addColorStop(0,'rgba(240,192,96,0.35)');g.addColorStop(1,'rgba(0,0,0,0)'); ctx.beginPath();ctx.arc(n.x,n.y,n.r*5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill(); }
    const gr=ctx.createRadialGradient(n.x-n.r*.35,n.y-n.r*.35,0,n.x,n.y,n.r);
    gr.addColorStop(0,cat.color+'f0'); gr.addColorStop(0.55,cat.color+(Math.round(0xaa*displayAlpha).toString(16).padStart(2,'0'))); gr.addColorStop(1,cat.color+(Math.round(0x33*displayAlpha).toString(16).padStart(2,'0')));
    ctx.globalAlpha=displayAlpha; ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=gr;ctx.fill(); ctx.globalAlpha=1;
    if(isS){ctx.beginPath();ctx.arc(n.x,n.y,n.r+5,0,Math.PI*2);ctx.strokeStyle=`rgba(240,192,96,${0.75*displayAlpha})`;ctx.lineWidth=1.5;ctx.stroke();}
    else if(isH){ctx.beginPath();ctx.arc(n.x,n.y,n.r+3,0,Math.PI*2);ctx.strokeStyle=`rgba(255,255,255,${0.28*displayAlpha})`;ctx.lineWidth=1;ctx.stroke();}
    else if(selectedPossibleEdge){ctx.beginPath();ctx.arc(n.x,n.y,n.r+2.9,0,Math.PI*2);ctx.strokeStyle=`rgba(176,184,192,${0.56+((selectedPossibleEdge.confidence||0)*0.2)})`;ctx.lineWidth=1.05;ctx.stroke();}
    else if(isConfirmedNeighbor){ctx.beginPath();ctx.arc(n.x,n.y,n.r+3.4,0,Math.PI*2);ctx.strokeStyle=`rgba(245,217,122,${0.78*Math.max(displayAlpha,0.88)})`;ctx.lineWidth=1.35;ctx.stroke();}
    else if(modeNeighbor){ctx.beginPath();ctx.arc(n.x,n.y,n.r+2.2,0,Math.PI*2);ctx.strokeStyle='rgba(188,220,255,0.46)';ctx.lineWidth=1;ctx.stroke();}
    const {baseShowLabel, possibleRelatedLabel, confirmedRelatedLabel, possibleEdge, viewportZoomLabel}=shouldShowNodeLabel(n, possibleEdgeMap, confirmedLabelSet);
    if(baseShowLabel||possibleRelatedLabel||confirmedRelatedLabel){
      let labelAlpha=Math.max(0,Math.min(1,(cam.z-0.35)*2.5))*displayAlpha, fontSize=Math.max(10, Math.round(10.5/cam.z));
      if(confirmedRelatedLabel){
        labelAlpha=Math.max(labelAlpha, 0.92*Math.max(displayAlpha,0.9));
        fontSize=Math.max(10, Math.round(10.8/cam.z));
        ctx.fillStyle='rgba(245,217,122,0.98)';
      } else if(possibleRelatedLabel && !baseShowLabel){
        const edgeConfidence=possibleEdge?.confidence ?? 0.5;
        labelAlpha=(POSSIBLE_LABEL_BASE_ALPHA + edgeConfidence*0.18) * Math.max(displayAlpha,0.8);
        fontSize=Math.max(10, Math.round(10.25/cam.z));
        ctx.fillStyle='rgba(150,156,166,0.94)';
      } else if(viewportZoomLabel){
        labelAlpha=Math.max(labelAlpha,0.82*displayAlpha);
        ctx.fillStyle='rgba(235,230,215,0.98)';
      } else {
        ctx.fillStyle='rgba(235,230,215,1)';
      }
      ctx.globalAlpha=Math.min(1, labelAlpha);
      ctx.font=`${fontSize}px Josefin Sans`; ctx.textAlign='center';ctx.textBaseline='top'; ctx.fillText(n.label,n.x,n.y+n.r+5/cam.z); ctx.globalAlpha=1;
    }
  });
  ctx.restore();
}
function drawMinimap(){
  const MW=mm.width=160,MH=mm.height=110; mmx.clearRect(0,0,MW,MH); mmx.fillStyle='rgba(3,3,12,0.5)'; mmx.fillRect(0,0,MW,MH);
  if(!nodes.length)return;
  let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
  nodes.forEach(n=>{mnX=Math.min(mnX,n.x);mxX=Math.max(mxX,n.x);mnY=Math.min(mnY,n.y);mxY=Math.max(mxY,n.y);});
  const pad=30,scx=(MW-pad*2)/(mxX-mnX||1),scy=(MH-pad*2)/(mxY-mnY||1),sc=Math.min(scx,scy),ox=MW/2-(mnX+mxX)/2*sc,oy=MH/2-(mnY+mxY)/2*sc;
  edges.forEach(e=>{ const a=nodeById(e.a),b=nodeById(e.b);if(!a||!b)return; mmx.beginPath();mmx.moveTo(a.x*sc+ox,a.y*sc+oy);mmx.lineTo(b.x*sc+ox,b.y*sc+oy); mmx.strokeStyle=e.status==='possible'?'rgba(168,174,184,0.18)':'rgba(245,217,122,0.30)'; mmx.lineWidth=0.5; mmx.stroke(); });
  nodes.forEach(n=>{ const cat=CMAP[n.cat]||CMAP.philosophy; mmx.beginPath();mmx.arc(n.x*sc+ox,n.y*sc+oy,Math.max(1.5,n.r*sc),0,Math.PI*2); mmx.fillStyle=cat.color+(n.visible?'cc':'33'); mmx.fill(); });
  const vl=(-W/2-cam.x)/cam.z,vt=(-H/2-cam.y)/cam.z,vr=vl+W/cam.z,vb=vt+H/cam.z;
  mmx.strokeStyle='rgba(240,192,96,0.5)';mmx.lineWidth=1; mmx.strokeRect(vl*sc+ox,vt*sc+oy,(vr-vl)*sc,(vb-vt)*sc);
}
function worldPos(e){ const r=gc.getBoundingClientRect(); return{x:(e.clientX-r.left-W/2-cam.x)/cam.z,y:(e.clientY-r.top-H/2-cam.y)/cam.z}; }
function nodeAt(wp){ return nodes.find(n=>Math.hypot(n.x-wp.x,n.y-wp.y)<=n.r+7)||null; }

function renderEdgeInspector(edge){
  selectedEdge=edge||null;
  const scoreList=document.getElementById('dp-score-list');
  const edgeCitationBox=document.getElementById('dp-edge-citations');
  const edgeNotes=document.getElementById('dp-edge-notes');
  const epistemic=document.getElementById('dp-epistemic');
  const source=nodeById(edge.a), target=nodeById(edge.b);
  const components=edge.scoreComponents||{};
  const ordered=[
    ['Semantic similarity', components.semanticSimilarity],
    ['Citation overlap', components.citationOverlap],
    ['Topic overlap', components.sharedTopics],
    ['Shared neighbors', components.sharedNeighbors],
    ['Ontology match', components.ontologyMatch],
    ['Recency', components.recencyWeight],
    ['Final score', edge.confidence],
    ['Threshold', CANDIDATE_THRESHOLD]
  ];
  scoreList.innerHTML='';
  ordered.forEach(([k,v])=>{
    const item=document.createElement('div');
    item.className='score-tile';
    item.innerHTML=`<div class="k">${k}</div><div class="v">${typeof v==='number' ? v.toFixed(2) : '—'}</div>`;
    scoreList.appendChild(item);
  });
  const prov=edge.provenance||{};
  edgeNotes.textContent=`${source?.label||'Source'} ↔ ${target?.label||'Target'} · ${epistemicStateForEdge(edge)}. S = ${(edge.confidence||0).toFixed(2)} (τ = ${CANDIDATE_THRESHOLD.toFixed(2)}). ${edge.rationale||edge.notes||'No rationale supplied.'}`;
  epistemic.textContent=epistemicStateForEdge(edge);
  const provParts=[
    `source type: ${edge.status==='confirmed'?'confirmed structure':'candidate scoring functional'}`,
    `review state: ${reviewStateLabel(edge.review?.state||edge.status)}`,
    `evidence class: ${edge.evidenceClass||'unknown'}`,
    `citation count: ${edge.citations?.length||0}`,
    `confidence: ${(edge.confidence||0).toFixed(2)}`,
    `produced by: ${prov.source||'unknown'}`
  ];
  edgeCitationBox.textContent=provParts.join(' · ');
}
function showPanel(n){
  selected=n;
  if(selectedEdge && !(selectedEdge.a===n.id||selectedEdge.b===n.id)) selectedEdge=null;
  const confirmed=getConns(n,'confirmed');
  const possible=getConns(n,'possible').sort((a,b)=>{
    const ea=getEdgeBetween(n.id,a.id,'possible');
    const eb=getEdgeBetween(n.id,b.id,'possible');
    return (eb?.confidence||0)-(ea?.confidence||0);
  });
  const cluster=clusterForNode(n.id);
  document.getElementById('dp-name').textContent=n.label;
  document.getElementById('dp-cat').textContent=(CMAP[n.cat]?.label||n.cat).toUpperCase();
  document.getElementById('dp-domain').textContent=CMAP[n.cat]?.label||n.cat;
  document.getElementById('dp-degree').textContent=`${confirmed.length} confirmed`;
  document.getElementById('dp-evidence').textContent=n.evidence||'research-grounded';
  document.getElementById('dp-consensus').textContent=n.consensus||'curated';
  document.getElementById('dp-review').textContent=reviewStateLabel(n.reviewState||'under-review');
  document.getElementById('dp-epistemic').textContent='Insufficient evidence';
  document.getElementById('dp-candidates').textContent=`${possible.length} surfaced for review`;
  document.getElementById('dp-cluster-badge').textContent=cluster ? (cluster.tight ? 'Tight cluster' : 'Loose region') : 'Unclustered';
  document.getElementById('dp-desc').textContent=n.desc||'';
  document.getElementById('dp-ref').textContent=n.ref?'Reference: '+n.ref:'No source note attached yet.';
  const sourceSummary=document.getElementById('dp-source-summary');
  const sourceList=document.getElementById('dp-source-list');
  const scoreList=document.getElementById('dp-score-list');
  const edgeCitationBox=document.getElementById('dp-edge-citations');
  const clusterList=document.getElementById('dp-cluster-list');
  const research=n.research||null;
  sourceList.innerHTML='';
  scoreList.innerHTML='';
  clusterList.innerHTML='';
  edgeCitationBox.textContent='No candidate edge selected.';
  if(research && Object.keys(research.sources||{}).length){
    sourceSummary.textContent=`${research.summary||'External sources attached.'}${research.lastSyncedAt?` Last synced ${new Date(research.lastSyncedAt).toLocaleString()}.`:''}`;
    Object.entries(research.sources).forEach(([key,val])=>{
      const item=document.createElement('div'); item.className='dp-mini-item';
      const title=EXTERNAL_SOURCES[key]?.label||key;
      const hits=val?.hitCount||0;
      const labelParts=[`${title}: ${hits} match${hits===1?'':'es'}`];
      if(val?.works?.[0]?.title) labelParts.push(val.works[0].title);
      if(val?.papers?.[0]?.title) labelParts.push(val.papers[0].title);
      if(val?.entities?.[0]?.label) labelParts.push(val.entities[0].label);
      item.innerHTML=`<strong>${labelParts[0]}</strong><div class="dp-subtle">${labelParts.slice(1).join(' · ') || (val?.error || 'Linked for provenance and candidate scoring.')}</div>`;
      sourceList.appendChild(item);
    });
  } else {
    sourceSummary.textContent='No external research sync has been recorded for this concept yet.';
  }
  if(cluster){
    [
      ['Cohesion', cluster.cohesion],
      ['Spread', cluster.spread/100],
      ['Density', cluster.density],
      ['Ontology coherence', cluster.ontologyCoherence]
    ].forEach(([k,v])=>{
      const item=document.createElement('div'); item.className='dp-mini-item';
      item.innerHTML=`<strong>${k}</strong><div class="dp-subtle">${typeof v==='number' ? v.toFixed(2) : v}</div>`;
      clusterList.appendChild(item);
    });
    const badge=document.createElement('div'); badge.className='dp-mini-item';
    badge.innerHTML=`<strong>${cluster.tight?'Tight cluster':'Loose cluster'}</strong><div class="dp-subtle">${cluster.size} nodes · ${cluster.confirmed} confirmed · ${cluster.candidate} candidate</div>`;
    clusterList.appendChild(badge);
  } else {
    clusterList.innerHTML='<div class="dp-empty">No cluster contour is currently assigned to this node.</div>';
  }
  const confirmedList=document.getElementById('dp-conns'); confirmedList.innerHTML='';
  if(!confirmed.length){ confirmedList.innerHTML='<div class="dp-empty">No confirmed links recorded yet.</div>'; }
  else { confirmed.forEach(c=>{ const t=document.createElement('div'); t.className='dp-conn-tag'; t.textContent=c.label; t.onclick=()=>showPanel(c); confirmedList.appendChild(t); }); }
  const possibleList=document.getElementById('dp-possible'); possibleList.innerHTML='';
  if(!possible.length){ possibleList.innerHTML='<div class="dp-empty">No candidate links are above the current review threshold.</div>'; }
  else {
    possible.forEach(c=>{
      const edge=getEdgeBetween(n.id,c.id,'possible');
      const row=document.createElement('div');
      row.className='edge-row'+(selectedEdge===edge?' active':'');
      row.innerHTML=`<div><strong>${c.label}</strong><small>${epistemicStateForEdge(edge)}</small></div><div>${(edge?.confidence||0).toFixed(2)}</div>`;
      row.title=(edge?.basis||[]).join(' · ');
      row.onclick=()=>{ renderEdgeInspector(edge); document.querySelectorAll('#dp-possible .edge-row').forEach(el=>el.classList.remove('active')); row.classList.add('active'); };
      possibleList.appendChild(row);
    });
  }
  document.getElementById('dp-edge-notes').textContent='Select a candidate relation to inspect its basis, provenance, review state, and scoring threshold.';
  if(selectedEdge && (selectedEdge.a===n.id||selectedEdge.b===n.id)) renderEdgeInspector(selectedEdge);
  else if(possible[0]) renderEdgeInspector(getEdgeBetween(n.id,possible[0].id,'possible'));
  else scoreList.innerHTML='<div class="dp-empty">No candidate scoring data is attached to this concept yet.</div>';
  document.getElementById('detail-panel').classList.add('show');
  if(currentView==='field') centerOnNode(n,1.55);
}

gc.style.cursor='grab';
gc.addEventListener('mousemove',e=>{
  const wp=worldPos(e);
  hovered=nodeAt(wp);
  hoveredEdge=hovered?null:edgeAt(wp);
  gc.style.cursor=hovered?'pointer':((hoveredEdge&&hoveredEdge.status==='possible')?'help':(drag?'grabbing':'grab'));
  if(drag){ if(drag.node){drag.node.x=wp.x;drag.node.y=wp.y;drag.node.pinned=true;} else{cam.x+=e.clientX-drag.lx;cam.y+=e.clientY-drag.ly;drag.lx=e.clientX;drag.ly=e.clientY;} }
  const tt=document.getElementById('tooltip');
  const ttName=document.getElementById('tt-name');
  const ttDesc=document.getElementById('tt-desc');
  const ttCat=document.getElementById('tt-cat');
  tt.classList.remove('edge-tip');
  if(hovered){
    tt.classList.add('show');
    ttName.textContent=hovered.label;
    ttDesc.textContent=hovered.desc?.slice(0,110)+(hovered.desc?.length>110?'…':'')||'';
    const possibleCount=getConns(hovered,'possible').length;
    ttCat.textContent=`${CMAP[hovered.cat]?.label||''}${possibleCount?` · ${possibleCount} candidate`:''}`;
  } else if(hoveredEdge && hoveredEdge.status==='possible'){
    const source=nodeById(hoveredEdge.a), target=nodeById(hoveredEdge.b);
    tt.classList.add('show','edge-tip');
    ttName.textContent=`Candidate relation`;
    ttDesc.innerHTML=`${source?.label||'Source'} ↔ ${target?.label||'Target'}<span class="tt-math">${edgeHoverSummary(hoveredEdge)}</span>`;
    ttCat.textContent=`${epistemicStateForEdge(hoveredEdge)} · τ = ${CANDIDATE_THRESHOLD.toFixed(2)}`;
  } else {
    tt.classList.remove('show');
  }
  if(tt.classList.contains('show')){
    let tx=e.clientX+16,ty=e.clientY-8; if(tx+290>W)tx=e.clientX-300;if(ty+160>H)ty=e.clientY-170; tt.style.left=tx+'px';tt.style.top=ty+'px';
  }
});
let lastClick=0;
gc.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  const wp=worldPos(e), n=nodeAt(wp);
  if(n){
    if(connectMode){
      if(!connectFrom){ connectFrom=n; }
      else if(connectFrom!==n){
        const ex=edges.find(ed=>(ed.a===connectFrom.id&&ed.b===n.id)||(ed.b===connectFrom.id&&ed.a===n.id));
        if(!ex){ edges.push(createEdge(connectFrom.id,n.id,{status:'confirmed', relation:'related', provenance:{source:'manual-connect-mode'}, review:{state:'confirmed', reviewedAt:new Date().toISOString(), reviewedBy:'human'}})); recomputeCandidateEdges(); updateCounter(); }
        connectFrom=null;
      }
    } else {
      drag={node:n}; n.pinned=true; const now=Date.now(); if(now-lastClick<340){showPanel(n);} else {selected=n;} lastClick=now;
    }
  } else { drag={lx:e.clientX,ly:e.clientY}; selected=null; document.getElementById('detail-panel').classList.remove('show'); }
});
gc.addEventListener('mouseup',()=>{ if(drag?.node)setTimeout(()=>{if(drag)drag.node.pinned=false;},800); drag=null; });
gc.addEventListener('mouseleave',()=>{ drag=null; });
gc.addEventListener('wheel',e=>{ e.preventDefault(); const prev=cam.z,f=e.deltaY<0?1.1:0.91; cam.z=Math.max(0.12,Math.min(4,cam.z*f)); const r=gc.getBoundingClientRect(); const mx=e.clientX-r.left-W/2,my=e.clientY-r.top-H/2; cam.x=mx-(mx-cam.x)*(cam.z/prev); cam.y=my-(my-cam.y)*(cam.z/prev); },{passive:false});
mm.addEventListener('click',e=>{ const r=mm.getBoundingClientRect(); const mx=e.clientX-r.left,my=e.clientY-r.top; let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity; nodes.forEach(n=>{mnX=Math.min(mnX,n.x);mxX=Math.max(mxX,n.x);mnY=Math.min(mnY,n.y);mxY=Math.max(mxY,n.y);}); const pad=14,MW=r.width,MH=r.height; const sc=Math.min((MW-pad*2)/(mxX-mnX||1),(MH-pad*2)/(mxY-mnY||1)); const ox=MW/2-(mnX+mxX)/2*sc,oy=MH/2-(mnY+mxY)/2*sc; const worldX=(mx-ox)/sc,worldY=(my-oy)/sc; cam.x=-worldX*cam.z;cam.y=-worldY*cam.z; });
let pinchState=null;
gc.addEventListener('touchstart',e=>{
  if(e.touches.length===2){
    e.preventDefault();
    const [a,b]=e.touches;
    const dx=b.clientX-a.clientX, dy=b.clientY-a.clientY;
    pinchState={
      dist:Math.hypot(dx,dy)||1,
      camZ:cam.z,
      camX:cam.x,
      camY:cam.y,
      midX:(a.clientX+b.clientX)/2,
      midY:(a.clientY+b.clientY)/2
    };
    drag=null;
    return;
  }
  if(e.touches.length!==1) return;
  e.preventDefault();
  const t=e.touches[0], wp=worldPos(t), n=nodeAt(wp);
  if(n){drag={node:n};n.pinned=true;selected=n;}
  else {drag={lx:t.clientX,ly:t.clientY};}
},{passive:false});
gc.addEventListener('touchmove',e=>{
  if(e.touches.length===2 && pinchState){
    e.preventDefault();
    const [a,b]=e.touches;
    const dx=b.clientX-a.clientX, dy=b.clientY-a.clientY;
    const dist=Math.hypot(dx,dy)||1;
    const scale=dist/pinchState.dist;
    const newZ=Math.max(0.08,Math.min(4,pinchState.camZ*scale));
    const midX=(a.clientX+b.clientX)/2, midY=(a.clientY+b.clientY)/2;
    const wx=(pinchState.midX-W/2-pinchState.camX)/(pinchState.camZ||1);
    const wy=(pinchState.midY-H/2-pinchState.camY)/(pinchState.camZ||1);
    cam.z=newZ;
    cam.x=midX-W/2-wx*cam.z;
    cam.y=midY-H/2-wy*cam.z;
    return;
  }
  if(e.touches.length!==1) return;
  e.preventDefault();
  const t=e.touches[0], wp=worldPos(t);
  if(drag?.node){drag.node.x=wp.x;drag.node.y=wp.y;}
  else if(drag){cam.x+=t.clientX-drag.lx;cam.y+=t.clientY-drag.ly;drag.lx=t.clientX;drag.ly=t.clientY;}
},{passive:false});
gc.addEventListener('touchend',e=>{
  if(e.touches.length<2) pinchState=null;
  if(e.touches.length===0){ if(drag?.node)setTimeout(()=>{if(drag)drag.node.pinned=false;},800); drag=null; }
});
document.getElementById('pause-btn').onclick=function(){ paused=!paused; this.textContent=paused?'Resume':'Pause'; this.classList.toggle('active',paused); };
document.getElementById('layout-btn').onclick=()=>{ settled=false;simAge=0; nodes.forEach(n=>{n.x=(seededRandom()-.5)*700;n.y=(seededRandom()-.5)*700;n.vx=(seededRandom()-.5)*8;n.vy=(seededRandom()-.5)*8;}); };
document.getElementById('connect-btn').onclick=function(){ connectMode=!connectMode;connectFrom=null; this.classList.toggle('active',connectMode); this.textContent=connectMode?'✕ Exit Connect':'Connect Mode'; };
document.getElementById('research-btn').onclick=async ()=>{
  if(selected) return enrichNodeFromSources(selected);
  const userAdded=nodes.filter(n=>n.sourceType==='user-added').slice(0,12);
  if(userAdded.length) return enrichNodeSet(userAdded,{label:'added thoughts'});
  return enrichNodeSet(nodes.slice(0,8),{label:'seeded sample'});
};
document.getElementById('sync-selected-btn').onclick=async ()=>{ if(!selected){ toast('Select a node to sync'); return; } await enrichNodeFromSources(selected); };
document.getElementById('sync-user-btn').onclick=async ()=>{ const userAdded=nodes.filter(n=>n.sourceType==='user-added'); if(!userAdded.length){ toast('No added thoughts to sync yet'); return; } await enrichNodeSet(userAdded.slice(0,20),{label:'added thoughts'}); };
document.getElementById('dp-close').onclick=()=>{ document.getElementById('detail-panel').classList.remove('show');selected=null; selectedEdge=null; };
document.querySelectorAll('.view-btn').forEach(btn=>{ btn.onclick=()=>applyViewMode(btn.dataset.view); });
document.getElementById('neighbor-mode').onchange=(e)=>{ neighborhoodMode=e.target.value; if(selected) showPanel(selected); };
document.getElementById('dp-focus').onclick=()=>{ if(selected) centerOnNode(selected, 1.7); };
document.getElementById('search').addEventListener('input',e=>{ searchTerm=e.target.value.toLowerCase().trim(); });
const filterBar=document.getElementById('filters');
const allChip=document.createElement('div');
allChip.className='filter-chip active';allChip.textContent='All';
allChip.onclick=()=>{filterCat=null;document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));allChip.classList.add('active');};
filterBar.appendChild(allChip);
CATEGORIES.forEach(c=>{ const chip=document.createElement('div'); chip.className='filter-chip'; chip.textContent=c.label; chip.style.setProperty('--chip-color',c.color); chip.style.setProperty('--chip-glow',c.glow); chip.onclick=()=>{ if(filterCat===c.id){filterCat=null;chip.classList.remove('active');allChip.classList.add('active');} else {filterCat=c.id;document.querySelectorAll('.filter-chip').forEach(x=>x.classList.remove('active'));chip.classList.add('active');} }; filterBar.appendChild(chip); });
const leg=document.getElementById('legend');
leg.innerHTML='';
[{label:'Ontology domains', color:'rgba(245,217,122,0.88)'}].forEach(item=>{ const d=document.createElement('div'); d.className='leg-item'; d.innerHTML=`<div class="leg-dot" style="background:${item.color};box-shadow:0 0 5px ${item.color}"></div><span class="leg-lbl">${item.label}</span>`; leg.appendChild(d); });
CATEGORIES.forEach(c=>{ const d=document.createElement('div');d.className='leg-item'; d.innerHTML=`<div class="leg-dot" style="background:${c.color};box-shadow:0 0 5px ${c.color}88"></div><span class="leg-lbl">${c.label}</span>`; leg.appendChild(d); });
const catSel=document.getElementById('m-cat');
CATEGORIES.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.label;catSel.appendChild(o);});
document.getElementById('add-btn').onclick=()=>document.getElementById('modal-bg').classList.add('open');
document.getElementById('modal-cancel').onclick=()=>document.getElementById('modal-bg').classList.remove('open');
document.getElementById('modal-bg').onclick=e=>{if(e.target===document.getElementById('modal-bg'))document.getElementById('modal-bg').classList.remove('open');};
document.getElementById('modal-confirm').onclick=async ()=>{
  const label=document.getElementById('m-name').value.trim(); if(!label)return;
  const desc=document.getElementById('m-desc').value.trim();
  const ref=document.getElementById('m-ref').value.trim();
  const catId=document.getElementById('m-cat').value;
  const evidence=document.getElementById('m-evidence').value;
  const consensus=document.getElementById('m-consensus').value;
  const connectTo=document.getElementById('m-connect').value.trim().toLowerCase();
  const relation=document.getElementById('m-relation').value;
  const edgeStatus=document.getElementById('m-edge-status').value;
  const confidenceInput=document.getElementById('m-confidence').value.trim();
  const rationale=document.getElementById('m-edge-rationale').value.trim();
  const basis=document.getElementById('m-basis').value.trim();
  const entityHints=document.getElementById('m-entities').value.trim();
  const citations=document.getElementById('m-edge-citations').value.trim();
  const review=document.getElementById('m-review').value.trim();
  const a=seededRandom()*Math.PI*2,d=100+seededRandom()*200;
  const nn={id:++nextId,label,desc,ref,cat:catId,evidence,consensus,sourceType:'user-added',reviewState:review||'pending-review',provenance:'manual-entry',research:{lastSyncedAt:null, summary:'', sources:{}, identifiers:{}, signals:{topics:[],references:parseCitationTokens(citations),authors:[],entities:dedupeCompact(entityHints.split(/\s*;\s*/)),years:extractYears(ref),venues:[],abstractTokens:[],qualityScore:0}, notes:basis?basis.split(/\s*;\s*/):[]},x:Math.cos(a)*d,y:Math.sin(a)*d,vx:0,vy:0,r:14,pinned:false,alpha:1,visible:true};
  nn._signals=computeNodeSignals(nn);
  nodes.push(nn);
  if(connectTo){
    const t=nodes.find(n=>n.label.toLowerCase()===connectTo);
    if(t) edges.push(createEdge(nn.id,t.id,{status:edgeStatus, relation, confidence:confidenceInput==='' ? (edgeStatus==='confirmed'?0.95:0.58) : Math.max(0, Math.min(1, Number(confidenceInput))), basis:basis?basis.split(/\s*;\s*/):['manual relationship entry'], rationale, notes:rationale, citations:citations?citations.split(/\s*;\s*/):[], provenance:{source:'user-add-modal', entityHints:dedupeCompact(entityHints.split(/\s*;\s*/))}, review:{state:review||(edgeStatus==='confirmed'?'confirmed':'pending-review'), reviewedAt:new Date().toISOString(), reviewedBy:'human'}, evidenceClass:evidence, consensus}));
  }
  recomputeCandidateEdges(); updateCounter();
  ['m-name','m-desc','m-ref','m-connect','m-confidence','m-basis','m-entities','m-edge-rationale','m-edge-citations','m-review'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('m-evidence').value='research-grounded';
  document.getElementById('m-consensus').value='curated';
  document.getElementById('m-relation').value='related';
  document.getElementById('m-edge-status').value='confirmed';
  document.getElementById('modal-bg').classList.remove('open');
  selected=nn;
  toast(`"${label}" added to the map`);
  showPanel(nn);
  await enrichNodeFromSources(nn);
};

function triggerDownload(filename, content, type='application/json'){
  const blob=new Blob([content],{type});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 600);
}
function buildConfirmedAdjacencyCsv(){
  const ordered=[...nodes].sort((a,b)=>a.id-b.id);
  const header=['id:label', ...ordered.map(n=>`"${n.id}:${n.label.replace(/"/g,'""')}"`)];
  const rows=[header.join(',')];
  ordered.forEach(a=>{
    const vals=ordered.map(b=> getEdgeBetween(a.id,b.id,'confirmed') ? 1 : 0);
    rows.push([`"${a.id}:${a.label.replace(/"/g,'""')}"`, ...vals].join(','));
  });
  return rows.join('\n');
}
function exportMathematicalObject(){
  const stamp=new Date().toISOString().slice(0,10);
  const nodesPayload=nodes.map(n=>{
    const sig=n._signals||computeNodeSignals(n);
    return {
      id:n.id,label:n.label,category:n.cat,position:{x:Number(n.x.toFixed(2)),y:Number(n.y.toFixed(2))},radius:n.r,
      e_theta:{
        tokenSet:[...sig.tokenSet],refSet:[...sig.refSet],topicSet:[...sig.topicSet],authorSet:[...sig.authorSet],entitySet:[...sig.entitySet],yearAvg:sig.yearAvg,externalScore:sig.externalScore
      },
      evidence:n.evidence||'',consensus:n.consensus||'',reviewState:n.reviewState||'',research:n.research||null
    };
  });
  const forceParams={
    threshold:CANDIDATE_THRESHOLD,
    candidate_weights:{semantic:0.24,citation:0.20,topic:0.16,shared_neighbors:0.14,ontology:0.11,recency:0.05,shared_authors:0.06,entity_match:0.02,source_quality:0.02},
    layout:{repulsion:'3200*cooling+800',spring:0.015,damping:0.80,gravity:0.005,target_distance:'90 + r_a + r_b',confirmed_only_springs:true},
    field:{source_term:'A(x,t)=Σ_i s_i exp(-||x-x_i||^2 / σ_i^2) * (0.55 + 0.45 sin(ωt + φ_i))',selected_gain:'stronger',confirmed_neighbor_response:'structural glow + stronger pull cue',candidate_neighbor_response:'score-weighted brightening'},
    views:VIEW_MODES,
    receiver:{default:RECEIVER_DEFAULT,current:receiverQuality,interpretation:'Operational receiver-state tuning parameter for precision, convergence, and activation gain.'},
    intention:{default:INTENTION_DEFAULT,current:intentionStrength,empathy:empathyField,moralPolarity:moralPolarity,moralValence:computeMoralValence(),interpretation:'Bridge from thought to action and collective attractor formation.'},
    experimentMetrics:layoutDiagnostics
  };
  triggerDownload(`nodes-${stamp}.json`, JSON.stringify(nodesPayload,null,2));
  setTimeout(()=>triggerDownload(`confirmed_adj-${stamp}.csv`, buildConfirmedAdjacencyCsv(), 'text/csv;charset=utf-8'), 180);
  setTimeout(()=>triggerDownload(`force_params-${stamp}.json`, JSON.stringify(forceParams,null,2)), 360);
  toast('Exported mathematical object · nodes, R_c adjacency, and force parameters');
}
document.getElementById('export-btn').onclick=exportMathematicalObject;
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
const mathPanel=document.getElementById('math-panel');
document.getElementById('math-toggle').onclick=()=>mathPanel.classList.toggle('show');
document.getElementById('math-close').onclick=()=>mathPanel.classList.remove('show');
const receiverSlider=document.getElementById('receiver-slider');
const intentionSlider=document.getElementById('intention-slider');
const polaritySlider=document.getElementById('polarity-slider');
const empathySlider=document.getElementById('empathy-slider');
function resetFieldDynamics(){ settled=false; simAge=0; updateEnergyReadout(); }
if(receiverSlider){ receiverSlider.addEventListener('input', e=>{ receiverQuality=parseFloat(e.target.value||RECEIVER_DEFAULT); resetFieldDynamics(); }); }
if(intentionSlider){ intentionSlider.addEventListener('input', e=>{ intentionStrength=parseFloat(e.target.value||INTENTION_DEFAULT); resetFieldDynamics(); }); }
if(polaritySlider){ polaritySlider.addEventListener('input', e=>{ moralPolarity=parseFloat(e.target.value||MORAL_DEFAULT); resetFieldDynamics(); }); }
if(empathySlider){ empathySlider.addEventListener('input', e=>{ empathyField=parseFloat(e.target.value||EMPATHY_DEFAULT); resetFieldDynamics(); }); }
document.querySelectorAll('[data-rq]').forEach(btn=>btn.onclick=()=>{ receiverQuality=parseFloat(btn.dataset.rq||RECEIVER_DEFAULT); if(receiverSlider) receiverSlider.value=receiverQuality.toFixed(2); resetFieldDynamics(); });

document.addEventListener('keydown',e=>{
  if(e.key==='/'){ e.preventDefault(); document.getElementById('search').focus(); }
  if(e.key==='Escape'){ connectMode=false; connectFrom=null; document.getElementById('connect-btn').classList.remove('active'); document.getElementById('connect-btn').textContent='Connect Mode'; document.getElementById('detail-panel').classList.remove('show'); document.getElementById('modal-bg').classList.remove('open'); selected=null; }
  if(e.key.toLowerCase()==='f') fitAll();
  if(e.key.toLowerCase()==='h') cam={x:0,y:0,z:0.85};
  if(e.key.toLowerCase()==='v'){ const idx=(VIEW_MODES.indexOf(currentView)+1)%VIEW_MODES.length; applyViewMode(VIEW_MODES[idx]); }
  if(e.key.toLowerCase()==='m'){ mathPanel.classList.toggle('show'); }
});
document.getElementById('search').addEventListener('focus',()=>document.getElementById('search').select());
// ── LOOP ──
function loop(){
  tick();draw();drawMinimap();
  requestAnimationFrame(loop);
}

const seededRandom = createSeededRandom(42);

function getAtlasSnapshot(){
  return {
    version: ATLAS_METADATA.datasetTag ? String(ATLAS_METADATA.datasetTag).replace(/^data-/, '') : 'v1.0',
    metadata: ATLAS_METADATA,
    categories: CATEGORIES.map(category => ({ ...category })),
    nodes: nodes.map(node => {
      const { _signals, vx, vy, pinned, alpha, visible, ...rest } = node;
      return JSON.parse(JSON.stringify(rest));
    }),
    confirmedEdges: edges.filter(edge => edge.status === 'confirmed').map(edge => ({ a: edge.a, b: edge.b, status: 'confirmed', confidence: edge.confidence ?? 0.95 })),
    candidateEdges: edges.filter(edge => edge.status === 'possible').map(edge => ({ a: edge.a, b: edge.b, status: 'possible', confidence: edge.confidence ?? 0.5, basis: edge.basis || [], scoreComponents: edge.scoreComponents || null })),
  };
}

async function bootstrap(){
  const atlas = await loadAtlas('v1.0');
  CATEGORIES = atlas.categories;
  CMAP = rebuildCategoryMap(CATEGORIES);
  SEED_NODES = atlas.nodes;
  SEED_EDGES = atlas.edgePairs;
  ATLAS_METADATA = atlas.metadata || {};
  GROUNDTRUTH_DATA = await loadCandidateGroundtruth();
  resize();
  renderSourceStatus();
  initGraph();
  updateCounter();
  renderSourceStatus();
  updateExperimentPanel();
  setTimeout(()=>applyViewMode('research'),700);
  loop();
  window.StarsResearch = {
    getAtlasSnapshot,
    getGroundTruth: () => GROUNDTRUTH_DATA,
    runEvaluationSuite: () => runEvaluationSuite(getAtlasSnapshot(), GROUNDTRUTH_DATA),
  };
}

bootstrap().catch(error => {
  console.error(error);
  const toastNode = document.getElementById('toast');
  if (toastNode) {
    toastNode.textContent = `Failed to load external atlas dataset: ${error.message}`;
    toastNode.classList.add('show');
  }
});

(function(){
  const leftIds = ['brand-card','metrics-corner','receiver-card','experiment-card'];
  const rightIds = ['research-corner','view-switcher','energy-card','neighborhood-card','layer-legend'];
  const leftDock = document.createElement('div');
  leftDock.id = 'left-dock';
  const rightDock = document.createElement('div');
  rightDock.id = 'right-dock';
  document.body.appendChild(leftDock);
  document.body.appendChild(rightDock);
  leftIds.forEach(id => { const el = document.getElementById(id); if (el) leftDock.appendChild(el); });
  rightIds.forEach(id => { const el = document.getElementById(id); if (el) rightDock.appendChild(el); });

  const appControls = document.createElement('div');
  appControls.id = 'app-controls-card';
  appControls.className = 'ui-corner';
  const title = document.createElement('div');
  title.className = 'corner-title';
  title.textContent = 'Search & Controls';
  const note = document.createElement('div');
  note.className = 'controls-note';
  note.textContent = 'Pinch to zoom the map. Search, filters, and controls stay in the HUD.';
  appControls.appendChild(title);
  const searchWrap = document.getElementById('search-wrap');
  const filters = document.getElementById('filters');
  const controls = document.getElementById('controls');
  if (searchWrap) { searchWrap.style.display='block'; appControls.appendChild(searchWrap); }
  if (filters) { filters.style.display='flex'; appControls.appendChild(filters); }
  if (controls) { controls.style.display='grid'; appControls.appendChild(controls); }
  appControls.appendChild(note);
  rightDock.appendChild(appControls);

  const scenarioCard=document.createElement('div');
  scenarioCard.id='scenario-card';
  scenarioCard.className='ui-corner';
  scenarioCard.innerHTML=`<div class="corner-title">Scenario Presets</div><div class="scenario-grid"><button class="ctrl-btn scenario-btn" data-scenario="balanced">Balanced Test</button><button class="ctrl-btn scenario-btn" data-scenario="world">World Mode</button><button class="ctrl-btn scenario-btn" data-scenario="crisis">Crisis Shock</button><button class="ctrl-btn scenario-btn" data-scenario="repair">Repair Cycle</button></div><div class="scenario-note" id="scenario-note">Use these presets to compare fairness testing, world asymmetry, crisis disturbance, and repair.</div>`;
  rightDock.appendChild(scenarioCard);

  const framingCard=document.createElement('div');
  framingCard.id='final-framing-card';
  framingCard.className='ui-corner';
  framingCard.innerHTML=`<div class="corner-title">Experimental Demo</div><div class="framing-note"><strong>Confirmed</strong> edges anchor the stable ontology. <strong>Strong candidates</strong> now weakly influence geometry. Use <strong>Balanced Test</strong> for fairness checking and <strong>World Mode</strong> for social realism under uneven institutions, memory, and pressure.</div>`;

rightDock.appendChild(framingCard);

installEvaluationPanel({
  container: rightDock,
  onRun: async () => {
    const report = runEvaluationSuite(getAtlasSnapshot(), GROUNDTRUTH_DATA || { positive: [], negative: [] });
    report.summary = summarizeEvaluationReport(report);
    window.__starsLastEvaluation = report;
    return report;
  },
  onExport: async (report) => {
    const payload = report || window.__starsLastEvaluation || runEvaluationSuite(getAtlasSnapshot(), GROUNDTRUTH_DATA || { positive: [], negative: [] });
    downloadJSON(`stars-evaluation-${new Date().toISOString().slice(0,10)}.json`, payload);
  }
});

scenarioCard.querySelectorAll('[data-scenario]').forEach(btn=>btn.addEventListener('click',()=>applyScenarioPreset(btn.dataset.scenario)));

  const refreshViewport = ()=>{
    if(typeof fitAll==='function'){
      setTimeout(()=>fitAll(), 60);
      setTimeout(()=>fitAll(), 420);
    }
  };
  window.addEventListener('resize', refreshViewport);
  refreshViewport();
  syncExperimentSliders();
})();
