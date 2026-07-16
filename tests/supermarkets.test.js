import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ATTRIBUTION, PRODUCT_CHAINS, parseOverpass } from '../src/sources/supermarkets.js';

// Настоящий фрагмент ответа Overpass, снятый 2026-07-16.
const NODE = {
  type: 'node',
  id: 1234,
  lat: 55.7164,
  lon: 37.4585,
  tags: { shop: 'supermarket', brand: 'Пятёрочка', 'addr:street': 'Инициативная улица', 'addr:housenumber': '5 к1 с2' },
};

// way/relation отдают геометрию через center, а не lat/lon напрямую.
const WAY = {
  type: 'way',
  id: 5678,
  center: { lat: 55.75, lon: 37.61 },
  tags: { shop: 'supermarket', brand: 'Перекрёсток' },
};

test('разбирает node-супермаркет с координатами', () => {
  const [s] = parseOverpass({ elements: [NODE] });
  assert.equal(s.brand, 'Пятёрочка');
  assert.equal(s.lat, 55.7164);
  assert.equal(s.osmId, 'node/1234');
});

test('берёт координату way из center', () => {
  const [s] = parseOverpass({ elements: [WAY] });
  assert.equal(s.lat, 55.75);
  assert.equal(s.osmId, 'way/5678');
});

test('адрес необязателен: в OSM он есть лишь у ~17%', () => {
  const [s] = parseOverpass({ elements: [WAY] });
  assert.equal(s.street, null);
  // Но координата есть всегда — по ней и определяется здание.
  assert.equal(typeof s.lat, 'number');
});

test('элемент без координат пропускается', () => {
  const noCoord = { type: 'node', id: 9, tags: { brand: 'Магнит' } };
  assert.equal(parseOverpass({ elements: [noCoord] }).length, 0);
});

test('пустой ответ не ломает разбор', () => {
  assert.deepEqual(parseOverpass({ elements: [] }), []);
  assert.deepEqual(parseOverpass({}), []);
});

test('список продуктовых сетей включает Пятёрочку и Перекрёсток', () => {
  assert.ok(PRODUCT_CHAINS.includes('Пятёрочка'));
  assert.ok(PRODUCT_CHAINS.includes('Перекрёсток'));
});

test('атрибуция OSM/ODbL не потеряна', () => {
  assert.match(ATTRIBUTION, /OpenStreetMap/);
  assert.match(ATTRIBUTION, /ODbL/);
});
