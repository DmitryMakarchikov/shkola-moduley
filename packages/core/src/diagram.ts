/* диаграммы UML: модель, правила нотации и сравнение с эталоном преподавателя */
import { bad } from './errors.ts';
import { norm } from './validate.ts';

export interface DNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  attrs?: string;
  ops?: string;
}
export interface DEdge {
  id: string;
  type: string;
  from: string;
  to: string;
}
export interface Diagram {
  kind: string;
  nodes: DNode[];
  edges: DEdge[];
}

export const DIAGRAM_SPEC = {
  usecase: {
    title: 'Диаграмма вариантов использования',
    nodes: { actor: 'Актёр', usecase: 'Прецедент', boundary: 'Граница системы' } as Record<string, string>,
    edges: { association: 'Ассоциация', include: '«include»', extend: '«extend»', generalization: 'Обобщение' } as Record<string, string>,
  },
  class: {
    title: 'Диаграмма классов',
    nodes: { class: 'Класс', interface: 'Интерфейс' } as Record<string, string>,
    edges: { association: 'Ассоциация', generalization: 'Наследование', realization: 'Реализация', aggregation: 'Агрегация', composition: 'Композиция', dependency: 'Зависимость' } as Record<string, string>,
  },
} as const;

export type DiagramKind = keyof typeof DIAGRAM_SPEC;
export const DIAGRAM_KINDS = Object.keys(DIAGRAM_SPEC) as DiagramKind[];
export const isDiagramKind = (k: unknown): k is DiagramKind => typeof k === 'string' && k in DIAGRAM_SPEC;

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/* проверка формата диаграммы, пришедшей от клиента */
export const parseDiagram = (v: unknown, kind: string): Diagram => {
  if (!isDiagramKind(kind)) throw bad('Неизвестный вид диаграммы');
  const d = (v ?? {}) as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw bad('Диаграмма повреждена');
  if (d.nodes.length > 200 || d.edges.length > 400) throw bad('Слишком большая диаграмма');
  const spec = DIAGRAM_SPEC[kind];
  const nodes: DNode[] = d.nodes.map((n: Record<string, unknown>) => {
    if (typeof n.type !== 'string' || !(n.type in spec.nodes)) throw bad('Неизвестный элемент диаграммы');
    return {
      id: text(n.id, 40) || Math.random().toString(36).slice(2),
      type: n.type,
      name: text(n.name, 120),
      x: num(n.x, 4000),
      y: num(n.y, 4000),
      ...(n.w ? { w: num(n.w, 4000), h: num(n.h, 4000) } : {}),
      ...(n.attrs ? { attrs: text(n.attrs, 2000) } : {}),
      ...(n.ops ? { ops: text(n.ops, 2000) } : {}),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: DEdge[] = d.edges.map((e: Record<string, unknown>) => {
    if (typeof e.type !== 'string' || !(e.type in spec.edges)) throw bad('Неизвестная связь на диаграмме');
    const from = text(e.from, 40);
    const to = text(e.to, 40);
    if (!ids.has(from) || !ids.has(to)) throw bad('Связь ведёт к несуществующему элементу');
    return { id: text(e.id, 40) || Math.random().toString(36).slice(2), type: e.type, from, to };
  });
  return { kind, nodes, edges };
};

export interface DiagramCheck {
  /* ошибки нотации: показываются учащемуся сразу */
  errors: string[];
  /* замечания, которые не делают диаграмму неверной */
  warnings: string[];
  /* сравнение с эталоном: процент совпадения и сводка без раскрытия ответа */
  score: number | null;
  summary: string[];
}

const label = (n: DNode | undefined) => (n ? `«${n.name || 'без имени'}»` : '');

/* правила нотации UML */
const rules = (d: Diagram) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const real = d.nodes.filter((n) => n.type !== 'boundary');

  for (const n of real) if (!n.name.trim()) errors.push(`Есть ${DIAGRAM_SPEC[d.kind as DiagramKind].nodes[n.type]?.toLowerCase()} без имени`);
  const seen = new Map<string, number>();
  for (const n of real) seen.set(`${n.type}:${norm(n.name)}`, (seen.get(`${n.type}:${norm(n.name)}`) ?? 0) + 1);
  for (const [k, c] of seen) if (c > 1 && k.split(':')[1]) errors.push(`Имя ${label(real.find((n) => `${n.type}:${norm(n.name)}` === k))} повторяется ${c} раза`);

  for (const e of d.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    if (a.id === b.id) {
      errors.push(`Связь элемента ${label(a)} с самим собой`);
      continue;
    }
    if (a.type === 'boundary' || b.type === 'boundary') {
      errors.push('Граница системы не соединяется связями — она только объединяет прецеденты');
      continue;
    }
    if (d.kind === 'usecase') {
      if (e.type === 'association' && !((a.type === 'actor' && b.type === 'usecase') || (a.type === 'usecase' && b.type === 'actor'))) {
        errors.push(`Ассоциация ${label(a)} — ${label(b)}: ассоциация соединяет актёра и прецедент`);
      }
      if ((e.type === 'include' || e.type === 'extend') && !(a.type === 'usecase' && b.type === 'usecase')) {
        errors.push(`Отношение «${e.type}» между ${label(a)} и ${label(b)}: допустимо только между прецедентами`);
      }
      if (e.type === 'generalization' && a.type !== b.type) errors.push(`Обобщение ${label(a)} — ${label(b)}: связывает элементы одного вида`);
    } else {
      if (e.type === 'generalization' && a.type !== b.type) errors.push(`Наследование ${label(a)} — ${label(b)}: класс наследует класс, интерфейс — интерфейс`);
      if (e.type === 'realization' && !(a.type === 'class' && b.type === 'interface')) errors.push(`Реализация ${label(a)} — ${label(b)}: класс реализует интерфейс`);
    }
  }

  /* повторяющиеся связи */
  const pairs = new Set<string>();
  for (const e of d.edges) {
    const k = `${e.type}:${[e.from, e.to].sort().join('|')}`;
    if (pairs.has(k)) warnings.push(`Связь между ${label(byId.get(e.from))} и ${label(byId.get(e.to))} нарисована дважды`);
    pairs.add(k);
  }

  /* циклы наследования */
  const parents = new Map<string, string[]>();
  for (const e of d.edges) if (e.type === 'generalization') parents.set(e.from, [...(parents.get(e.from) ?? []), e.to]);
  const cyclic = (start: string) => {
    const stack = [...(parents.get(start) ?? [])];
    const visited = new Set<string>();
    while (stack.length) {
      const x = stack.pop()!;
      if (x === start) return true;
      if (visited.has(x)) continue;
      visited.add(x);
      stack.push(...(parents.get(x) ?? []));
    }
    return false;
  };
  if (d.nodes.some((n) => cyclic(n.id))) errors.push('Обобщение (наследование) образует цикл');

  /* несвязанные элементы */
  const linked = new Set(d.edges.flatMap((e) => [e.from, e.to]));
  for (const n of real) {
    if (!linked.has(n.id) && n.name.trim()) warnings.push(`${DIAGRAM_SPEC[d.kind as DiagramKind].nodes[n.type]} ${label(n)} ни с чем не связан`);
  }
  if (d.kind === 'class') {
    for (const n of real) if (n.name && n.name[0] !== n.name[0]!.toUpperCase()) warnings.push(`Имя класса ${label(n)} принято писать с заглавной буквы`);
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
};

/* ключи для сравнения: тип + нормализованное имя; ассоциация без направления */
const keys = (d: Diagram) => {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const nodeKeys = d.nodes.filter((n) => n.type !== 'boundary' && n.name.trim()).map((n) => ({ type: n.type, key: `${n.type}:${norm(n.name)}` }));
  const edgeKeys = d.edges
    .map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return null;
      const [x, y] = [norm(a.name), norm(b.name)];
      const undirected = e.type === 'association';
      return { type: e.type, key: `${e.type}:${undirected ? [x, y].sort().join('|') : `${x}>${y}`}` };
    })
    .filter((x): x is { type: string; key: string } => !!x);
  return { nodeKeys, edgeKeys };
};

export const checkDiagram = (d: Diagram, reference: Diagram | null): DiagramCheck => {
  const { errors, warnings } = rules(d);
  if (!reference) return { errors, warnings, score: null, summary: [] };
  const spec = DIAGRAM_SPEC[d.kind as DiagramKind];
  const mine = keys(d);
  const ref = keys(reference);
  const summary: string[] = [];
  let hit = 0;
  let total = 0;
  const count = (list: { type: string; key: string }[], refList: { type: string; key: string }[], names: Record<string, string>) => {
    const have = new Set(list.map((x) => x.key));
    for (const type of Object.keys(names)) {
      const need = refList.filter((x) => x.type === type);
      if (!need.length) continue;
      const found = need.filter((x) => have.has(x.key)).length;
      hit += found;
      total += need.length;
      summary.push(`${names[type]}: найдено ${found} из ${need.length}`);
    }
    const refSet = new Set(refList.map((x) => x.key));
    const extra = list.filter((x) => !refSet.has(x.key)).length;
    return extra;
  };
  const extraNodes = count(mine.nodeKeys, ref.nodeKeys, spec.nodes);
  const extraEdges = count(mine.edgeKeys, ref.edgeKeys, spec.edges);
  if (extraNodes + extraEdges > 0) summary.push(`Элементов и связей, которых нет в эталоне: ${extraNodes + extraEdges} (проверьте названия)`);
  /* ошибки нотации снижают результат */
  const raw = total ? (hit / total) * 100 : 0;
  const score = Math.max(0, Math.round(raw - errors.length * 5 - Math.max(0, extraNodes + extraEdges - 2) * 2));
  return { errors, warnings, score, summary };
};
