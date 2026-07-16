import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AREA_THRESHOLD,
  Confidence,
  Destination,
  GREY_ZONE_FLOOR,
  route,
  sourcesDisagreeAtThreshold,
} from '../src/lib/filters.js';

const exact = (sqm) => ({ sqm, confidence: Confidence.EXACT });
const estimate = (sqm) => ({ sqm, confidence: Confidence.ESTIMATE });

test('точная площадь выше порога — в основной вид', () => {
  assert.equal(route(exact(15000)), Destination.MAIN);
});

test('точная площадь ниже порога — никуда, а не «на проверку»', () => {
  // Порог заявлен источником: сомневаться не в чем.
  assert.equal(route(exact(9500)), Destination.NONE);
});

test('порог включающий', () => {
  assert.equal(route(exact(AREA_THRESHOLD)), Destination.MAIN);
});

test('оценка выше порога — в основной вид', () => {
  assert.equal(route(estimate(12000)), Destination.MAIN);
});

test('оценка в серой зоне — на проверку', () => {
  assert.equal(route(estimate(8500)), Destination.REVIEW);
});

test('нижняя граница серой зоны включающая', () => {
  assert.equal(route(estimate(GREY_ZONE_FLOOR)), Destination.REVIEW);
});

test('оценка ниже серой зоны — никуда', () => {
  assert.equal(route(estimate(7000)), Destination.NONE);
});

test('неизвестная площадь — никуда: в реестре есть, в витрину не идёт', () => {
  assert.equal(route({ sqm: null, confidence: Confidence.UNKNOWN }), Destination.NONE);
});

test('null площадь не проходит даже с меткой «точно»', () => {
  assert.equal(route({ sqm: null, confidence: Confidence.EXACT }), Destination.NONE);
});

test('серая зона НЕ применяется к точным площадям', () => {
  // Регрессия: ред. 1 отправляла сюда всё подряд, и лист «НА ПРОВЕРКУ»
  // забился бы заведомо мелкими зданиями.
  assert.equal(route(exact(8500)), Destination.NONE);
  assert.equal(route(estimate(8500)), Destination.REVIEW);
});

test('расхождение источников через порог — повод для проверки', () => {
  // ЕГРН меряет здание (26 000), каталог меряет комплекс (356 994).
  assert.equal(sourcesDisagreeAtThreshold(9500, 12000), true);
  assert.equal(sourcesDisagreeAtThreshold(12000, 9500), true);
});

test('согласные источники — не повод', () => {
  assert.equal(sourcesDisagreeAtThreshold(15000, 20000), false);
  assert.equal(sourcesDisagreeAtThreshold(5000, 7000), false);
});

test('отсутствие второго источника — не расхождение', () => {
  assert.equal(sourcesDisagreeAtThreshold(15000, null), false);
  assert.equal(sourcesDisagreeAtThreshold(null, 15000), false);
});
