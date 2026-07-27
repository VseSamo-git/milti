import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseStations, nearestStations } from '../src/lib/metro.js';

// --- parseStations: вытащить станции из ответа Overpass ------------------

test('parseStations: берёт именованные станции метро, отбрасывает входы и безымянные', () => {
  const overpass = {
    elements: [
      { type: 'node', lat: 55.7649, lon: 37.6049, tags: { name: 'Тверская', station: 'subway' } },
      { type: 'way', center: { lat: 55.7420, lon: 37.6560 }, tags: { name: 'Таганская', railway: 'station', station: 'subway' } },
      { type: 'node', lat: 55.7, lon: 37.6, tags: { railway: 'subway_entrance' } }, // вход — не станция
      { type: 'node', lat: 55.8, lon: 37.7, tags: { station: 'subway' } }, // без имени
    ],
  };
  const st = parseStations(overpass);
  assert.deepEqual(st.map((s) => s.name), ['Тверская', 'Таганская']);
  assert.equal(st[1].lat, 55.7420); // координата из center для way
});

test('parseStations: дедуп по имени (у станции несколько узлов/выходов)', () => {
  const overpass = {
    elements: [
      { type: 'node', lat: 55.76, lon: 37.60, tags: { name: 'Арбатская', station: 'subway' } },
      { type: 'node', lat: 55.7601, lon: 37.6002, tags: { name: 'Арбатская', station: 'subway' } },
    ],
  };
  assert.equal(parseStations(overpass).length, 1);
});

// --- nearestStations: ближайшие станции к объекту -----------------------

const stations = [
  { name: 'Тверская', lat: 55.7649, lon: 37.6049 },
  { name: 'Пушкинская', lat: 55.7659, lon: 37.6043 },
  { name: 'Медведково', lat: 55.8874, lon: 37.6628 }, // далеко
];

test('nearestStations: возвращает ближайшие в пределах порога, по возрастанию расстояния', () => {
  // объект у Тверской
  const near = nearestStations(stations, 55.7650, 37.6050, { maxMeters: 1500, limit: 2 });
  assert.deepEqual(near.map((s) => s.name), ['Тверская', 'Пушкинская']);
});

test('nearestStations: далёкие станции отсекаются порогом', () => {
  const near = nearestStations(stations, 55.7650, 37.6050, { maxMeters: 1500, limit: 5 });
  assert.ok(!near.some((s) => s.name === 'Медведково'));
});

test('nearestStations: ничего в пределах порога — пустой список', () => {
  const near = nearestStations(stations, 54.0, 30.0, { maxMeters: 1500, limit: 2 });
  assert.deepEqual(near, []);
});
