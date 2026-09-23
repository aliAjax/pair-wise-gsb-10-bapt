// 一次性行为验证（不进入依赖、不打进构建）：node test/graph.test.mjs
import assert from 'node:assert';
import { findPath, makeEdge } from '../src/graph.js';

const N = (id, off = false) => ({ id, name: id, type: 'device', x: 0, y: 0, ip: '', off });
const E = (a, b, bw, fault = false) => ({ ...makeEdge(a, b, bw), fault });

// 拓扑：a-b-c 主链 + a-d-c 备用 + c-e
const topo = {
  nodes: [N('a'), N('b'), N('c'), N('d'), N('e')],
  edges: [E('a', 'b', 100), E('b', 'c', 100), E('a', 'd', 100), E('d', 'c', 100), E('c', 'e', 10)],
};

// 1) 最少跳数：a->e 为 a-b-c-e（3 跳），不走 a-d-c
let r = findPath(topo, { source: 'a', target: 'e', minBw: 0 });
assert.equal(r.status, 'ok');
assert.deepEqual(r.path, ['a', 'b', 'c', 'e']);
assert.equal(r.hops, 3);
assert.equal(r.bottleneck, 10);

// 2) 带宽过滤：要求 >=50，c-e(10) 不合格 -> 不可达；割边指出 c↔e
r = findPath(topo, { source: 'a', target: 'e', minBw: 50 });
assert.equal(r.status, 'unreachable');
assert.ok(r.reachable.has('a') && r.reachable.has('b') && r.reachable.has('c') && r.reachable.has('d'));
assert.ok(!r.reachable.has('e'));
const cutIds = r.cut.map((x) => x.edge.id);
assert.ok(cutIds.includes('c::e'));
assert.match(r.cut.find((x) => x.edge.id === 'c::e').reason, /带宽不足/);

// 3) 故障边不参与：b-c 故障后走 a-d-c-e
const faultTopo = { ...topo, edges: topo.edges.map((e) => (e.id === 'b::c' ? { ...e, fault: true } : e)) };
r = findPath(faultTopo, { source: 'a', target: 'e', minBw: 0 });
assert.deepEqual(r.path, ['a', 'd', 'c', 'e']);
assert.ok(r.excluded.some((x) => x.edge.id === 'b::c' && x.reason === '链路故障'));

// 4) 停用中间节点 c：到 e 不可达，连 c 的边原因“端点停用”
const offTopo = { ...topo, nodes: topo.nodes.map((n) => (n.id === 'c' ? { ...n, off: true } : n)) };
r = findPath(offTopo, { source: 'a', target: 'e', minBw: 0 });
assert.equal(r.status, 'unreachable');
assert.ok(r.excluded.filter((x) => ['b::c', 'c::e', 'c::d'].includes(x.edge.id))
  .every((x) => x.reason === '端点停用'));

// 5) 停用起点/终点：endpoint-off
r = findPath(offTopo, { source: 'c', target: 'e', minBw: 0 });
assert.equal(r.status, 'endpoint-off');

// 6) 未配置带宽：留空最低带宽时可参与；填写阈值时被排除并给出原因
const noBwTopo = { nodes: [N('a'), N('b')], edges: [makeEdge('a', 'b')] };
r = findPath(noBwTopo, { source: 'a', target: 'b', minBw: '' });
assert.equal(r.status, 'ok');
assert.equal(r.bottleneck, null);
r = findPath(noBwTopo, { source: 'a', target: 'b', minBw: 100 });
assert.equal(r.status, 'unreachable');
assert.equal(r.excluded[0].reason, '未配置带宽');

// 7) 同点 / 缺失端点
assert.equal(findPath(topo, { source: 'a', target: 'a', minBw: 0 }).status, 'same');
assert.equal(findPath(topo, { source: 'a', target: 'zzz', minBw: 0 }).status, 'no-target');

console.log('graph.js: all assertions passed');
