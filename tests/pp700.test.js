import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCadastrals, EXPECTED_MIN, EXPECTED_MAX } from '../src/sources/pp700.js';

test('находит кадастровые номера в склеенном тексте', () => {
  const text = 'что-то 50:09:0000000:179835 ещё 77:01:0001075:2898 конец';
  assert.deepEqual(parseCadastrals(text), ['50:09:0000000:179835', '77:01:0001075:2898']);
});

test('срастает номера, разорванные кернингом', () => {
  // Так номер лежит в PDF: (50:09) (:0000) (000:1) (79835).
  // После склейки литералов он обязан собраться обратно.
  const joined = ['50:09', ':0000', '000:1', '79835'].join('');
  assert.deepEqual(parseCadastrals(joined), ['50:09:0000000:179835']);
});

test('не дублирует номера', () => {
  const text = '77:01:0001075:2898 и снова 77:01:0001075:2898';
  assert.equal(parseCadastrals(text).length, 1);
});

test('принимает кадастровый округ 50: это Зеленоград и ТиНАО, а не «не Москва»', () => {
  assert.deepEqual(parseCadastrals('50:20:0000000:16409'), ['50:20:0000000:16409']);
});

test('не ловит мусор, похожий на номер', () => {
  assert.deepEqual(parseCadastrals('дата 19.11.2025 сумма 1:2:3'), []);
});

test('приёмочные границы охватывают факт разведки (42 650)', () => {
  assert.ok(EXPECTED_MIN <= 42650 && 42650 <= EXPECTED_MAX);
});
