import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { PLACE_STATUSES_KEPT_ON_REIMPORT } from '../src/lib/registry.js';

const source = readFileSync(new URL('../src/lib/registry.js', import.meta.url), 'utf8');

test('повторный импорт не воскрешает вычтенное', () => {
  // Живой баг 18.08.2026, проверен контрольной строкой на базе: upsert мест
  // ставил status = 'активна' безусловно, и следующий импорт OSM вернул бы
  // в «Базу» 532 строки — 284 колледжа, удалённых Димой, 20 мест, где МИЛТИ
  // уже работает или закрылся, и 34 дубля. Менеджеры поехали бы по адресам,
  // которые человек уже вычеркнул.
  for (const status of ['вычтен_наша_точка', 'вычтен_закрытая_точка', 'вычтен_решением_димы', 'дубль_в_базе']) {
    assert.ok(
      PLACE_STATUSES_KEPT_ON_REIMPORT.includes(status),
      `статус «${status}» — решение человека или сверки, импорт не вправе его снимать`
    );
  }
});

test('кандидат на закрытие оживает, когда место снова увидели', () => {
  // Единственный статус, который повторная встреча законно снимает.
  assert.ok(!PLACE_STATUSES_KEPT_ON_REIMPORT.includes('кандидат_на_закрытие'));
});

test('в SQL апсерта нет безусловного возврата в активные', () => {
  // Регресс-сторож на текст запроса: баг жил именно в строке SQL, где его
  // не видит ни один юнит-тест на функциях.
  const from = source.indexOf('ON CONFLICT (place_key)');
  const upsert = source.slice(from, source.indexOf('`', from));   // только сам запрос, до конца шаблона
  assert.ok(!/status\s*=\s*'активна'\s*$/m.test(upsert), 'status возвращается в активные безусловно');
  assert.match(upsert, /CASE WHEN places\.status = 'кандидат_на_закрытие'/);
});
