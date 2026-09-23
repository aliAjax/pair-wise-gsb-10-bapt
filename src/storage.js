// 持久化模块：只负责 localStorage 的读写与默认数据，界面与图计算不直接接触存储。
import { migrateGraph } from './graph.js';

const KEY = 'topology-v2';
const LEGACY_KEY = 'topology';

export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 200, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 350, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 350, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 500, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 520, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 510, ip: '10.0.2.22' },
  ],
  // 示例中预设一条带宽吃紧的链路与一条跨交换链路，方便直接演示排除原因。
  edges: [
    { id: 'e-gw-sw1', source: 'gw', target: 'sw1', bandwidth: 1000, faulty: false },
    { id: 'e-gw-sw2', source: 'gw', target: 'sw2', bandwidth: 1000, faulty: false },
    { id: 'e-sw1-web', source: 'sw1', target: 'web', bandwidth: 500, faulty: false },
    { id: 'e-sw1-db', source: 'sw1', target: 'db', bandwidth: 100, faulty: false },
    { id: 'e-sw2-user', source: 'sw2', target: 'user', bandwidth: 1000, faulty: false },
    { id: 'e-sw1-sw2', source: 'sw1', target: 'sw2', bandwidth: 100, faulty: true },
  ],
};

export const defaultFilters = { source: 'gw', target: 'web', minBandwidth: 0 };

function normalize(raw) {
  const graph = migrateGraph(raw || seed);
  const filters = {
    source: raw?.filters?.source ?? defaultFilters.source,
    target: raw?.filters?.target ?? defaultFilters.target,
    minBandwidth: Number(raw?.filters?.minBandwidth ?? defaultFilters.minBandwidth) || 0,
  };
  const savedPath = raw?.lastPath && Array.isArray(raw.lastPath.nodeIds) ? raw.lastPath : null;
  const signature = raw?.pathSignature || null;
  return { graph, filters, lastPath: savedPath, pathSignature: signature };
}

export function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || 'null');
    return normalize(raw);
  } catch {
    return normalize(seed);
  }
}

// lastPath 仅在找到可用路径时写入；断开时界面继续展示它，存储内容本身也保持为上次有效结果。
export function saveState({ graph, filters, lastPath, pathSignature }) {
  const payload = { version: 2, ...graph, filters, lastPath, pathSignature };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    // 清理旧版键，避免两份数据不一致。
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 存储不可用时静默降级为会话内状态 */
  }
}
