import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { edgeName, findTrace } from './graph.js';
import { defaultFilters, loadState, saveState } from './storage.js';

const ICONS = { router: '◉', switch: '▦', server: '▣', device: '▱' };
const iconOf = (t) => ICONS[t] || '▱';
const uid = (p) => p + Date.now().toString(36);

export function App() {
  const initial = useRef(loadState()).current;
  const [graph, setGraph] = useState(initial.graph);
  const [filters, setFilters] = useState(initial.filters);
  const [lastPath, setLastPath] = useState(initial.lastPath);
  const [pathSignature, setPathSignature] = useState(initial.pathSignature);

  const [selectedNode, setSelectedNode] = useState(initial.graph.nodes[0]?.id || null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(null);
  const board = useRef();

  const { nodes, edges } = graph;
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const node = nodes.find((n) => n.id === selectedNode) || null;
  const edgeObj = edges.find((e) => e.id === selectedEdge) || null;
  const selected = { type: edgeObj ? 'edge' : 'node', node, edge: edgeObj };

  // ---------- 持久化：图、筛选条件与最近一次有效结果一起保存 ----------
  useEffect(() => {
    saveState({ graph, filters, lastPath, pathSignature });
  }, [graph, filters, lastPath, pathSignature]);

  // ---------- 故障路径追踪（任何图变化或筛选变化都会自动重算） ----------
  const trace = useMemo(() => findTrace(graph, filters), [graph, filters]);

  // 仅当找到可用路径时才替换“上次有效路径”；不连通时保留旧结果，不改原图。
  // pathSignature 始终对应 lastPath 所属的查询：切换起终点后旧路径不再展示，
  // 只有同一查询因拓扑变化断开时，才灰显上次有效路径。
  const signatureKey = `${filters.source}>${filters.target}@${filters.minBandwidth}`;
  useEffect(() => {
    if (trace.status === 'ok') {
      setLastPath({ ...trace.path });
      setPathSignature(signatureKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace]);

  const isCurrent = signatureKey === pathSignature;
  const activePath = trace.status === 'ok' ? trace.path : isCurrent && lastPath ? lastPath : null;
  const stale = trace.status !== 'ok' && !!activePath;

  const prevStatus = useRef(null);
  useEffect(() => {
    if (prevStatus.current && prevStatus.current !== trace.status) {
      if (trace.status === 'unreachable') setNotice('路径已中断：保留并灰显上次有效路径，未改动原图');
      if (trace.status === 'ok') setNotice('已按最少跳数重新计算可用路径');
    }
    prevStatus.current = trace.status;
  }, [trace.status]);

  // ---------- 图编辑 ----------
  const patchGraph = (next) => setGraph((g) => ({ ...g, ...next }));

  const updateNode = (k, v) =>
    patchGraph({ nodes: nodes.map((n) => (n.id === selectedNode ? { ...n, [k]: v } : n)) });

  const updateEdge = (k, v) =>
    patchGraph({ edges: edges.map((e) => (e.id === selectedEdge ? { ...e, [k]: v } : e)) });

  const addNodeOfType = (type, label) => {
    const id = uid('node-');
    const n = { id, name: label || '新设备', type, x: 500, y: 320, ip: '192.168.0.2', disabled: false };
    patchGraph({ nodes: [...nodes, n] });
    setSelectedNode(id);
    setSelectedEdge(null);
    setTool('select');
  };

  const connect = () => {
    if (!node) return;
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (!nodes.some((n) => n.id === other)) return setNotice('未找到该设备 ID');
    if (other === node.id) return setNotice('不能连接设备自身');
    if (edges.some((e) => (e.source === node.id && e.target === other) || (e.target === node.id && e.source === other))) {
      return setNotice('连接已存在');
    }
    patchGraph({
      edges: [...edges, { id: uid('e-'), source: node.id, target: other, bandwidth: 1000, faulty: false }],
    });
    setNotice('连接已创建');
  };

  const deleteEdge = (id) => {
    patchGraph({ edges: edges.filter((e) => e.id !== id) });
    if (selectedEdge === id) setSelectedEdge(null);
  };

  const removeNode = () => {
    if (!node) return;
    patchGraph({
      nodes: nodes.filter((n) => n.id !== node.id),
      edges: edges.filter((e) => e.source !== node.id && e.target !== node.id),
    });
    // 端点消失的连接一并移除，不留下悬空连接；筛选中的 id 保留以便面板提示“已删除”。
    if (selectedNode === node.id) setSelectedNode(nodes.find((n) => n.id !== node.id)?.id || null);
    setSelectedEdge(null);
    setNotice('设备已删除，相关连接已一并清理');
  };

  const move = (e) => {
    if (!drag) return;
    const r = board.current.getBoundingClientRect();
    patchGraph({
      nodes: nodes.map((n) =>
        n.id === drag
          ? { ...n, x: Math.max(45, e.clientX - r.left), y: Math.max(35, e.clientY - r.top) }
          : n
      ),
    });
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    setNotice('JSON 已导出');
  };

  const validate = () => {
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    const isolated = nodes.filter((n) => !linked.has(n.id));
    setNotice(isolated.length ? `发现 ${isolated.length} 个孤立节点` : '拓扑检查通过：没有孤立节点');
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setNotice('筛选条件已重置');
  };

  const exclusionMap = new Map(trace.exclusions.map((x) => [x.edge.id, x.reasons]));
  const activeEdgeIds = new Set(activePath?.edgeIds || []);
  const activeNodeIds = new Set(activePath?.nodeIds || []);

  const edgeClass = (e) => {
    const cls = ['edge'];
    if (selectedEdge === e.id) cls.push('sel');
    if (activeEdgeIds.has(e.id)) cls.push(stale ? 'path-stale' : 'path');
    else {
      const r = exclusionMap.get(e.id);
      if (r) {
        if (e.faulty) cls.push('ex-fault');
        else if (nodeMap.get(e.source)?.disabled || nodeMap.get(e.target)?.disabled) cls.push('ex-off');
        else cls.push('ex-bw');
      }
    }
    return cls.join(' ');
  };

  const nodeClass = (n) =>
    'node ' + n.type + (selectedNode === n.id ? ' picked' : '') +
    (n.disabled ? ' disabled' : '') + (activeNodeIds.has(n.id) ? (stale ? ' on-path stale' : ' on-path') : '');

  const connectedEdges = (id) => edges.filter((e) => e.source === id || e.target === id);

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
          <button onClick={() => addNodeOfType('device', '新设备')}>＋ 设备</button>
        </div>
        <div className="tool-group zoom">
          <button>−</button><span>100%</span><button>＋</button>
          <button onClick={() => setNotice('画布已居中')}>⌗</button>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title"><span>设备库</span><small>{nodes.length} 个节点</small></div>
          <div className="device-types">
            {[['router', '路由器'], ['switch', '交换机'], ['server', '服务器'], ['device', '终端设备']].map(([t, l]) => (
              <button key={t} onClick={() => addNodeOfType(t, l)}>
                <i className={t}>{iconOf(t)}</i>{l}<span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head"><span>图中节点</span><small>点击查看</small></div>
          <div className="node-list">
            {nodes.map((n) => (
              <button key={n.id} className={selectedNode === n.id ? 'sel' : ''}
                onClick={() => { setSelectedNode(n.id); setSelectedEdge(null); }}>
                <i className={n.type}>{iconOf(n.type)}</i>
                <span><strong>{n.name}{n.disabled ? '（停用）' : ''}</strong><small>{n.ip}</small></span>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div className={'canvas' + (drag ? ' dragging' : '')} ref={board} onMouseMove={move} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
            {edges.map((e) => {
              const n1 = nodeMap.get(e.source);
              const n2 = nodeMap.get(e.target);
              if (!n1 || !n2) return null;
              const dx = n2.x - n1.x, dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <button key={e.id} className={edgeClass(e)} title={`${edgeName(e, nodeMap)} · ${e.bandwidth} Mbps${e.faulty ? ' · 故障' : ''}`}
                  style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
                  onClick={(ev) => { ev.stopPropagation(); setSelectedEdge(e.id); setSelectedNode(null); }}>
                  <i className="line"></i>
                  <i className="hit"></i>
                  <span className="arrow"></span>
                  <b className="bw-label">{e.faulty ? '故障' : `${e.bandwidth}M`}</b>
                </button>
              );
            })}

            {nodes.map((n) => (
              <button key={n.id} className={nodeClass(n)} style={{ left: n.x - 42, top: n.y - 31 }}
                onMouseDown={(e) => { e.stopPropagation(); setSelectedNode(n.id); setSelectedEdge(null); setDrag(n.id); }}
                onClick={() => setSelectedNode(n.id)}>
                <i>{iconOf(n.type)}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
                {n.disabled && <em className="off-badge">停用</em>}
              </button>
            ))}

            <div className="legend">
              <span><i className="lg-path"></i>可用路径</span>
              <span><i className="lg-fault"></i>故障/排除</span>
              <span><i className="lg-off"></i>停用</span>
            </div>
          </div>

          <TraceBar
            graph={graph} filters={filters} trace={trace} activePath={activePath} stale={stale}
            nodeMap={nodeMap} onChange={setFilters} onReset={resetFilters}
            onPickNode={(id) => { setSelectedNode(id); setSelectedEdge(null); }}
            onPickEdge={(id) => { setSelectedEdge(id); setSelectedNode(null); }}
          />

          <div className="canvas-footer">
            <span>拖动节点调整位置 · {edges.length} 条连接 · 连线可点击设置故障与带宽</span>
            <span>坐标系：画布局部</span>
          </div>
        </section>

        <aside className="inspector">
          {selected.edge && <EdgeInspector
            edge={selected.edge} nodeMap={nodeMap}
            onChange={updateEdge} onDelete={() => deleteEdge(selected.edge.id)}
            reasons={exclusionMap.get(selected.edge.id)}
          />}
          {!selected.edge && node && <NodeInspector
            node={node} edges={connectedEdges(node.id)} nodeMap={nodeMap}
            onChange={updateNode} onConnect={connect} onRemove={removeNode}
            onPickEdge={(id) => setSelectedEdge(id)}
          />}
          {!selected.edge && !node && <p className="empty-hint">选择一个设备或连线</p>}
        </aside>
      </div>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function NodeInspector({ node, edges, nodeMap, onChange, onConnect, onRemove, onPickEdge }) {
  return (
    <>
      <div className="section-title"><span>属性</span><small>{node.type}</small></div>
      <label>设备名称
        <input value={node.name} onChange={(e) => onChange('name', e.target.value)} />
      </label>
      <label>IP 地址
        <input value={node.ip} onChange={(e) => onChange('ip', e.target.value)} />
      </label>
      <label>设备类型
        <select value={node.type} onChange={(e) => onChange('type', e.target.value)}>
          <option value="router">路由器</option>
          <option value="switch">交换机</option>
          <option value="server">服务器</option>
          <option value="device">终端设备</option>
        </select>
      </label>
      <label>运行状态
        <div className="segment">
          <button className={!node.disabled ? 'on ok' : ''} onClick={() => onChange('disabled', false)}>启用</button>
          <button className={node.disabled ? 'on off' : ''} onClick={() => onChange('disabled', true)}>停用</button>
        </div>
      </label>
      <div className="inspector-actions">
        <button onClick={onConnect}>⌁ 添加连接</button>
        <button className="danger" onClick={onRemove}>删除设备</button>
      </div>
      <div className="connections">
        <div className="section-title"><span>连接</span><small>{edges.length} 条</small></div>
        {edges.map((e) => {
          const other = nodeMap.get(e.source === node.id ? e.target : e.source);
          return (
            <button key={e.id} className="connection" onClick={() => onPickEdge(e.id)}>
              <span className={'mini ' + other?.type}></span>
              <strong>{other?.name || '未知设备'}</strong>
              <small className={e.faulty ? 'bad' : ''}>{e.faulty ? '故障' : `${e.bandwidth}M`}</small>
            </button>
          );
        })}
        {!edges.length && <p className="empty-hint">暂无连接</p>}
      </div>
    </>
  );
}

function EdgeInspector({ edge, nodeMap, onChange, onDelete, reasons }) {
  const a = nodeMap.get(edge.source);
  const b = nodeMap.get(edge.target);
  return (
    <>
      <div className="section-title"><span>链路属性</span><small>EDGE</small></div>
      <div className="edge-meta">
        <span className={'mini ' + a?.type}></span><strong>{a?.name || edge.source}</strong>
        <i>⌁</i>
        <span className={'mini ' + b?.type}></span><strong>{b?.name || edge.target}</strong>
      </div>
      <label>带宽 (Mbps)
        <input type="number" min="0" step="50" value={edge.bandwidth}
          onChange={(e) => onChange('bandwidth', Math.max(0, Number(e.target.value) || 0))} />
      </label>
      <label>链路状态
        <div className="segment">
          <button className={!edge.faulty ? 'on ok' : ''} onClick={() => onChange('faulty', false)}>正常</button>
          <button className={edge.faulty ? 'on danger' : ''} onClick={() => onChange('faulty', true)}>故障</button>
        </div>
      </label>
      <div className={'edge-reasons ' + (reasons?.length ? 'show' : '')}>
        <span>本链路是否参与寻路：</span>
        {reasons?.length
          ? reasons.map((r) => <b key={r} className="tag bad">✕ {r}</b>)
          : <b className="tag good">✓ 合格，参与寻路</b>}
      </div>
      <div className="inspector-actions">
        <button className="danger" onClick={onDelete}>删除该连接</button>
      </div>
    </>
  );
}

function TraceBar({ graph, filters, trace, activePath, stale, nodeMap, onChange, onReset, onPickNode, onPickEdge }) {
  const { nodes } = graph;
  const statusText = {
    incomplete: '请选择起点与终点后开始追踪',
    blocked: trace.message,
    unreachable: '当前无可用路径 — 下方灰显的是上次有效路径，原图未做任何改动',
    ok: activePath?.hops === 0
      ? '起点与终点相同：0 跳即达'
      : `找到可用路径：${activePath?.hops} 跳 · 瓶颈带宽 ${activePath?.bottleneck} Mbps`,
  }[trace.status];

  return (
    <div className={'tracebar status-' + trace.status + (stale ? ' is-stale' : '')}>
      <div className="trace-controls">
        <div className="trace-title"><span>故障路径追踪</span><small>最少跳数 · 自动重算</small></div>
        <label>起点
          <select value={filters.source || ''} onChange={(e) => onChange({ ...filters, source: e.target.value })}>
            <option value="">选择起点…</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}{n.disabled ? '（停用）' : ''}</option>)}
          </select>
        </label>
        <label>终点
          <select value={filters.target || ''} onChange={(e) => onChange({ ...filters, target: e.target.value })}>
            <option value="">选择终点…</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}{n.disabled ? '（停用）' : ''}</option>)}
          </select>
        </label>
        <label>最低带宽
          <input type="number" min="0" step="50" value={filters.minBandwidth}
            onChange={(e) => onChange({ ...filters, minBandwidth: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <button className="trace-reset" onClick={onReset}>重置</button>
      </div>

      <div className="trace-result">
        <p className={'trace-status ' + (trace.status === 'ok' && !stale ? 'ok' : 'bad')}>
          {stale && <em className="stale-flag">上次有效</em>}{statusText}
        </p>
        {activePath && (
          <div className="trace-path">
            {activePath.nodeIds.map((id, i) => {
              const n = nodeMap.get(id);
              return (
                <React.Fragment key={id + i}>
                  <button className={'hop' + (n?.disabled ? ' off' : '') + (!n ? ' missing' : '')}
                    onClick={() => n && onPickNode(id)} title={n ? n.ip : '该设备已删除'}>
                    {n ? n.name : '已删除设备'}
                    {n?.disabled ? '（停用）' : ''}
                  </button>
                  {i < activePath.nodeIds.length - 1 && <i>→</i>}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      <div className="trace-exclusions">
        <div className="trace-ex-head">
          <span>未参与路径的元素（{trace.exclusions.length + trace.disabledNodes.length}）</span>
          <small>点击可定位</small>
        </div>
        <div className="trace-ex-list">
          {trace.exclusions.map(({ edge: e, reasons }) => (
            <button key={e.id} className="ex-row" onClick={() => onPickEdge(e.id)}>
              <b>{edgeName(e, nodeMap)}</b>
              {reasons.map((r) => <span key={r} className={'tag ' + (r.includes('故障') ? 'bad' : r.includes('停用') || r.includes('缺失') ? 'off' : 'warn')}>✕ {r}</span>)}
            </button>
          ))}
          {trace.disabledNodes.map((n) => (
            <button key={n.id} className="ex-row" onClick={() => onPickNode(n.id)}>
              <b>{n.name}</b><span className="tag off">✕ 设备停用</span>
            </button>
          ))}
          {!trace.exclusions.length && !trace.disabledNodes.length && <small className="all-clear">所有链路均合格</small>}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
