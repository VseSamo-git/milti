import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCoords, num, select, text } from '../src/lib/nocodb.js';

test('formatCoords НЕ выдумывает координаты из пустоты', () => {
  // Главные грабли: Number(null) === 0, и наивная реализация отправляла
  // точки без координат в Атлантику по адресу «0.000000, 0.000000».
  // 153 точки French Bakery уехали туда на живой витрине.
  assert.equal(formatCoords(null, null), null);
  assert.equal(formatCoords(undefined, undefined), null);
  assert.equal(formatCoords(null, 37.6), null);
  assert.equal(formatCoords(55.7, null), null);
  assert.equal(formatCoords('', ''), null);
});

test('formatCoords форматирует настоящие координаты', () => {
  assert.equal(formatCoords(55.806550, 37.504708), '55.806550, 37.504708');
  // Строки из драйвера базы — тоже координаты.
  assert.equal(formatCoords('55.7', '37.6'), '55.700000, 37.600000');
});

test('formatCoords отвергает нечисловое, а не печатает NaN', () => {
  assert.equal(formatCoords('нет', 'нет'), null);
  assert.equal(formatCoords(Number.NaN, 37.6), null);
  assert.equal(formatCoords(Infinity, 37.6), null);
});

test('нулевые координаты — законное значение, а не признак пустоты', () => {
  // 0,0 в Атлантике мы не выдумываем, но если координата пришла нулём
  // осознанно — это число, и оно должно пройти. Отличие от null принципиально.
  assert.equal(formatCoords(0, 0), '0.000000, 0.000000');
});

test('опции SingleSelect уходят в dtxp — формат, проверенный на живом API', () => {
  const col = select('Статус', ['активна', 'закрыта']);
  assert.equal(col.uidt, 'SingleSelect');
  assert.equal(col.dtxp, "'активна','закрыта'");
});

test('текстовые и числовые колонки объявлены типами NocoDB', () => {
  assert.deepEqual(text('Адрес'), { title: 'Адрес', uidt: 'SingleLineText' });
  // Площадь должна быть числом, иначе витрина сортирует «10000» < «900».
  assert.deepEqual(num('Общая площадь, м²'), { title: 'Общая площадь, м²', uidt: 'Number' });
});
