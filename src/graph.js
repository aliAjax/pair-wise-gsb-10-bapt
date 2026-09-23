// 图计算层：纯函数，不接触 React / DOM / localStorage，不修改入参
// 边对象：{ id, a, b, bw(带宽 Mbps，null 表示未填写), fault(是否故障) }
// 节点对象：{ id, name, type, x, y, ip, off(是否停用) }

export const edgeId = (a, b) => [a, b].sort().join('::');
export const makeEdge = (a, b, bw = null) => ({ id: edgeId(a, b), a, b, bw, fault: false });
export const otherEnd = (e, id) => (e.a === id ? e.b : e.a);

const hasNode = (topo, id) => topo.nodes.some((n) => n.id === id);
const isOff = (topo, id) => {
  const n = topo.nodes.find((x) => x.id === id);
  return !!n && !!n.off;
};

// 一条边不参与寻路的原因；合格返回 null
export function edgeReason(topo, e, minBw) {
  if (!hasNode(topo, e.a) || !hasNode(topo, e.b)) return '端点缺失';
  if (e.fault) return '链路故障';
  if (isOff(topo, e.a) || isOff(topo, e.b)) return '端点停用';
  if (minBw > 0 && (e.bw == null || Number.isNaN(Number(e.bw)))) return '未配置带宽';
  if (e.bw != null && Number(e.bw) < minBw) return `带宽不足（${e.bw} < ${minBw} Mbps）`;
  return null;
}

// 构建合格边邻接表（BFS 每跳权重相同，首个到达即最少跳数）
function buildAdj(topo, eligible) {
  const adj = new Map();
  for (const n of topo.nodes) adj.set(n.id, []);
  for (const e of eligible) {
    adj.get(e.a)?.push(e);
    adj.get(e.b)?.push(e);
  }
  return adj;
}

/**
 * 最少跳数寻路
 * 输入：topo {nodes, edges}，crit {source, target, minBw}
 * 返回：
 *  { status:'ok', path:[nodeId...], edges:[edge...], hops, bottleneck, reachable, excluded[] }
 *  { status:'no-source'|'no-target'|'endpoint-off'|'same'|'unreachable', ..., cut[] }
 * excluded: 全部不合格边 {edge, reason}（界面“被排除的链路”面板用）
 * cut: 不可达时，从起点可达区域跨向不可达区域的边（解释为何走不通）
 */
export function findPath(topo, crit) {
  const minBw = Number(crit.minBw) || 0;
  const excluded = [];
  const eligible = [];
  for (const e of topo.edges) {
    const reason = edgeReason(topo, e, minBw);
    if (reason) excluded.push({ edge: e, reason });
    else eligible.push(e);
  }

  const base = { minBw, excluded, eligible };
  const src = topo.nodes.find((n) => n.id === crit.source);
  const dst = topo.nodes.find((n) => n.id === crit.target);
  if (!src) return { ...base, status: 'no-source' };
  if (!dst) return { ...base, status: 'no-target' };
  if (src.off || dst.off) return { ...base, status: 'endpoint-off' };
  if (src.id === dst.id) {
    return { ...base, status: 'same', path: [src.id], edges: [], hops: 0, reachable: new Set([src.id]) };
  }

  const adj = buildAdj(topo, eligible);
  const prev = new Map([[src.id, { node: null, edge: null }]]);
  const queue = [src.id];
  let found = false;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === dst.id) {
      found = true;
      break;
    }
    for (const e of adj.get(cur) || []) {
      const to = otherEnd(e, cur);
      if (!prev.has(to)) {
        prev.set(to, { node: cur, edge: e });
        queue.push(to);
      }
    }
  }
  const reachable = new Set(prev.keys());

  if (!found) {
    // 割边：一端在可达集合内、另一端在集合外的不合格边（解释为何走不通）
    const cut = excluded
      .filter(({ edge: e }) => reachable.has(e.a) !== reachable.has(e.b))
      .map((x) => {
        const inside = reachable.has(x.edge.a) ? x.edge.a : x.edge.b;
        return { ...x, from: inside };
      });
    return { ...base, status: 'unreachable', reachable, cut };
  }

  const pathNodes = [];
  const pathEdges = [];
  let cur = dst.id;
  while (cur !== src.id) {
    pathNodes.push(cur);
    const step = prev.get(cur);
    pathEdges.push(step.edge);
    cur = step.node;
  }
  pathNodes.push(src.id);
  pathNodes.reverse();
  pathEdges.reverse();
  const known = pathEdges.map((e) => e.bw).filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);
  const bottleneck = known.length ? Math.min(...known) : null;
  return { ...base, status: 'ok', path: pathNodes, edges: pathEdges, hops: pathEdges.length, bottleneck, reachable };
}

export function pathEdgeIds(result) {
  return new Set((result?.edges || []).map((e) => e.id));
}
