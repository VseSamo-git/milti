/**
 * Вычитание точек МИЛТИ из реестра.
 *
 * ==========================================================================
 * ВЫЧИТАЕМ ТОЛЬКО ПО ТОЧНОМУ СОВПАДЕНИЮ UNOM. Прочитайте, почему.
 *
 * Первая редакция дизайна вычитала по радиусу 150 метров. Это была ошибка,
 * найденная разбором, и дефект был не в числе, а в подмене понятия:
 *
 *   «1 минута ходьбы» — критерий БЛИЗОСТИ К КЛИЕНТУ (удобно ли дойти
 *   из офиса). Из него НЕ следует критерий КАННИБАЛИЗАЦИИ (перекрывает
 *   ли существующая точка соседнее здание).
 *
 * Убийственная деталь: радиус исключения (150 м) был БОЛЬШЕ радиуса
 * обслуживания (80-100 м). Правило вычитало здания, которые точка
 * по собственному определению обслужить не может.
 *
 * Численно: одна точка в Башне Федерация вычитала Меркурий (~65 м,
 * ~180 тыс. м²) и Империю (~120 м, ~230 тыс. м²) — 400 тысяч квадратов
 * лидов за одно открытие. И это не только Сити: «Белая площадь»
 * (корпуса А/Б/В), «Метрополис», «Красная Роза», любой БЦ со строениями
 * 1 и 2 попадают друг другу в 150 м.
 *
 * Худшее свойство: ЧЕМ УСПЕШНЕЕ МИЛТИ, ТЕМ МЕНЬШЕ ЛИДОВ ВИДИТ СИСТЕМА.
 * ~500 точек в офисном ядре, каждая рисует круг в 7 гектаров —
 * объединение накрывает ровно ту застройку, где живут цели.
 *
 * Расстояние до ближайшей точки — это КОЛОНКА в рабочем столе,
 * а не причина удаления. Решает Дима, а не радиус.
 * ==========================================================================
 */

/**
 * Расстояние между точками по формуле гаверсинуса, метры.
 * Для ~40 тысяч объектов этого достаточно; PostGIS не нужен.
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/**
 * Вычесть действующие и закрытые точки по совпадению UNOM.
 *
 * @param {import('./registry.js').Registry} registry
 * @returns {Promise<{subtracted: number, unresolved: number}>}
 */
export async function subtractOurPoints(registry) {
  const { sql } = registry;
  let subtracted = 0;

  const targets = [
    ['our_points', 'вычтен_наша_точка'],
    ['closed_points', 'вычтен_закрытая_точка'],
  ];

  for (const [table, status] of targets) {
    const result = await sql`
      UPDATE kosmos.objects o
      SET status = ${status},
          subtract_reason = 'совпадение UNOM ' || o.unom::text
                            || ' с точкой «' || COALESCE(p.name, p.address_raw) || '»'
      FROM kosmos.${sql(table)} p
      WHERE o.unom IS NOT NULL
        AND p.unom IS NOT NULL
        AND p.resolved = true
        AND o.unom = p.unom
        AND o.status = 'активен'
    `;
    subtracted += result.count;
  }

  const [row] = await sql`
    SELECT (
      (SELECT count(*) FROM kosmos.our_points    WHERE resolved = false) +
      (SELECT count(*) FROM kosmos.closed_points WHERE resolved = false)
    )::int AS n
  `;

  return { subtracted, unresolved: row.n };
}

/**
 * Регресс-тест самого правила вычитания.
 *
 * Применяем правило к списку точек МИЛТИ. Если одна существующая точка
 * исключает другую — правило неверно по построению, и запускать сборку
 * нельзя. При ~500 точках такие пары почти наверняка найдутся, если
 * правило слишком широкое.
 *
 * @returns {Promise<Array<[string, string]>>} пары столкнувшихся точек
 */
export async function selfcheck(registry) {
  const rows = await registry.sql`
    SELECT a.address_raw AS a, b.address_raw AS b
    FROM kosmos.our_points a
    JOIN kosmos.our_points b ON a.unom = b.unom AND a.id < b.id
    WHERE a.unom IS NOT NULL AND a.resolved AND b.resolved
  `;
  return rows.map((r) => [r.a, r.b]);
}

/**
 * Проставить расстояние до ближайшей нашей точки.
 *
 * Это ИНФОРМАЦИЯ ДЛЯ ДИМЫ, а не фильтр. Ничего не вычитает.
 *
 * @param {Array<{id: number, lat: number, lon: number}>} objects
 * @param {Array<{name: string, lat: number, lon: number}>} points
 */
export function nearestPoint(object, points) {
  if (object.lat === null || object.lon === null) return null;

  let best = null;
  for (const point of points) {
    if (point.lat === null || point.lon === null) continue;
    const meters = haversineMeters(object.lat, object.lon, point.lat, point.lon);
    if (best === null || meters < best.meters) {
      best = { meters, name: point.name };
    }
  }
  return best;
}
