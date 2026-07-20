import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ATTRIBUTION, buildUnomMap } from '../src/sources/addr_registry.js';

// Настоящая строка data.mos.ru, снятая 2026-07-20 с флагом fetchGeodata.
// Структура KAD_N неочевидна: массив ОБЪЕКТОВ, а не строк.
// geodata_center — точка [lon, lat] в порядке GeoJSON.
const REAL_ROW = {
  global_id: 645622141,
  is_deleted: 0,
  OBJ_TYPE: 'Здание',
  ADDRESS: 'Российская Федерация, город Москва, Косинская улица, дом 26А',
  UNOM: 2102436.0,
  KAD_N: [{ global_id: 6902142, is_deleted: 0, KAD_N: '77:03:0007004:1064' }],
  KAD_ZU: [{ global_id: 3304080, is_deleted: 0, KAD_ZU: '77:03:0007004:6443' }],
  geodata_center: { type: 'Point', coordinates: [37.828189394, 55.717482785] },
};

test('строит отображение кадастровый номер -> запись с UNOM', () => {
  const map = buildUnomMap([REAL_ROW]);
  assert.equal(map.get('77:03:0007004:1064').unom, 2102436);
});

test('UNOM приходит как float — приводим к целому', () => {
  const map = buildUnomMap([REAL_ROW]);
  assert.equal(Number.isInteger(map.get('77:03:0007004:1064').unom), true);
});

test('извлекает координаты из geodata_center', () => {
  const map = buildUnomMap([REAL_ROW]);
  const rec = map.get('77:03:0007004:1064');
  assert.equal(rec.lat, 55.717482785);
  assert.equal(rec.lon, 37.828189394);
});

test('координаты GeoJSON идут как [lon, lat] — не путаем местами', () => {
  // Москва: широта ~55, долгота ~37. Если перепутать — здание улетает
  // в Индийский океан. Явный страж на порядок осей.
  const map = buildUnomMap([REAL_ROW]);
  const rec = map.get('77:03:0007004:1064');
  assert.ok(rec.lat > 54 && rec.lat < 57, `lat ${rec.lat} вне широт Москвы`);
  assert.ok(rec.lon > 36 && rec.lon < 39, `lon ${rec.lon} вне долгот Москвы`);
});

test('строка без координат: unom есть, lat/lon = null (не выдумываем)', () => {
  const { geodata_center, ...noGeo } = REAL_ROW;
  const rec = buildUnomMap([noGeo]).get('77:03:0007004:1064');
  assert.equal(rec.unom, 2102436);
  assert.equal(rec.lat, null);
  assert.equal(rec.lon, null);
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
  assert.equal(map.get('77:03:0007004:1064').unom, 2102436);
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
  assert.equal(map.get('77:03:0007004:1064').unom, 2102436);
  assert.equal(map.get('77:03:0007004:1065').unom, 2102436);
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
