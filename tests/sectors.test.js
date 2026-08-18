import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SECTORS, inPolygon, sectorOf } from '../src/lib/sectors.js';

const stations = new Map(
  JSON.parse(readFileSync(new URL('../docs/metro.json', import.meta.url), 'utf8'))
    .stations.map((s) => [s.name, s])
);

/** Станции, названные Димой внутри сектора (не в вершине границы). */
const ANCHORS = [
  ['Полянка', 1], ['Третьяковская', 1],
  ['Серпуховская', 2],
  ['Технопарк', 3], ['ЗИЛ', 3], ['Автозаводская', 3],
  ['Волгоградский проспект', 4], ['Дубровка', 4],
  ['Бауманская', 5],
  ['Бутырская', 7],
  ['Тимирязевская', 8],
  ['Краснопресненская', 10],
  ['Маяковская', 11], ['Новослободская', 11],
  ['Смоленская', 12], ['Кутузовская', 12], ['Парк Победы', 12],
  ['Фрунзенская', 13], ['Спортивная', 13],
];

test('станции, названные Димой, попадают в его же сектор', () => {
  for (const [name, expected] of ANCHORS) {
    const st = stations.get(name);
    assert.ok(st, `в metro.json нет станции «${name}»`);
    const got = sectorOf(st.lat, st.lon);
    assert.equal(got?.id, expected, `«${name}» ожидался в секторе ${expected}, получен ${got?.id ?? '—'}`);
  }
});

test('секторы почти не пересекаются: объект не может ехать к двум менеджерам', () => {
  // Границы нарисованы со слов, поэтому идеального нуля не требуем: допуск —
  // тонкая кромка вдоль общих рёбер. Если пересечение разрослось, значит
  // полигон уехал, и объект попадёт в два маршрута сразу.
  let both = 0, covered = 0;
  for (let lat = 55.68; lat <= 55.90; lat += 0.001) {
    for (let lon = 37.45; lon <= 37.75; lon += 0.0018) {
      const hits = SECTORS.filter((s) => inPolygon(lat, lon, s.polygon)).length;
      if (hits) covered++;
      if (hits > 1) both++;
    }
  }
  assert.ok(covered > 5000, `секторы схлопнулись: покрыто всего ${covered} ячеек`);
  assert.ok(both / covered < 0.005, `пересечений ${both} на ${covered} ячеек — больше 0.5 %`);
});

test('точка вне нарезки — законный ответ, а не исключение', () => {
  // Секторы Димы покрывают не всю Москву. Бутово — не ошибка данных.
  assert.equal(sectorOf(55.5400, 37.5400), null);
  assert.equal(sectorOf(null, 37.6), null);
  assert.equal(sectorOf(Number.NaN, Number.NaN), null);
});

test('у каждого сектора есть дословные слова Димы и замкнутый полигон', () => {
  assert.equal(SECTORS.length, 14);
  const ids = SECTORS.map((s) => s.id);
  assert.deepEqual(ids, [...new Set(ids)], 'номера секторов дублируются');
  for (const s of SECTORS) {
    assert.ok(s.words.length > 5, `сектор ${s.id}: нет описания Димы`);
    assert.ok(s.polygon.length >= 3, `сектор ${s.id}: полигон вырожден`);
    for (const [lat, lon] of s.polygon) {
      assert.ok(lat > 55.3 && lat < 56.1, `сектор ${s.id}: широта ${lat} вне Москвы`);
      assert.ok(lon > 36.8 && lon < 38.0, `сектор ${s.id}: долгота ${lon} вне Москвы`);
    }
  }
});
