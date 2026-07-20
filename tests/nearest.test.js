import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIndex, distanceMeters, findNearest } from '../src/lib/nearest.js';

// Опорная точка — Пресненская наб., район Сити.
const LAT = 55.7473;
const LON = 37.5377;

test('расстояние считается с поправкой на широту', () => {
  // Тысячная доля градуса широты — примерно 111 м.
  const north = distanceMeters(LAT, LON, LAT + 0.001, LON);
  assert.ok(north > 105 && north < 118, `по широте вышло ${north}`);

  // Столько же по долготе на широте Москвы — примерно вдвое короче.
  // Без cos(lat) обе величины совпали бы, и ошибка была бы двукратной.
  const east = distanceMeters(LAT, LON, LAT, LON + 0.001);
  assert.ok(east > 55 && east < 68, `по долготе вышло ${east}`);
  assert.ok(east < north * 0.7, 'долгота обязана быть короче широты');
});

test('находит ближайшее здание', () => {
  const grid = buildIndex([
    { unom: 1, address: 'дальнее', lat: LAT + 0.01, lon: LON },
    { unom: 2, address: 'ближнее', lat: LAT + 0.0002, lon: LON },
  ]);
  const hit = findNearest(grid, LAT, LON, 100);
  assert.equal(hit.item.address, 'ближнее');
  assert.ok(hit.distance < 30);
});

test('за порогом не возвращает ничего — чужой адрес хуже пустого', () => {
  // Единственное здание в двух километрах. Без порога оно стало бы
  // «ближайшим» и точка получила бы адрес соседнего района.
  const grid = buildIndex([{ unom: 1, address: 'за два км', lat: LAT + 0.02, lon: LON }]);
  assert.equal(findNearest(grid, LAT, LON, 100), null);
});

test('объект у границы ячейки не теряется', () => {
  // Сетка нарезана по 0.002 градуса. Точка и здание могут оказаться
  // в соседних ячейках, находясь в паре метров друг от друга — поэтому
  // просматриваем девять ячеек, а не одну.
  const edge = Math.round(LAT / 0.002) * 0.002;
  const grid = buildIndex([{ unom: 1, address: 'через границу', lat: edge - 0.00005, lon: LON }]);
  const hit = findNearest(grid, edge + 0.00005, LON, 100);
  assert.ok(hit !== null, 'здание за границей ячейки обязано найтись');
});

test('пустой индекс не ломается', () => {
  assert.equal(findNearest(buildIndex([]), LAT, LON, 100), null);
});
