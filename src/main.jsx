import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { findPath, pathEdgeIds, edgeId, makeEdge, otherEnd, edgeReason } from './graph.js';
import { load, save, normalizeCrit } from './storage.js';

const ICONS = { router: '◉', switch: '▦', server: '▣', device: '▱' };
const TYPE_LABEL = { router: '路由器', switch: '交换机', server: '服务器', device: '终端设备' };
const iconOf = (t) => ICONS[t] || ICONS.device;

export function App() {
  const boot = useRef(load());
  const [topo, setTopo] = useState(boot.current.topo);
  const [crit, setCrit] = useState(boot.current.crit);
  const [lastPath, setLastPath] = useState(boot.current.lastPath);
  const [sel, setSel] = useState({ kind: 'node', id: boot.current.topo.nodes[0]?.id });
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(null);
  const board = useRef();

  // 图计算层：拖动、属性变化、删除设备后 topo/crit 变化即自动重算
  const result = useMemo(() => findPath(topo, crit), [topo, crit]);

  // 持久化层：图、筛选条件、最近结果一并保存，刷新后仍对应
  useEffect(() => {
    save({ topo, crit, lastPath });
  }, [topo, crit, lastPath]);

  // 已不连通：只更新提示并保留上次有效路径；连通时才刷新“最近结果”
  const activeIds = pathEdgeIds(result);
  useEffect(() => {
    if (result.status !== 'ok') return;
    const sig = result.path.join('>') + `@${crit.source}>${crit.target}@${crit.minBw}`;
    const oldSig = lastPath ? lastPath.nodes.join('>') + `@${lastPath.crit?.source}>${lastPath.crit?.target}@${lastPath.crit?.minBw}` : '';
    if (sig !== oldSig) setLastPath({ nodes: result.path, crit: { ...crit }, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.status, result.path, crit.source, crit.target, crit.minBw]);

  const node = topo.nodes.find((n) => n.id === sel.id);
  const edge = topo.edges.find((e) => e.id === sel.id);

  // ---- 图变更原语：所有修改都经过不可变更新，绝不改动原图对象以外的结构、不留悬空边 ----
  const patchNodes = (fn) => setTopo((t) => ({ ...t, nodes: fn(t.nodes) }));
  const patchEdges = (fn) => setTopo((t) => ({ ...t, edges: fn(t.edges) }));
  const updateNode = (id, patch) => patchNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const updateEdge = (id, patch) => patchEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addNodeOfType = (type) => {
    const id = 'node' + Date.now();
    patchNodes((ns) => [...ns, { id, name: TYPE_LABEL[type], type, x: 480, y: 280, ip: '192.168.0.2', off: false }]);
    setSel({ kind: 'node', id });
    setTool('select');
    setNotice('已添加设备');
  };

  const connect = () => {
    if (sel.kind !== 'node' || !node) return;
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (other === node.id) return setNotice('不能连接设备自身');
    if (!topo.nodes.some((n) => n.id === other)) return setNotice('设备 ID 不存在');
    if (topo.edges.some((e) => edgeId(e.a, e.b) === edgeId(node.id, other))) return setNotice('连接已存在');
    patchEdges((es) => [...es, makeEdge(node.id, other)]);
    setNotice('连接已创建，可在属性面板设置带宽');
  };

  const removeNode = (id) => {
    setTopo((t) => ({ nodes: t.nodes.filter((n) => n.id !== id), edges: t.edges.filter((e) => e.a !== id && e.b !== id) }));
    const rest = topo.nodes.filter((n) => n.id !== id);
    setSel({ kind: 'node', id: rest[0]?.id });
    setCrit((c) => normalizeCrit(c, { nodes: rest, edges: [] }));
    setNotice('设备已删除，相关连接一并移除');
  };

  const removeEdge = (id) => {
    patchEdges((es) => es.filter((e) => e.id !== id));
    if (sel.kind === 'edge' && sel.id === id) setSel({ kind: 'node', id: topo.nodes[0]?.id });
    setNotice('链路已删除');
  };

  const validate = () => {
    const linked = new Set(topo.edges.flatMap((e) => [e.a, e.b]));
    const isolated = topo.nodes.filter((n) => !linked.has(n.id));
    setNotice(isolated.length ? `发现 ${isolated.length} 个孤立节点` : '拓扑检查通过：没有孤立节点');
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(topo, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    setNotice('JSON 已导出');
  };

  // 拖动节点：移动过程中即触发重算
  const move = (e) => {
    if (!drag) return;
    const r = board.current.getBoundingClientRect();
    updateNode(drag, { x: Math.max(35, e.clientX - r.left), y: Math.max(35, e.clientY - r.top) });
  };

  const byId = (id) => topo.nodes.find((n) => n.id === id);
  const staleEdges = useMemo(() => {
    if (result.status === 'ok' || !lastPath) return new Set();
    const s = new Set();
    for (let i = 0; i < lastPath.nodes.length - 1; i++) s.add(edgeId(lastPath.nodes[i], lastPath.nodes[i + 1]));
    return s;
  }, [result.status, lastPath]);
  const staleOk = staleEdges.size > 0 && [...staleEdges].every((id) => topo.edges.some((e) => e.id === id));

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div><strong>NETSCAPE</strong><small>TOPOLOGY STUDIO</small></div>
        </div>
        <div className="file">
          <span className="dot"></span>
          <div><strong>office-network.json</strong><small>自动保存到本地浏览器</small></div>
        </div>
        <div className="top-actions">
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={() => setNotice('拓扑图已保存')}>保存更改</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>↖ 选择</button>
          <button className={tool === 'connect' ? 'on' : ''} onClick={() => { setTool('connect'); connect(); }}>⌁ 连接</button>
          <button onClick={() => addNodeOfType('device')}>＋ 设备</button>
        </div>
        <div className="tool-group zoom">
          <button>−</button><span>100%</span><button>＋</button>
          <button onClick={() => setNotice('画布已居中')}>⌗</button>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title"><span>设备库</span><small>{topo.nodes.length} 个节点</small></div>
          <div className="device-types">
            {Object.entries(TYPE_LABEL).map(([t, l]) => (
              <button key={t} onClick={() => addNodeOfType(t)}>
                <i className={t}>{iconOf(t)}</i>{l}<span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head"><span>图中节点</span><small>点击查看</small></div>
          <div className="node-list">
            {topo.nodes.map((n) => (
              <button key={n.id} className={sel.kind === 'node' && sel.id === n.id ? 'sel' : ''} onClick={() => setSel({ kind: 'node', id: n.id })}>
                <i className={n.type}>{iconOf(n.type)}</i>
                <span><strong>{n.name}{n.off ? '（停用）' : ''}</strong><small>{n.ip}</small></span>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div className="canvas" ref={board} onMouseMove={move} onMouseUp={() => setDrag(null)}>
            {topo.edges.map((e) => {
              const n1 = byId(e.a), n2 = byId(e.b);
              if (!n1 || !n2) return null; // 迁移/删除已保证不出现悬空，双保险
              const dx = n2.x - n1.x, dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              const cls = [
                'edge',
                e.fault ? 'fault' : '',
                activeIds.has(e.id) ? 'path' : '',
                !activeIds.has(e.id) && staleEdges.has(e.id) ? 'stale' : '',
                sel.kind === 'edge' && sel.id === e.id ? 'picked' : '',
              ].join(' ').replace(/\s+/g, ' ').trim();
              return (
                <React.Fragment key={e.id}>
                  <div className={cls} style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}>
                    <span className="edge-arrow"></span>
                  </div>
                  <div
                    className="edge-hit"
                    style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
                    onClick={(ev) => { ev.stopPropagation(); setSel({ kind: 'edge', id: e.id }); }}
                  />
                  <div
                    className={
                      'edge-label' +
                      (e.fault ? ' fault' : '') +
                      (activeIds.has(e.id) ? ' path' : '') +
                      (staleEdges.has(e.id) && !activeIds.has(e.id) ? ' stale' : '')
                    }
                    style={{ left: (n1.x + n2.x) / 2, top: (n1.y + n2.y) / 2 }}
                  >
                    {e.fault ? '故障' : e.bw == null ? '未配置带宽' : `${e.bw}M`}
                  </div>
                </React.Fragment>
              );
            })}

            {topo.nodes.map((n) => (
              <button
                key={n.id}
                className={'node ' + n.type + (sel.kind === 'node' && sel.id === n.id ? ' picked' : '') + (n.off ? ' off' : '')}
                style={{ left: n.x - 42, top: n.y - 31 }}
                onMouseDown={(e) => { e.stopPropagation(); setSel({ kind: 'node', id: n.id }); setDrag(n.id); }}
                onClick={() => setSel({ kind: 'node', id: n.id })}
              >
                <i>{iconOf(n.type)}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
                {n.off && <b className="badge off-badge">停用</b>}
                {crit.source === n.id && <b className="badge src-badge">起</b>}
                {crit.target === n.id && <b className="badge dst-badge">终</b>}
              </button>
            ))}

            <TracePanel topo={topo} crit={crit} setCrit={setCrit} result={result} lastPath={lastPath} staleOk={staleOk} byId={byId} setSel={setSel} />

            <div className="legend">
              <span><i className="l-path"></i>可用路径</span>
              <span><i className="l-stale"></i>上次路径</span>
              <span><i className="l-fault"></i>故障/不合格</span>
            </div>
          </div>
          <div className="canvas-footer">
            <span>拖动节点调整位置 · 点击连线设置故障与带宽 · {topo.edges.length} 条连接</span>
            <span>变更后自动重算，结果与条件已本地保存</span>
          </div>
        </section>

        <Inspector
          topo={topo} node={node} edge={edge} sel={sel}
          updateNode={updateNode} updateEdge={updateEdge}
          connect={connect} removeNode={removeNode} removeEdge={removeEdge}
          setSel={setSel} crit={crit} edgeReasonFor={(e) => edgeReason(topo, e, Number(crit.minBw) || 0)}
        />
      </div>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function TracePanel({ topo, crit, setCrit, result, lastPath, staleOk, byId, setSel }) {
  const offNodes = topo.nodes.filter((n) => n.off);
  const chain = (ids, dim) => (
    <div className={'trace-chain' + (dim ? ' dim' : '')}>
      {ids.map((id, i) => (
        <React.Fragment key={id + i}>
          {i > 0 && <span className="chain-sep">→</span>}
          <button className="chain-node" onClick={() => setSel({ kind: 'node', id })}>{byId(id)?.name || id}</button>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="trace-panel">
      <div className="trace-head"><strong>故障路径追踪</strong><small>最少跳数 · BFS</small></div>
      <div className="trace-filters">
        <label>起点
          <select value={crit.source} onChange={(e) => setCrit((c) => ({ ...c, source: e.target.value }))}>
            {topo.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}{n.off ? '（停用）' : ''}</option>)}
          </select>
        </label>
        <label>终点
          <select value={crit.target} onChange={(e) => setCrit((c) => ({ ...c, target: e.target.value }))}>
            {topo.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}{n.off ? '（停用）' : ''}</option>)}
          </select>
        </label>
        <label>最低带宽（Mbps，留空不限制）
          <input type="number" min="0" step="50" value={crit.minBw} placeholder="不限制"
            onChange={(e) => setCrit((c) => ({ ...c, minBw: e.target.value === '' ? '' : Number(e.target.value) }))} />
        </label>
      </div>

      <div className={'trace-status ' + result.status}>
        {result.status === 'ok' && (
          <>
            <strong>✓ 找到可用路径</strong>
            <small>{result.hops} 跳 · 瓶颈带宽 {result.bottleneck == null ? '未配置' : result.bottleneck + ' Mbps'}</small>
            {chain(result.path)}
          </>
        )}
        {result.status === 'same' && (
          <>
            <strong>起点与终点相同</strong>
            <small>0 跳，无需经过链路</small>
            {lastPath && staleOk && <div className="last-path"><span>上次有效路径（{pathCaption(lastPath)}）</span>{chain(lastPath.nodes, true)}</div>}
          </>
        )}
        {result.status === 'unreachable' && (
          <>
            <strong>⚠ 当前条件下已不连通</strong>
            <small>仅更新提示，图中保留上次有效路径（虚线）</small>
            {lastPath && staleOk
              ? <div className="last-path"><span>上次有效路径（{pathCaption(lastPath)}）</span>{chain(lastPath.nodes, true)}</div>
              : <small className="muted">没有可显示的上次有效路径</small>}
            {result.cut.length > 0 && (
              <div className="trace-reasons">
                <span>阻断位置：</span>
                {result.cut.slice(0, 4).map(({ edge: e, reason }) => (
                  <div className="reason" key={e.id}>
                    <button onClick={() => setSel({ kind: 'edge', id: e.id })}>{byId(e.a)?.name} ↔ {byId(e.b)?.name}</button>
                    <i>{reason}</i>
                  </div>
                ))}
              </div>
            )}
            {result.cut.length === 0 && <small className="muted">起点所在区域没有任何可延伸的链路</small>}
          </>
        )}
        {result.status === 'endpoint-off' && (
          <>
            <strong>⚠ 起点或终点已停用</strong>
            <small>停用节点不参与寻路</small>
            {lastPath && staleOk && <div className="last-path"><span>上次有效路径（{pathCaption(lastPath)}）</span>{chain(lastPath.nodes, true)}</div>}
          </>
        )}
        {(result.status === 'no-source' || result.status === 'no-target') && <strong>请选择起点和终点</strong>}
      </div>

      <div className="trace-excluded">
        <div className="trace-sub"><span>被排除的链路（{result.excluded.length}）</span><small>合格 {result.eligible.length} 条</small></div>
        {result.excluded.length === 0 && <p className="muted">无：所有链路均合格参与寻路</p>}
        {result.excluded.map(({ edge: e, reason }) => (
          <div className="ex-row" key={e.id}>
            <button onClick={() => setSel({ kind: 'edge', id: e.id })}>{byId(e.a)?.name || e.a} ↔ {byId(e.b)?.name || e.b}</button>
            <i className={reason.startsWith('带宽') || reason === '未配置带宽' ? 'r-bw' : 'r-fault'}>{reason}</i>
          </div>
        ))}
        <div className="trace-sub mt"><span>停用节点（{offNodes.length}）</span></div>
        {offNodes.length === 0
          ? <p className="muted">无停用节点</p>
          : offNodes.map((n) => (
            <div className="ex-row" key={n.id}>
              <button onClick={() => setSel({ kind: 'node', id: n.id })}>{n.name}</button>
              <i className="r-fault">设备停用</i>
            </div>
          ))}
      </div>
    </div>
  );
}

function pathCaption(lp) {
  const mb = lp.crit?.minBw === '' || lp.crit?.minBw == null ? '不限带宽' : `≥${lp.crit.minBw}M`;
  return mb + (lp.at ? ' · ' + new Date(lp.at).toLocaleTimeString() : '');
}

function Inspector(props) {
  const { topo, node, edge, sel, updateNode, updateEdge, connect, removeNode, removeEdge, setSel, crit, edgeReasonFor } = props;
  if (sel.kind === 'edge' && edge) {
    const a = topo.nodes.find((n) => n.id === edge.a);
    const b = topo.nodes.find((n) => n.id === edge.b);
    const reason = edgeReasonFor(edge);
    return (
      <aside className="inspector">
        <div className="section-title"><span>链路属性</span><small>{edge.fault ? '故障' : '正常'}</small></div>
        <p className="edge-endpoints"><b className={'mini ' + a?.type} />{a?.name || edge.a} <span>↔</span> {b?.name || edge.b}<i className={'mini ' + b?.type} /></p>
        <label className="check"><input type="checkbox" checked={!!edge.fault} onChange={(e) => updateEdge(edge.id, { fault: e.target.checked })} />标记为故障链路（不参与寻路）</label>
        <label>带宽（Mbps，留空视为未配置）
          <input type="number" min="0" value={edge.bw ?? ''} placeholder="未配置" onChange={(e) => updateEdge(edge.id, { bw: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <div className={'trace-note ' + (reason ? 'bad' : 'good')}>
          {reason ? <>当前条件下被排除：<b>{reason}</b></> : <>链路合格，参与当前寻路（{crit.minBw === '' ? '不限带宽' : `≥ ${crit.minBw} Mbps`}）</>}
        </div>
        <div className="inspector-actions single">
          <button className="danger" onClick={() => removeEdge(edge.id)}>删除链路</button>
        </div>
      </aside>
    );
  }

  if (!node) return <aside className="inspector"><div className="section-title"><span>属性</span></div><p>选择一个设备或链路</p></aside>;

  return (
    <aside className="inspector">
      <div className="section-title"><span>属性</span><small>{TYPE_LABEL[node.type]}</small></div>
      <label>设备名称<input value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} /></label>
      <label>IP 地址<input value={node.ip} onChange={(e) => updateNode(node.id, { ip: e.target.value })} /></label>
      <label>设备类型
        <select value={node.type} onChange={(e) => updateNode(node.id, { type: e.target.value })}>
          {Object.entries(TYPE_LABEL).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={!!node.off} onChange={(e) => updateNode(node.id, { off: e.target.checked })} />停用该设备（不参与寻路）</label>
      <div className="inspector-actions">
        <button onClick={connect}>⌁ 添加连接</button>
        <button className="danger" onClick={() => removeNode(node.id)}>删除设备</button>
      </div>
      <div className="connections">
        <div className="section-title"><span>连接</span><small>{topo.edges.filter((e) => e.a === node.id || e.b === node.id).length} 条</small></div>
        {topo.edges.filter((e) => e.a === node.id || e.b === node.id).map((e) => {
          const other = topo.nodes.find((n) => n.id === otherEnd(e, node.id));
          const reason = edgeReasonFor(e);
          return (
            <div className={'connection' + (sel.kind === 'edge' && sel.id === e.id ? ' sel' : '') + (reason ? ' blocked' : '')}
              key={e.id} onClick={() => setSel({ kind: 'edge', id: e.id })}>
              <span className={'mini ' + other?.type}></span>
              <strong>{other?.name || '未知设备'}</strong>
              <small className={reason ? 'bad' : ''}>{reason || (e.bw == null ? '未配置带宽' : `${e.bw} Mbps`)}</small>
              <button className="conn-del" title="删除链路" onClick={(ev) => { ev.stopPropagation(); removeEdge(e.id); }}>×</button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

createRoot(document.getElementById('root')).render(<App />);
