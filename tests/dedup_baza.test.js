import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDuplicates, pickWinner } from '../scripts/dedup_baza.js';

const row = (key, name, address, extra = {}) => ({ key, name, address, area: null, ...extra });

test('дубль объявляется только при совпадении названия И адреса', () => {
  const groups = groupDuplicates([
    row('77:01:1', 'БЦ Оружейный', 'переулок Оружейный, дом 41'),
    row('ext:a', 'Бизнес-центр «Оружейный»', 'Оружейный пер., д. 41'),
    row('77:01:2', 'БЦ Мосавто', 'переулок Оружейный, дом 41'),   // тот же адрес, другое здание
    row('77:01:3', 'БЦ Оружейный', 'улица Тверская, дом 41'),      // то же имя, другой адрес
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0][1].map((r) => r.key).sort(), ['77:01:1', 'ext:a']);
});

test('строки без названия в дубли не сводятся', () => {
  const groups = groupDuplicates([
    row('77:01:1', '(без названия)', 'переулок Оружейный, дом 41'),
    row('77:01:2', '(без названия)', 'Оружейный пер., д. 41'),
  ]);
  assert.equal(groups.length, 0);
});

test('побеждает реестр, а не внешний каталог', () => {
  const win = pickWinner([
    row('ext:a', 'БЦ Оружейный', 'Оружейный пер., 41', { external: true, area: 999999 }),
    row('77:01:1', 'БЦ Оружейный', 'Оружейный пер., 41', { external: false, area: 100 }),
  ]);
  assert.equal(win.key, '77:01:1');
});

test('при равном происхождении побеждает большая площадь', () => {
  const win = pickWinner([
    row('77:01:1', 'X', 'ул. А, 1', { external: false, area: 10000 }),
    row('77:01:2', 'X', 'ул. А, 1', { external: false, area: 50000 }),
  ]);
  assert.equal(win.key, '77:01:2');
});

test('выбор победителя детерминирован при полном равенстве', () => {
  const rows = [
    row('77:01:9', 'X', 'ул. А, 1', { external: false, area: 100 }),
    row('77:01:2', 'X', 'ул. А, 1', { external: false, area: 100 }),
  ];
  assert.equal(pickWinner(rows).key, pickWinner([...rows].reverse()).key);
});
