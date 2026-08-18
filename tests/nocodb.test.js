import assert from 'node:assert/strict';
import test from 'node:test';

import { NocodbClient, formatCoords, num, select, text } from '../src/lib/nocodb.js';

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

test('records останавливается на последней странице, а не просит offset за пределом', async () => {
  // Живой баг 18.08.2026: в листе ровно 500 строк, страница — 100. Полная
  // последняя страница выглядела как «может быть ещё», клиент просил
  // offset=500, и NocoDB отвечал 422 ERR_INVALID_OFFSET_VALUE. Синк решений
  // Димы падал каждую минуту, а вместе с ним — вся пересборка витрины.
  const total = 500, pageSize = 100;
  const asked = [];
  const client = new NocodbClient({ nocodbUrl: 'http://x', nocodbToken: 't', nocodbBase: 'b' });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    asked.push(offset);
    if (offset >= total) {
      return { ok: false, status: 422, text: async () => 'ERR_INVALID_OFFSET_VALUE' };
    }
    const list = Array.from({ length: Math.min(pageSize, total - offset) }, (_, i) => ({ Id: offset + i }));
    return {
      ok: true, status: 200,
      json: async () => ({ list, pageInfo: { totalRows: total, page: offset / pageSize + 1, pageSize, isLastPage: offset + list.length >= total } }),
    };
  };
  try {
    const rows = await client.records('tbl', { fields: ['Ключ'], pageSize });
    assert.equal(rows.length, total);
    assert.deepEqual(asked, [0, 100, 200, 300, 400]);  // шестого запроса быть не должно
  } finally { globalThis.fetch = original; }
});
