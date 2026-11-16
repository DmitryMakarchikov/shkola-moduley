/* конструктор диаграмм UML: варианты использования и классы */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { DIAGRAM_SPEC, type DEdge, type DiagramKind, type DNode, type Diagram } from '@pc/core';
import { Button, Icon } from '../ui/ui.tsx';

const CLASS_W = 220;
const LINE = 18;
const uid = () => Math.random().toString(36).slice(2, 10);
const lines = (s?: string) => (s ? s.split('\n').filter((x) => x.trim()) : []);

/* размеры элемента; x, y — центр (у границы системы — левый верхний угол) */
const box = (n: DNode) => {
  if (n.type === 'actor') return { w: 90, h: 110 };
  if (n.type === 'usecase') return { w: Math.max(150, Math.min(260, n.name.length * 7.6 + 40)), h: n.name.length > 26 ? 76 : 60 };
  if (n.type === 'boundary') return { w: n.w ?? 600, h: n.h ?? 560 };
  const head = n.type === 'interface' ? 46 : 32;
  return { w: CLASS_W, h: head + Math.max(1, lines(n.attrs).length) * LINE + 10 + Math.max(1, lines(n.ops).length) * LINE + 10 };
};

/* точка на краю элемента по направлению к другой точке */
const edgePoint = (n: DNode, tx: number, ty: number) => {
  const { w, h } = box(n);
  const dx = tx - n.x;
  const dy = ty - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  let t: number;
  if (n.type === 'usecase') t = 1 / Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
  else t = Math.min(w / 2 / Math.abs(dx || 1e-9), h / 2 / Math.abs(dy || 1e-9));
  return { x: n.x + dx * t, y: n.y + dy * t };
};

const wrap = (s: string, max: number) => {
  if (s.length <= max) return [s];
  const words = s.split(' ');
  const out = [''];
  for (const w of words) {
    if ((out[out.length - 1] + ' ' + w).trim().length > max && out[out.length - 1]) out.push(w);
    else out[out.length - 1] = (out[out.length - 1] + ' ' + w).trim();
  }
  return out.slice(0, 3);
};

const EDGE_STYLE: Record<string, { dash?: string; end?: string; start?: string; label?: string }> = {
  association: {},
  include: { dash: '7 5', end: 'arrow', label: '«include»' },
  extend: { dash: '7 5', end: 'arrow', label: '«extend»' },
  generalization: { end: 'triangle' },
  realization: { dash: '7 5', end: 'triangle' },
  aggregation: { start: 'diamond' },
  composition: { start: 'diamond-fill' },
  dependency: { dash: '7 5', end: 'arrow' },
};

/* свободное место для нового элемента: первая клетка сетки без соседей */
const freeSpot = (nodes: DNode[], type: string) => {
  const stepX = type === 'class' || type === 'interface' ? 270 : 200;
  const stepY = type === 'class' || type === 'interface' ? 200 : 130;
  const startX = type === 'actor' ? 110 : type === 'usecase' ? 420 : 150;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 5; col++) {
      const x = type === 'actor' ? startX : startX + col * stepX;
      const y = 110 + row * stepY;
      const busy = nodes.some((n) => n.type !== 'boundary' && Math.abs(n.x - x) < stepX * 0.8 && Math.abs(n.y - y) < stepY * 0.8);
      if (!busy) return { x, y };
      if (type === 'actor') break;
    }
  }
  return { x: 160, y: 120 + nodes.length * 30 };
};

type Sel = { kind: 'node' | 'edge'; id: string } | null;

export const emptyDiagram = (kind: string): Diagram => ({ kind, nodes: [], edges: [] });

/* снимок диаграммы в PNG для отчёта: стили из CSS переносятся в атрибуты (в светлой теме), фон белый, масштаб 2 */
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility', 'display'];
export const diagramPng = async (svg: SVGSVGElement, name: string) => {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  root.dataset.theme = 'light';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = svg.querySelectorAll('*');
  const to = clone.querySelectorAll('*');
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    (to[i] as SVGElement).setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  if (theme) root.dataset.theme = theme;
  const [, , w = 800, h = 600] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok;
      img.onerror = fail;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('Не удалось сохранить рисунок');
    const href = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href, download: `${name}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const DiagramEditor = ({ value, onChange, readOnly = false, onCheck }: { value: Diagram; onChange?: (d: Diagram) => void; readOnly?: boolean; onCheck?: () => void }) => {
  const kind = value.kind as DiagramKind;
  const spec = DIAGRAM_SPEC[kind] ?? DIAGRAM_SPEC.usecase;
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [connect, setConnect] = useState<{ type: string; from: string | null } | null>(null);
  const [edgeType, setEdgeType] = useState(Object.keys(spec.edges)[0]!);
  const drag = useRef<{ id: string; dx: number; dy: number; resize?: boolean; moved: boolean } | null>(null);
  const history = useRef<Diagram[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  const set = (d: Diagram, remember = true) => {
    if (remember) history.current = [...history.current.slice(-29), value];
    onChange?.(d);
  };
  const byId = useMemo(() => new Map(value.nodes.map((n) => [n.id, n])), [value.nodes]);

  /* область рисования по содержимому */
  const view = useMemo(() => {
    let maxX = 1000;
    let maxY = 620;
    for (const n of value.nodes) {
      const { w, h } = box(n);
      const right = n.type === 'boundary' ? n.x + w : n.x + w / 2;
      const bottom = n.type === 'boundary' ? n.y + h : n.y + h / 2;
      maxX = Math.max(maxX, right + 40);
      maxY = Math.max(maxY, bottom + 40);
    }
    return { w: maxX, h: maxY };
  }, [value.nodes]);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const add = (type: string) => {
    const count = value.nodes.filter((n) => n.type === type).length + 1;
    const base = spec.nodes[type]!;
    const n: DNode =
      type === 'boundary'
        ? { id: uid(), type, name: 'Система', x: 260, y: 30, w: 600, h: 560 }
        : { id: uid(), type, name: type === 'class' || type === 'interface' ? `${base}${count}` : `${base} ${count}`, ...freeSpot(value.nodes, type), ...(type === 'class' || type === 'interface' ? { attrs: '', ops: '' } : {}) };
    set({ ...value, nodes: type === 'boundary' ? [n, ...value.nodes] : [...value.nodes, n] });
    setSel({ kind: 'node', id: n.id });
    setTimeout(() => nameRef.current?.select(), 30);
  };

  const remove = () => {
    if (!sel) return;
    if (sel.kind === 'node') set({ ...value, nodes: value.nodes.filter((n) => n.id !== sel.id), edges: value.edges.filter((e) => e.from !== sel.id && e.to !== sel.id) });
    else set({ ...value, edges: value.edges.filter((e) => e.id !== sel.id) });
    setSel(null);
  };

  const undo = () => {
    const prev = history.current.pop();
    if (prev) onChange?.(prev);
  };

  const patchNode = (id: string, patch: Partial<DNode>, remember = false) => set({ ...value, nodes: value.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }, remember);

  /* нажатие на элемент: выбор, перетаскивание или связь */
  const onNodeDown = (e: RPointerEvent, n: DNode, resize = false) => {
    if (readOnly) return;
    e.stopPropagation();
    if (connect && n.type !== 'boundary') {
      if (!connect.from) setConnect({ ...connect, from: n.id });
      else if (connect.from !== n.id) {
        const edge: DEdge = { id: uid(), type: connect.type, from: connect.from, to: n.id };
        set({ ...value, edges: [...value.edges, edge] });
        setConnect({ ...connect, from: null });
        setSel({ kind: 'edge', id: edge.id });
      }
      return;
    }
    setSel({ kind: 'node', id: n.id });
    const p = toSvg(e);
    history.current = [...history.current.slice(-29), value];
    drag.current = resize ? { id: n.id, dx: 0, dy: 0, resize: true, moved: false } : { id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e);
    const n = byId.get(d.id);
    if (!n) return;
    d.moved = true;
    const snap = (v: number) => Math.max(0, Math.round(v / 10) * 10);
    if (d.resize) patchNode(n.id, { w: Math.max(200, snap(p.x - n.x)), h: Math.max(160, snap(p.y - n.y)) });
    else patchNode(n.id, { x: snap(p.x - d.dx), y: snap(p.y - d.dy) });
  };

  const onUp = () => {
    if (drag.current && !drag.current.moved) history.current.pop();
    drag.current = null;
  };

  useEffect(() => {
    if (readOnly) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      if (e.key === 'Escape') setConnect(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) remove();
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) undo();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  const selNode = sel?.kind === 'node' ? byId.get(sel.id) : undefined;
  const selEdge = sel?.kind === 'edge' ? value.edges.find((e) => e.id === sel.id) : undefined;
  const label = (id: string) => byId.get(id)?.name || 'без имени';

  return (
    <div className={`diagram ${readOnly ? 'diagram--ro' : ''}`}>
      {/* панель инструментов */}
      {!readOnly && (
        <div className="diagram__bar" role="toolbar" aria-label="Инструменты диаграммы">
          <span className="diagram__group">
            {Object.entries(spec.nodes).map(([t, l]) => (
              <Button key={t} size="sm" icon="plus" onClick={() => add(t)}>
                {l}
              </Button>
            ))}
          </span>
          <span className="diagram__group">
            <select className="input input--inline" aria-label="Вид связи" value={edgeType} onChange={(e) => (setEdgeType(e.target.value), connect && setConnect({ type: e.target.value, from: null }))}>
              {Object.entries(spec.edges).map(([t, l]) => (
                <option key={t} value={t}>
                  {l}
                </option>
              ))}
            </select>
            <Button size="sm" kind={connect ? 'primary' : 'default'} icon="cycle" aria-pressed={!!connect} onClick={() => setConnect(connect ? null : { type: edgeType, from: null })}>
              {connect ? 'Готово' : 'Соединить'}
            </Button>
          </span>
          <span className="diagram__group">
            <Button size="sm" kind="ghost" onClick={undo} disabled={!history.current.length}>
              Отменить
            </Button>
            <Button size="sm" kind="ghost" icon="trash" onClick={remove} disabled={!sel}>
              Удалить
            </Button>
            <Button size="sm" kind="ghost" icon="image" disabled={!value.nodes.length} title="Сохранить диаграмму рисунком PNG — например, для отчёта" onClick={() => svgRef.current && void diagramPng(svgRef.current, spec.title).catch(() => undefined)}>
              PNG
            </Button>
            {onCheck && (
              <Button size="sm" kind="success" icon="check" onClick={onCheck}>
                Проверить
              </Button>
            )}
          </span>
        </div>
      )}
      {connect && <p className="diagram__hint">{connect.from ? `Теперь нажмите на второй элемент — «${label(connect.from)}» будет соединён с ним (${spec.edges[connect.type]})` : `Нажмите на первый элемент связи «${spec.edges[connect.type]}»`}</p>}

      {/* холст */}
      <div className="diagram__scroll">
        <svg
          ref={svgRef}
          className="diagram__svg"
          viewBox={`0 0 ${view.w} ${view.h}`}
          style={{ minWidth: Math.min(view.w, 760) }}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerDown={() => !readOnly && (setSel(null), connect && setConnect({ ...connect, from: null }))}
          role="img"
          aria-label={`${spec.title}: ${value.nodes.length} элементов, ${value.edges.length} связей`}
        >
          <defs>
            <marker id="m-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M1 1 11 6 1 11" fill="none" className="diagram__ink" strokeWidth="1.6" />
            </marker>
            <marker id="m-triangle" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M1 1 15 8 1 15z" className="diagram__hollow" strokeWidth="1.6" />
            </marker>
            <marker id="m-diamond" viewBox="0 0 20 12" refX="1" refY="6" markerWidth="20" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M1 6 10 1 19 6 10 11z" className="diagram__hollow" strokeWidth="1.6" />
            </marker>
            <marker id="m-diamond-fill" viewBox="0 0 20 12" refX="1" refY="6" markerWidth="20" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M1 6 10 1 19 6 10 11z" className="diagram__fill" strokeWidth="1.6" />
            </marker>
          </defs>

          {/* граница системы — под остальными элементами */}
          {value.nodes
            .filter((n) => n.type === 'boundary')
            .map((n) => {
              const { w, h } = box(n);
              const on = sel?.id === n.id;
              return (
                <g key={n.id} className={`dg-node ${on ? 'is-sel' : ''}`} onPointerDown={(e) => onNodeDown(e, n)}>
                  <rect x={n.x} y={n.y} width={w} height={h} rx="6" className="diagram__boundary" />
                  <text x={n.x + w / 2} y={n.y + 24} textAnchor="middle" className="diagram__title">
                    {n.name}
                  </text>
                  {!readOnly && on && <rect x={n.x + w - 14} y={n.y + h - 14} width="14" height="14" className="diagram__handle" onPointerDown={(e) => onNodeDown(e, n, true)} />}
                </g>
              );
            })}

          {/* связи */}
          {value.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const p1 = edgePoint(a, b.x, b.y);
            const p2 = edgePoint(b, a.x, a.y);
            const st = EDGE_STYLE[e.type] ?? {};
            const on = sel?.id === e.id;
            return (
              <g key={e.id} className={`dg-edge ${on ? 'is-sel' : ''}`} onPointerDown={(ev) => !readOnly && (ev.stopPropagation(), setSel({ kind: 'edge', id: e.id }))}>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="diagram__hit" />
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  className="diagram__line"
                  strokeDasharray={st.dash}
                  markerEnd={st.end ? `url(#m-${st.end})` : undefined}
                  markerStart={st.start ? `url(#m-${st.start})` : undefined}
                />
                {st.label && (
                  <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 6} textAnchor="middle" className="diagram__small">
                    {st.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* элементы */}
          {value.nodes
            .filter((n) => n.type !== 'boundary')
            .map((n) => {
              const { w, h } = box(n);
              const on = sel?.id === n.id || connect?.from === n.id;
              return (
                <g key={n.id} className={`dg-node ${on ? 'is-sel' : ''} ${connect ? 'is-target' : ''}`} onPointerDown={(e) => onNodeDown(e, n)}>
                  {n.type === 'actor' && (
                    <>
                      <rect x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} className="diagram__hit-box" />
                      <circle cx={n.x} cy={n.y - 36} r="11" className="diagram__shape" />
                      <path d={`M${n.x} ${n.y - 25}v30M${n.x - 20} ${n.y - 12}h40M${n.x} ${n.y + 5}l-15 24M${n.x} ${n.y + 5}l15 24`} className="diagram__stroke" />
                      <text x={n.x} y={n.y + 48} textAnchor="middle" className="diagram__text">
                        {n.name}
                      </text>
                    </>
                  )}
                  {n.type === 'usecase' && (
                    <>
                      <ellipse cx={n.x} cy={n.y} rx={w / 2} ry={h / 2} className="diagram__shape" />
                      {wrap(n.name, 26).map((t, i, arr) => (
                        <text key={i} x={n.x} y={n.y + 5 + (i - (arr.length - 1) / 2) * 16} textAnchor="middle" className="diagram__text">
                          {t}
                        </text>
                      ))}
                    </>
                  )}
                  {(n.type === 'class' || n.type === 'interface') && (
                    <ClassBox n={n} w={w} h={h} />
                  )}
                </g>
              );
            })}
        </svg>
        {value.nodes.length === 0 && <p className="diagram__empty">{readOnly ? 'Диаграмма пустая' : `Добавьте элементы кнопками выше. ${kind === 'usecase' ? 'Начните с актёров и прецедентов.' : 'Начните с классов.'}`}</p>}
      </div>

      {/* свойства выбранного */}
      {!readOnly && selNode && (
        <div className="diagram__props">
          <label className="field">
            <span className="field__label">Название: {spec.nodes[selNode.type]?.toLowerCase()}</span>
            <input ref={nameRef} className="input" value={selNode.name} onChange={(e) => patchNode(selNode.id, { name: e.target.value })} onFocus={() => (history.current = [...history.current.slice(-29), value])} />
          </label>
          {(selNode.type === 'class' || selNode.type === 'interface') && (
            <div className="form__row">
              <label className="field">
                <span className="field__label">Атрибуты (каждый с новой строки)</span>
                <textarea className="input textarea textarea--code" value={selNode.attrs ?? ''} onChange={(e) => patchNode(selNode.id, { attrs: e.target.value })} placeholder="название: строка" />
              </label>
              <label className="field">
                <span className="field__label">Операции</span>
                <textarea className="input textarea textarea--code" value={selNode.ops ?? ''} onChange={(e) => patchNode(selNode.id, { ops: e.target.value })} placeholder="найти(запрос)" />
              </label>
            </div>
          )}
        </div>
      )}
      {!readOnly && selEdge && (
        <div className="diagram__props diagram__props--row">
          <span>
            {label(selEdge.from)} <Icon name="arrow-right" size={14} /> {label(selEdge.to)}
          </span>
          <select className="input input--inline" aria-label="Вид связи" value={selEdge.type} onChange={(e) => set({ ...value, edges: value.edges.map((x) => (x.id === selEdge.id ? { ...x, type: e.target.value } : x)) })}>
            {Object.entries(spec.edges).map(([t, l]) => (
              <option key={t} value={t}>
                {l}
              </option>
            ))}
          </select>
          <Button size="sm" kind="ghost" onClick={() => set({ ...value, edges: value.edges.map((x) => (x.id === selEdge.id ? { ...x, from: x.to, to: x.from } : x)) })}>
            <Icon name="cycle" size={16} /> Развернуть
          </Button>
        </div>
      )}
    </div>
  );
};

const ClassBox = ({ n, w, h }: { n: DNode; w: number; h: number }) => {
  const x = n.x - w / 2;
  const y = n.y - h / 2;
  const head = n.type === 'interface' ? 46 : 32;
  const attrs = lines(n.attrs);
  const ops = lines(n.ops);
  const opsY = y + head + Math.max(1, attrs.length) * LINE + 10;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="4" className="diagram__shape" />
      {n.type === 'interface' && (
        <text x={n.x} y={y + 18} textAnchor="middle" className="diagram__small">
          «interface»
        </text>
      )}
      <text x={n.x} y={y + head - 11} textAnchor="middle" className="diagram__title">
        {n.name}
      </text>
      <line x1={x} y1={y + head} x2={x + w} y2={y + head} className="diagram__stroke" />
      {attrs.map((a, i) => (
        <text key={i} x={x + 10} y={y + head + 16 + i * LINE} className="diagram__mono">
          {a.length > 30 ? `${a.slice(0, 29)}…` : a}
        </text>
      ))}
      <line x1={x} y1={opsY} x2={x + w} y2={opsY} className="diagram__stroke" />
      {ops.map((a, i) => (
        <text key={i} x={x + 10} y={opsY + 16 + i * LINE} className="diagram__mono">
          {a.length > 30 ? `${a.slice(0, 29)}…` : a}
        </text>
      ))}
    </>
  );
};

/* результат проверки */
export const CheckResult = ({ r }: { r: { errors: string[]; warnings: string[]; score: number | null; summary: string[] } }) => (
  <div className="check-res">
    {r.score !== null && (
      <p className="check-res__score">
        Совпадение с эталоном: <strong>{r.score}%</strong>
      </p>
    )}
    {r.errors.length === 0 && r.warnings.length === 0 && <p className="check-res__ok">Ошибок нотации не найдено</p>}
    {r.errors.length > 0 && (
      <ul className="check-res__list check-res__list--err">
        {r.errors.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    )}
    {r.warnings.length > 0 && (
      <ul className="check-res__list check-res__list--warn">
        {r.warnings.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    )}
    {r.summary.length > 0 && (
      <ul className="check-res__list">
        {r.summary.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    )}
  </div>
);
