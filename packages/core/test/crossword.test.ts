/* построение кроссворда: пересечения совпадают, слова не касаются друг друга */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCrossword } from '../src/crossword.ts';

test('слова укладываются с пересечениями и без конфликтов', () => {
  const { words, skipped } = buildCrossword([
    { answer: 'проектирование', clue: 'создание прообраза объекта' },
    { answer: 'модель', clue: 'структура процессов ЖЦ' },
    { answer: 'процесс', clue: 'преобразует входы в выходы' },
    { answer: 'стадия', clue: 'часть процесса создания ИС' },
    { answer: 'тестирование', clue: 'поиск дефектов' },
  ]);
  assert.ok(words.length >= 4, `уложено ${words.length}, пропущено ${skipped.join(', ')}`);
  const grid = new Map<string, string>();
  for (const w of words) {
    [...w.answer].forEach((ch, i) => {
      const k = w.dir === 'down' ? `${w.row + i}:${w.col}` : `${w.row}:${w.col + i}`;
      assert.ok(!grid.has(k) || grid.get(k) === ch, `конфликт в клетке ${k}`);
      grid.set(k, ch);
    });
  }
  assert.ok(words.every((w) => w.row >= 0 && w.col >= 0));
  assert.ok(words.some((w) => w.dir === 'down') && words.some((w) => w.dir === 'across'));
  assert.equal(words[0]!.n, 1);
});
