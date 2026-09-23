// 持久化层行为验证（用内存版 localStorage）：node test/storage.test.mjs
import assert from 'node:assert';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { normalize, normalizeCrit, load, save, seed } = await import('../src/storage.js');

// 1) v1 数组边迁移为对象边，自动生成稳定 id 与带宽 null
const v1 = {
  nodes: [{ id: 'a', name: 'A', type: 'router', x: 1, y: 2, ip: '0.0.0.0' }],
  edges: [['a', 'b']],
};
const t1 = normalize(v1);
assert.equal(t1.edges.length, 0, '悬空边应被丢弃'); // b 不存在
mem.set('topology', JSON.stringify({
  nodes: [
    { id: 'a', name: 'A', type: 'router', x: 0, y: 0 },
    { id: 'b', name: 'B', type: 'switch', x: 0, y: 0 },
  ],
  edges: [['b', 'a'], ['a', 'b'], ['a', 'a']],
}));
const t2 = (load()).topo;
assert.equal(t2.edges.length, 1, '重复边去重、自环丢弃');
assert.deepEqual(t2.edges[0], { id: 'a::b', a: 'b', b: 'a', bw: null, fault: false });
assert.equal(t2.nodes[0].off, false);

// 2) 筛选条件端点消失时回落到现存节点
const crit = normalizeCrit({ source: 'gone', target: 'b', minBw: 200 }, t2);
assert.equal(crit.source, 'a');
assert.equal(crit.target, 'b');
assert.equal(crit.minBw, 200);
assert.equal(normalizeCrit({ minBw: 'abc' }, t2).minBw, '');

// 3) 保存/刷新往返：节点、链路、条件、最近结果对应
save({
  topo: normalize(seed),
  crit: { source: 'web', target: 'user', minBw: 100 },
  lastPath: { nodes: ['web', 'sw1', 'gw', 'sw2', 'user'], crit: { source: 'web', target: 'user', minBw: 100 }, at: 123 },
});
const again = load();
assert.equal(again.topo.nodes.length, seed.nodes.length);
assert.equal(again.topo.edges.length, seed.edges.length);
assert.deepEqual(again.crit, { source: 'web', target: 'user', minBw: 100 });
assert.deepEqual(again.lastPath.nodes, ['web', 'sw1', 'gw', 'sw2', 'user']);

// 4) 最近结果中已删除节点被过滤，不产生悬空引用
save({
  topo: { ...normalize(seed), nodes: normalize(seed).nodes.filter((n) => n.id !== 'sw1') },
  crit: { source: 'web', target: 'user', minBw: 100 },
  lastPath: { nodes: ['web', 'sw1', 'gw'], crit: null, at: 1 },
});
const pruned = load();
assert.ok(!pruned.lastPath.nodes.includes('sw1'));
assert.deepEqual(pruned.lastPath.nodes, ['web', 'gw']);
// 删除节点后其边也应被清掉（normalize 会清悬空）
assert.ok(pruned.topo.edges.every((e) => e.a !== 'sw1' && e.b !== 'sw1'));

console.log('storage.js: all assertions passed');
