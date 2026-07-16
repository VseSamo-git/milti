import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ATTRIBUTION, buildUnomMap } from '../src/sources/addr_registry.js';

// Настоящая строка data.mos.ru, снятая 2026-07-16. Структура KAD_N
// неочевидна: массив ОБЪЕКТОВ, а не строк.
const REAL_ROW = {
  global_id: 645622141,
  is_deleted: 0,
  OBJ_TYPE: 'Здание',
  ADDRESS: 'Российская Федерация, город Москва, Косинская улица, дом 26А',
  UNOM: 2102436.0,
  KAD_N: [{ global_id: 6902142, is_deleted: 0, KAD_N: '77:03:0007004:1064' }],
  KAD_ZU: [{ global_id: 3304080, is_deleted: 0, KAD_ZU: '77:03:0007004:6443' }],
};

test('строит отображение кадастровый номер -> UNOM', () => {
  const map = buildUnomMap([REAL_ROW]);
  assert.equal(map.get('77:03:0007004:1064'), 2102436);
});

test('UNOM приходит как float — приводим к целому', () => {
  const map = buildUnomMap([REAL_ROW]);
  assert.equal(Number.isInteger(map.get('77:03:0007004:1064')), true);
});

test('игнорирует кадастровый номер земельного участка', () => {
  // KAD_ZU — участок, а не здание. Его UNOM нам не нужен.
  const map = buildUnomMap([REAL_ROW]);
  assert.equal(map.has('77:03:0007004:6443'), false);
});

test('игнорирует удалённые записи', () => {
  const deleted = { ...REAL_ROW, is_deleted: 1 };
  assert.equal(buildUnomMap([deleted]).size, 0);
});

test('игнорирует удалённые кадастровые номера внутри живой записи', () => {
  const row = {
    ...REAL_ROW,
    KAD_N: [
      { is_deleted: 1, KAD_N: '77:03:0007004:0001' },
      { is_deleted: 0, KAD_N: '77:03:0007004:1064' },
    ],
  };
  const map = buildUnomMap([row]);
  assert.equal(map.has('77:03:0007004:0001'), false);
  assert.equal(map.get('77:03:0007004:1064'), 2102436);
});

test('у одного здания может быть несколько кадастровых номеров', () => {
  const row = {
    ...REAL_ROW,
    KAD_N: [
      { is_deleted: 0, KAD_N: '77:03:0007004:1064' },
      { is_deleted: 0, KAD_N: '77:03:0007004:1065' },
    ],
  };
  const map = buildUnomMap([row]);
  assert.equal(map.get('77:03:0007004:1064'), 2102436);
  assert.equal(map.get('77:03:0007004:1065'), 2102436);
});

test('строка без кадастровых номеров не ломает разбор', () => {
  assert.equal(buildUnomMap([{ is_deleted: 0, UNOM: 123, KAD_N: [] }]).size, 0);
  assert.equal(buildUnomMap([{ is_deleted: 0, UNOM: 123 }]).size, 0);
});

test('строка без UNOM пропускается', () => {
  const row = { ...REAL_ROW, UNOM: null };
  assert.equal(buildUnomMap([row]).size, 0);
});

test('атрибуция CC BY 4.0 не потеряна: лицензия её требует', () => {
  assert.match(ATTRIBUTION, /data\.mos\.ru/);
  assert.match(ATTRIBUTION, /CC BY 4\.0/);
});
