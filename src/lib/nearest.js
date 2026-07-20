/**
 * Поиск ближайшего здания к точке.
 *
 * ЗАЧЕМ СЕТКА, а не перебор. Зданий ~500 тысяч, точек ~1500. Полный перебор
 * это 750 миллионов замеров — минуты работы на ровном месте. Сетка режет
 * до девяти ячеек вокруг точки: тысячные доли градуса это ~70-110 м, и в
 * такой ячейке лежат единицы зданий.
 *
 * ПОЧЕМУ НЕ haversine. На расстояниях в сотни метров кривизна Земли не
 * важна, а вот стоимость тригонометрии в цикле — да. Берём плоское
 * приближение с поправкой на широту: на широте Москвы градус долготы
 * примерно вдвое короче градуса широты, и без cos(lat) ошибка была бы
 * двукратной именно по долготе.
 */

const M_PER_DEG_LAT = 111_320;
const CELL = 0.002; // ~220 м по широте: ячейка заведомо крупнее порога поиска

const key = (lat, lon) => `${Math.round(lat / CELL)}:${Math.round(lon / CELL)}`;

/** Метры между двумя точками. Плоское приближение с поправкой на широту. */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = (lat1 - lat2) * M_PER_DEG_LAT;
  const dLon = (lon1 - lon2) * M_PER_DEG_LAT * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Индекс зданий по сетке.
 * @param {{lat: number, lon: number}[]} items
 */
export function buildIndex(items) {
  const grid = new Map();
  for (const item of items) {
    const k = key(item.lat, item.lon);
    const bucket = grid.get(k);
    if (bucket) bucket.push(item);
    else grid.set(k, [item]);
  }
  return grid;
}

/**
 * Ближайший объект к точке или null, если в пределах maxMeters ничего нет.
 *
 * Порог обязателен. Без него «ближайшее здание» найдётся всегда — хоть за
 * два километра, — и мы молча приклеим точке чужой адрес. Пустой адрес
 * честнее выдуманного.
 *
 * @returns {{item: object, distance: number}|null}
 */
export function findNearest(grid, lat, lon, maxMeters = 100) {
  let best = null;
  let bestDistance = Infinity;

  const ci = Math.round(lat / CELL);
  const cj = Math.round(lon / CELL);

  // Девять ячеек: своя и восемь соседних. Объект у самой границы ячейки
  // иначе потерялся бы, хотя лежит в паре метров.
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const bucket = grid.get(`${ci + di}:${cj + dj}`);
      if (!bucket) continue;
      for (const item of bucket) {
        const d = distanceMeters(lat, lon, item.lat, item.lon);
        if (d < bestDistance) {
          bestDistance = d;
          best = item;
        }
      }
    }
  }

  return best !== null && bestDistance <= maxMeters
    ? { item: best, distance: bestDistance }
    : null;
}
