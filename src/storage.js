// 持久化层：只负责初始数据、版本迁移与 localStorage 读写，不接触 React/DOM

const KEY = 'topology-v2';
const OLD_KEY = 'topology';

export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 200, ip: '10.0.0.1', off: false },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 350, ip: '10.0.1.1', off: false },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 350, ip: '10.0.2.1', off: false },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 500, ip: '10.0.1.10', off: false },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 530, ip: '10.0.1.20', off: false },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 510, ip: '10.0.2.22', off: false },
  ],
  edges: [
    { id: 'gw::sw1', a: 'gw', b: 'sw1', bw: 1000, fault: false },
    { id: 'gw::sw2', a: 'gw', b: 'sw2', bw: 1000, fault: false },
    { id: 'sw1::web', a: 'sw1', b: 'web', bw: 100, fault: false },
    { id: 'db::sw1', a: 'db', b: 'sw1', bw: 50, fault: false },
    { id: 'sw2::user', a: 'sw2', b: 'user', bw: 100, fault: false },
  ],
};

export const defaultCrit = { source: 'web', target: 'user', minBw: 100 };

// 兼容 v1（边为 [a,b] 数组）并清理：未知端点、自环、重复边 —— 不留下悬空连接
export function normalize(raw) {
  const nodes = (raw?.nodes || []).map((n) => ({
    id: String(n.id),
    name: String(n.name ?? '未命名设备'),
    type: ['router', 'switch', 'server', 'device'].includes(n.type) ? n.type : 'device',
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    ip: String(n.ip ?? ''),
    off: !!n.off,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const edges = [];
  const list = Array.isArray(raw?.edges) ? raw.edges : [];
  for (const item of list) {
    // v1: ['a','b']；v2: {a,b,bw,fault}
    const isArr = Array.isArray(item);
    const a = isArr ? item[0] : item?.a;
    const b = isArr ? item[1] : item?.b;
    if (!a || !b || a === b || !ids.has(a) || !ids.has(b)) continue; // 丢弃悬空/自环
    const id = [a, b].sort().join('::');
    if (seen.has(id)) continue; // 无向图：同一对节点只保留一条链路
    seen.add(id);
    const bwRaw = isArr ? null : item.bw;
    const bwNum = bwRaw === null || bwRaw === undefined || bwRaw === '' ? null : Number(bwRaw);
    edges.push({ id, a, b, bw: bwRaw == null || Number.isNaN(bwNum) ? null : bwNum, fault: !isArr && !!item.fault });
  }
  return { nodes, edges };
}

// 筛选条件与最近一次有效结果：端点消失则回落，节点不删除筛选记录
export function normalizeCrit(saved, topo) {
  const pick = (id, fb) => (topo.nodes.some((n) => n.id === id) ? id : fb);
  const first = topo.nodes[0]?.id ?? '';
  const last = topo.nodes[topo.nodes.length - 1]?.id ?? first;
  const source = pick(saved?.source, first);
  const target = pick(saved?.target, source === last && topo.nodes.length > 1 ? first : last);
  const mb = saved?.minBw;
  const minBw = mb === '' || mb === null || Number.isNaN(Number(mb)) ? '' : Number(mb);
  return { source, target, minBw };
}

export function load() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY));
  } catch {
    raw = null;
  }
  if (!raw) {
    // 首次：迁移 v1 数据，否则用 seed
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old) {
        const topo = normalize(old);
        return { topo, crit: normalizeCrit(null, topo), lastPath: null };
      }
    } catch {
      /* 忽略损坏的旧数据 */
    }
    return { topo: normalize(seed), crit: { ...defaultCrit }, lastPath: null };
  }
  const topo = normalize(raw.topo);
  const crit = normalizeCrit(raw.crit, topo);
  // 最近结果只引用 id；渲染时按当前图校验，天然不会改动原图
  const lastPath = raw.lastPath && Array.isArray(raw.lastPath.nodes)
    ? { nodes: raw.lastPath.nodes.filter((id) => topo.nodes.some((n) => n.id === id)), crit: raw.lastPath.crit || null, at: raw.lastPath.at || null }
    : null;
  return { topo, crit, lastPath };
}

export function save({ topo, crit, lastPath }) {
  localStorage.setItem(KEY, JSON.stringify({ topo, crit, lastPath }));
}
