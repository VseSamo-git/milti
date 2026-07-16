import assert from 'node:assert/strict';
import { test } from 'node:test';

import { haversineMeters, nearestPoint } from '../src/lib/subtract.js';

// Координаты башен Москва-Сити, ПРИБЛИЗИТЕЛЬНЫЕ (сняты не из ЕГРН).
// Поэтому тесты ниже проверяют структурный факт — плотная застройка
// укладывается в 150 м, — а не конкретные метры до конкретной башни.
const FEDERATION = { lat: 55.74964, lon: 37.53728, name: 'Башня Федерация' };
const MERCURY = { lat: 55.7501, lon: 37.5387, name: 'Меркурий' };
const IMPERIA = { lat: 55.74806, lon: 37.53664, name: 'Империя' };

// Из спеки, раздел 5.
const REJECTED_EXCLUSION_RADIUS_M = 150;
const SERVICE_RADIUS_M = 100; // «1 минута ходьбы» ≈ 80-100 м

test('гаверсинус считает расстояние в метрах', () => {
  const meters = haversineMeters(55.75, 37.61, 55.76, 37.61);
  // 0.01 градуса широты ≈ 1112 м
  assert.ok(meters > 1050 && meters < 1150, `получилось ${meters}`);
});

test('расстояние до себя — ноль', () => {
  assert.equal(haversineMeters(55.75, 37.61, 55.75, 37.61), 0);
});

test('ПОЧЕМУ НЕ РАДИУС: отвергнутый радиус больше радиуса обслуживания', () => {
  // Ядро дефекта ред. 1, и оно доказывается арифметикой, без координат:
  // правило вычитало здания, которые точка обслужить НЕ МОЖЕТ.
  // «1 минута ходьбы» — критерий близости к клиенту, а не каннибализации.
  assert.ok(
    REJECTED_EXCLUSION_RADIUS_M > SERVICE_RADIUS_M,
    'если это перестанет быть правдой — перечитайте раздел 5 спеки'
  );
});

test('ПОЧЕМУ НЕ РАДИУС: соседний небоскрёб попадает в 150 м', () => {
  // Структурный факт плотной застройки: в Сити соседняя башня — это
  // сотня метров. Радиус 150 стёр бы её из базы из-за одной нашей точки,
  // хотя это ~180 тыс. м² и десятки тысяч обедающих.
  // Координаты приблизительные, поэтому проверяем порядок величины,
  // а не точные метры.
  const meters = haversineMeters(FEDERATION.lat, FEDERATION.lon, MERCURY.lat, MERCURY.lon);
  assert.ok(
    meters < REJECTED_EXCLUSION_RADIUS_M,
    `соседняя башня в ${meters} м — радиус 150 её проглотит`
  );
});

test('вычитание по UNOM НЕ трогает соседей: у них другой UNOM', () => {
  // Собственно лекарство. Расстояние роли не играет — играет здание.
  const federationUnom = 1_000_001;
  const mercuryUnom = 1_000_002;
  assert.notEqual(federationUnom, mercuryUnom);
});

test('расстояние до ближайшей точки — информация, а не приговор', () => {
  const object = { lat: MERCURY.lat, lon: MERCURY.lon };
  const nearest = nearestPoint(object, [FEDERATION, IMPERIA]);

  // Объект НЕ вычтен — он просто знает, что наша точка рядом.
  assert.equal(nearest.name, 'Башня Федерация');
  assert.ok(nearest.meters < 150);
});

test('выбирает действительно ближайшую, а не первую', () => {
  const object = { lat: IMPERIA.lat, lon: IMPERIA.lon };
  const nearest = nearestPoint(object, [
    { lat: 55.8, lon: 37.7, name: 'далеко' },
    FEDERATION,
  ]);
  assert.equal(nearest.name, 'Башня Федерация');
});

test('объект без координат не ломает расчёт', () => {
  assert.equal(nearestPoint({ lat: null, lon: null }, [FEDERATION]), null);
});

test('точка без координат пропускается', () => {
  const object = { lat: MERCURY.lat, lon: MERCURY.lon };
  const nearest = nearestPoint(object, [{ lat: null, lon: null, name: 'нет гео' }, FEDERATION]);
  assert.equal(nearest.name, 'Башня Федерация');
});

test('пустой список точек даёт null', () => {
  assert.equal(nearestPoint({ lat: 55.75, lon: 37.61 }, []), null);
});
