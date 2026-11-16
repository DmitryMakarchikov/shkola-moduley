/* проверка диаграмм: правила нотации и сравнение с эталоном */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDiagram, parseDiagram, type Diagram } from '../src/diagram.ts';

const ref: Diagram = {
  kind: 'usecase',
  nodes: [
    { id: 'a', type: 'actor', name: 'Читатель', x: 0, y: 0 },
    { id: 'u1', type: 'usecase', name: 'Найти книгу', x: 0, y: 0 },
    { id: 'u2', type: 'usecase', name: 'Войти в систему', x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', type: 'association', from: 'a', to: 'u1' },
    { id: 'e2', type: 'include', from: 'u1', to: 'u2' },
  ],
};

test('полное совпадение с эталоном даёт 100 % без ошибок', () => {
  const mine = parseDiagram({ nodes: ref.nodes.map((n) => ({ ...n, id: `x${n.id}`, name: n.name.toUpperCase() })), edges: ref.edges.map((e) => ({ ...e, from: `x${e.from}`, to: `x${e.to}` })) }, 'usecase');
  const r = checkDiagram(mine, ref);
  assert.equal(r.errors.length, 0);
  assert.equal(r.score, 100);
});

test('ошибки нотации находятся без эталона', () => {
  const d = parseDiagram(
    {
      nodes: [
        { id: 'a', type: 'actor', name: 'Читатель', x: 0, y: 0 },
        { id: 'b', type: 'actor', name: 'Гость', x: 0, y: 0 },
        { id: 'u', type: 'usecase', name: 'Найти книгу', x: 0, y: 0 },
      ],
      edges: [
        { id: '1', type: 'association', from: 'a', to: 'b' },
        { id: '2', type: 'include', from: 'a', to: 'u' },
      ],
    },
    'usecase',
  );
  const r = checkDiagram(d, null);
  assert.equal(r.score, null);
  assert.ok(r.errors.some((x) => x.includes('ассоциация соединяет актёра и прецедент')));
  assert.ok(r.errors.some((x) => x.includes('только между прецедентами')));
});

test('частичное совпадение и сводка без раскрытия имён', () => {
  const d = parseDiagram({ nodes: [ref.nodes[0], ref.nodes[1]], edges: [ref.edges[0]] }, 'usecase');
  const r = checkDiagram(d, ref);
  assert.ok(r.score! > 40 && r.score! < 100);
  assert.ok(r.summary.some((x) => x.startsWith('Прецедент: найдено 1 из 2')));
  assert.ok(r.summary.every((x) => !x.includes('Войти')));
});

test('неизвестные элементы и битые связи отклоняются', () => {
  assert.throws(() => parseDiagram({ nodes: [{ id: 'a', type: 'robot', name: 'x' }], edges: [] }, 'usecase'));
  assert.throws(() => parseDiagram({ nodes: [], edges: [{ id: 'e', type: 'association', from: 'a', to: 'b' }] }, 'usecase'));
});
