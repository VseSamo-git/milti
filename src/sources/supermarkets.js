/**
 * Супермаркеты Москвы из OpenStreetMap — посев для списка ТЦ.
 *
 * Дима просит «список всех торговых центров Москвы, в которых есть
 * продуктовый супермаркет» — потому что прикассовая зона МИЛТИ идёт
 * именно в такой ТЦ.
 *
 * Поэтому посев ОБРАТНЫЙ: не ищем ТЦ и проверяем супермаркет внутри,
 * а находим супермаркеты и смотрим, в каком здании они сидят.
 * Здание крупное и нежилое → это ТЦ с супермаркетом (наша цель).
 * Пятёрочка на первом этаже жилого дома → здание жилое, отсеется само.
 *
 * Проверено на живых данных 2026-07-16: одна сеть (Пятёрочка) — 1233
 * точки в границах Москвы, у всех 100% координаты. Адрес в OSM заполнен
 * лишь у ~17%, поэтому идентификация здания идёт по КООРДИНАТЕ (через
 * НСПД / адресный реестр), а не по строке адреса.
 *
 * ЛИЦЕНЗИЯ: OpenStreetMap, ODbL. Бесплатно, коммерческое использование
 * разрешено при атрибуции.
 *
 * Ключ 2ГИС для этого шага НЕ нужен — посев полностью на OSM.
 */

// Продуктовые сети, чьё присутствие делает ТЦ целью.
// «как правило, это Перекрёстки и Пятёрочки» — плюс остальной продуктовый
// ритейл, дающий тот же трафик 1500+ чеков в день.
export const PRODUCT_CHAINS = [
  'Пятёрочка',
  'Перекрёсток',
  'Магнит',
  'Дикси',
  'Лента',
  'Ашан',
  'ВкусВилл',
  'Азбука Вкуса',
];

// Публичные зеркала Overpass. Первое основное, остальные — на случай 504.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Границы Москвы (bbox). Запрос по area["name"="Москва"] тяжёл для
// публичного Overpass и даёт 504 — проверено. bbox надёжнее.
export const MOSCOW_BBOX = { south: 55.55, west: 37.35, north: 55.92, east: 37.85 };

export const ATTRIBUTION = 'Данные supermarket из OpenStreetMap (© OpenStreetMap contributors, ODbL).';

const UA = 'kosmos-mealty/1.0';

function buildQuery(brands, bbox) {
  const brandRe = brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return (
    '[out:json][timeout:120];' +
    `nwr["shop"="supermarket"]["brand"~"${brandRe}"](${box});` +
    'out tags center 6000;'
  );
}

async function postOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain' },
        body: query,
      });
      if (!response.ok) {
        lastError = new Error(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (!text.includes('"elements"')) {
        lastError = new Error(`${endpoint}: не JSON (вероятно 504)`);
        continue;
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('все зеркала Overpass недоступны');
}

/**
 * Одно наблюдение супермаркета: координата и то, что знает OSM.
 * @typedef {{brand: string, lat: number, lon: number, osmId: string,
 *            street: string|null, house: string|null}} Supermarket
 */

/**
 * Разобрать ответ Overpass в список супермаркетов с координатами.
 * @returns {Supermarket[]}
 */
export function parseOverpass(payload) {
  const elements = payload?.elements || [];
  const out = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const point = el.center || el; // way/relation дают center, node — сам
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;

    out.push({
      brand: tags.brand || tags.name || null,
      lat: point.lat,
      lon: point.lon,
      osmId: `${el.type}/${el.id}`,
      street: tags['addr:street'] || null,
      house: tags['addr:housenumber'] || null,
    });
  }

  return out;
}

/**
 * Забрать все продуктовые супермаркеты Москвы из OSM.
 *
 * По одной сети за запрос: общий регэксп по всем сетям + area даёт 504
 * на публичном Overpass. По одной сети через bbox — стабильно.
 *
 * @param {{brands?: string[], bbox?: object, onProgress?: Function}} opts
 * @returns {Promise<Supermarket[]>}
 */
export async function fetchMoscowSupermarkets({ brands = PRODUCT_CHAINS, bbox = MOSCOW_BBOX, onProgress } = {}) {
  const all = [];
  const seen = new Set();

  for (const brand of brands) {
    const payload = await postOverpass(buildQuery([brand], bbox));
    const items = parseOverpass(payload);
    for (const item of items) {
      if (seen.has(item.osmId)) continue;
      seen.add(item.osmId);
      all.push(item);
    }
    if (onProgress) onProgress(brand, items.length, all.length);
  }

  return all;
}
