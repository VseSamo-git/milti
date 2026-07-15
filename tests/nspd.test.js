import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NspdClient } from '../src/sources/nspd.js';

const CFG = { nspdReferer: 'https://nspd.gov.ru/map?thematic=PKK', nspdRateLimitPerSec: 1 };

// Настоящий ответ НСПД, снятый разведкой 2026-07-16 с 77:01:0001075:1017.
const BUILDING = {
  data: {
    features: [
      {
        properties: {
          categoryName: 'Здания',
          options: {
            cad_num: '77:01:0001075:1017',
            build_record_area: 7198.6,
            floors: '12',
            year_built: '2002',
            purpose: 'Многоквартирный дом',
            readable_address: 'Российская Федерация, город Москва, улица Малая Бронная, дом 44',
          },
        },
      },
    ],
  },
};

// «Сооружения» отдают null в площади — встречено в выборке разведки.
const STRUCTURE = {
  data: { features: [{ properties: { categoryName: 'Сооружения', options: {} } }] },
};

const LAND = {
  data: {
    features: [{ properties: { categoryName: 'Земельные участки', options: { land_record_area: 587 } } }],
  },
};

test('парсит площадь здания', () => {
  const record = new NspdClient(CFG).parse(BUILDING);
  assert.equal(record.areaSqm, 7198.6);
  assert.equal(record.categoryName, 'Здания');
});

test('парсит этажность и год как числа, а не строки', () => {
  const record = new NspdClient(CFG).parse(BUILDING);
  assert.equal(record.floors, 12);
  assert.equal(record.builtYear, 2002);
});

test('берёт канонический адрес из ЕГРН', () => {
  const record = new NspdClient(CFG).parse(BUILDING);
  assert.match(record.readableAddress, /Малая Бронная/);
});

test('игнорирует земельные участки: их площадь — не наша площадь', () => {
  assert.equal(new NspdClient(CFG).parse(LAND), null);
});

test('сооружение без площади даёт null, а не ноль', () => {
  const record = new NspdClient(CFG).parse(STRUCTURE);
  assert.equal(record, null);
});

test('пустая выдача даёт null', () => {
  assert.equal(new NspdClient(CFG).parse({ data: { features: [] } }), null);
});

test('отсутствующая площадь остаётся null, а не превращается в ноль', () => {
  const payload = {
    data: { features: [{ properties: { categoryName: 'Здания', options: {} } }] },
  };
  const record = new NspdClient(CFG).parse(payload);
  assert.equal(record.areaSqm, null);
});
