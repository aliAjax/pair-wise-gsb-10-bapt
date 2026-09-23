// 纯图计算模块：数据归一化、链路资格判定、最少跳数路径搜索。
// 不依赖 React / DOM / localStorage，输入数据不会被修改。

// 将历史版本（edges 为 [source, target] 数组）迁移为带带宽与故障状态的对象。
export function migrateGraph(raw) {
  const nodes = (raw?.nodes || []).map((n) => ({ ...n, disabled: !!n.disabled }));
  const edges = (raw?.edges || []).map((e, i) => {
    if (Array.isArray(e)) {
      const [source, target] = e;
      return { id: `e-${source}-${target}`, source, target, bandwidth: 1000, faulty: false };
    }
    const bandwidth = Number(e.bandwidth);
    return {
      id: e.id || `edge-${i}`,
      source: e.source ?? e.from,
      target: e.target ?? e.to,
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : 1000,
      faulty: !!e.faulty,
    };
  });
  return { nodes, edges };
}

export function edgeName(edge, nodeMap) {
  const a = nodeMap.get(edge.source);
  const b = nodeMap.get(edge.target);
  return `${a ? (a.name || a.id) : edge.source} ↔ ${b ? (b.name || b.id) : edge.target}`;
}

// 返回某条链路不参与计算的全部原因；空数组表示合格。
export function edgeReasons(edge, nodeMap, minBandwidth) {
  const reasons = [];
  const a = nodeMap.get(edge.source);
  const b = nodeMap.get(edge.target);
  if (!a || !b) reasons.push('端点缺失（悬空连接）');
  if (a?.disabled) reasons.push(`端点停用：${a.name || a.id}`);
  if (b?.disabled) reasons.push(`端点停用：${b.name || b.id}`);
  if (edge.faulty) reasons.push('链路故障');
  const bandwidth = Number(edge.bandwidth) || 0;
  if (minBandwidth > 0 && bandwidth < minBandwidth) {
    reasons.push(`带宽不足 ${bandwidth} ＜ ${minBandwidth} Mbps`);
  }
  return reasons;
}

// BFS 按边顺序遍历，天然得到最少跳数且结果稳定可复现。
export function findTrace(graph, filters = {}) {
  const { nodes, edges } = graph;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const minBandwidth = Number(filters.minBandwidth) || 0;

  const exclusions = [];
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    const reasons = edgeReasons(edge, nodeMap, minBandwidth);
    if (reasons.length) {
      exclusions.push({ edge, reasons });
      continue;
    }
    adj.get(edge.source)?.push({ to: edge.target, edge });
    adj.get(edge.target)?.push({ to: edge.source, edge });
  }

  const base = {
    status: 'incomplete',
    path: null,
    message: '',
    exclusions,
    disabledNodes: nodes.filter((n) => n.disabled),
    minBandwidth,
  };

  const { source, target } = filters;
  if (!source || !target) return { ...base, message: '请选择起点与终点' };

  const sourceNode = nodeMap.get(source);
  const targetNode = nodeMap.get(target);
  if (!sourceNode) return { ...base, status: 'blocked', message: '起点设备已被删除' };
  if (!targetNode) return { ...base, status: 'blocked', message: '终点设备已被删除' };
  if (sourceNode.disabled) return { ...base, status: 'blocked', message: `起点「${sourceNode.name || source}」已停用` };
  if (targetNode.disabled) return { ...base, status: 'blocked', message: `终点「${targetNode.name || target}」已停用` };

  if (source === target) {
    return {
      ...base,
      status: 'ok',
      path: { nodeIds: [source], edgeIds: [], hops: 0, bottleneck: null },
    };
  }

  const prev = new Map([[source, { from: null, edge: null }]]);
  const queue = [source];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === target) break;
    for (const next of adj.get(cur) || []) {
      if (!prev.has(next.to)) {
        prev.set(next.to, { from: cur, edge: next.edge });
        queue.push(next.to);
      }
    }
  }

  if (!prev.has(target)) {
    return {
      ...base,
      status: 'unreachable',
      message: '起点与终点之间不存在满足条件的可用路径',
    };
  }

  const nodeIds = [];
  const edgeIds = [];
  let cur = target;
  while (cur) {
    nodeIds.unshift(cur);
    const step = prev.get(cur);
    if (step.edge) edgeIds.unshift(step.edge.id);
    cur = step.from;
  }
  const usedEdges = edgeIds.map((id) => edges.find((e) => e.id === id)).filter(Boolean);
  const bottleneck = usedEdges.length
    ? Math.min(...usedEdges.map((e) => Number(e.bandwidth) || 0))
    : null;

  return {
    ...base,
    status: 'ok',
    path: { nodeIds, edgeIds, hops: edgeIds.length, bottleneck },
  };
}
