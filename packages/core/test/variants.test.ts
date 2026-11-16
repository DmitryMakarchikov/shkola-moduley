/* индивидуальные варианты тестов: свой набор, порядок и проверка именно выданного варианта */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctFor, gradeTest, studentView, variantOf } from '../src/grading.ts';
import type { Question, Test } from '../src/model.ts';

const q = (n: number): Question => ({ id: `q${n}`, type: 'single', text: `Вопрос ${n}`, options: ['верно', 'нет', 'не знаю', 'иногда'], answer: [0], pairs: [], explain: '', points: 1 });
const bank: Test = {
  id: 't1',
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  deletedBy: null,
  moduleId: 'm',
  title: 'Банк',
  position: 1,
  settings: { timeLimitMin: 0, attempts: 0, shuffle: true, passPercent: 60, mode: 'self', pick: 5 },
  questions: Array.from({ length: 12 }, (_, i) => q(i + 1)),
};

test('из банка в 12 заданий учащийся получает 5, набор повторяем для одной попытки', () => {
  const a = variantOf(bank, 'ivan:t1:0');
  const b = variantOf(bank, 'ivan:t1:0');
  assert.equal(a.questions.length, 5);
  assert.deepEqual(a.questions.map((x) => x.id), b.questions.map((x) => x.id));
  assert.deepEqual(a.optionOrder, b.optionOrder);
});

test('у разных учащихся и в разных попытках варианты различаются', () => {
  const sets = ['ivan:t1:0', 'anna:t1:0', 'oleg:t1:0', 'ivan:t1:1', 'vera:t1:0', 'petr:t1:0'].map((s) => variantOf(bank, s).questions.map((x) => x.id).join(','));
  assert.ok(new Set(sets).size >= 5, `ожидались разные наборы, получено: ${sets.join(' | ')}`);
});

test('правильные ответы в перемешанных вариантах дают 100 %, чужой вариант — нет', () => {
  const seed = 'ivan:t1:0';
  const view = studentView(bank, seed);
  const answers: Record<string, unknown> = {};
  for (const item of view.questions) answers[item.id] = item.options.indexOf('верно');
  assert.equal(gradeTest(bank, answers, seed).percent, 100);
  assert.equal(gradeTest(bank, answers, seed).maxScore, 5);
  /* те же ответы для другого учащегося не подходят: у него другие задания и порядок */
  assert.ok(gradeTest(bank, answers, 'anna:t1:0').percent < 100);
  /* представление не раскрывает правильный ответ */
  assert.ok(view.questions.every((item) => !('answer' in item) && !('explain' in item)));
});

test('разбор показывает правильный ответ в порядке учащегося', () => {
  const seed = 'ivan:t1:0';
  const v = variantOf(bank, seed);
  const view = studentView(bank, seed);
  for (const item of view.questions) {
    const original = bank.questions.find((x) => x.id === item.id)!;
    assert.equal(item.options[Number(correctFor(original, v)[0])], 'верно');
  }
});

test('без перемешивания и без банка порядок исходный', () => {
  const plain: Test = { ...bank, settings: { ...bank.settings, shuffle: false, pick: 0 } };
  const view = studentView(plain, 'x');
  assert.deepEqual(view.questions.map((x) => x.id), plain.questions.map((x) => x.id));
  assert.deepEqual(view.questions[0]!.options, plain.questions[0]!.options);
});
