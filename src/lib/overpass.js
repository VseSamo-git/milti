/**
 * Общий клиент Overpass (OpenStreetMap).
 *
 * Единственное место, где мы ходим в OSM. Источники (супермаркеты,
 * конкуренты, ВУЗы) пользуются им и не знают про зеркала и таймауты.
 *
 * ЛИЦЕНЗИЯ: OpenStreetMap, ODbL. Бесплатно, коммерческое использование
 * разрешено при атрибуции. Ключей не требует.
 *
 * ГРАБЛИ, проверенные на живых данных 2026-07-16:
 *   1. Без User-Agent публичный Overpass отдаёт 406.
 *   2. Запрос через area["name"="Москва"] + регэксп по нескольким сетям
 *      даёт 504 — слишком тяжёл. bbox надёжнее.
 *   3. Одна сеть за запрос стабильнее, чем все сразу.
 */

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Границы Москвы. Включают Зеленоград и часть ТиНАО.
export const MOSCOW_BBOX = { south: 55.55, west: 37.35, north: 55.92, east: 37.85 };

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL.';

const UA = 'kosmos-mealty/1.0';

export function bboxString(bbox = MOSCOW_BBOX) {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

/** Экранировать строку для регэкспа Overpass. */
export function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Выполнить запрос к Overpass: перебор зеркал, затем повтор с паузой.
 *
 * 504 от публичного Overpass — это перегрузка, а не отказ: тот же запрос
 * через полминуты обычно проходит. Проверено на живых данных — сбор
 * конкурентов падал на 504 по всем трём зеркалам сразу.
 *
 * @param {string} query — тело запроса Overpass QL
 * @param {{attempts?: number, backoffMs?: number}} opts
 */
export async function runOverpass(query, { attempts = 3, backoffMs = 20000 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
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
          // Overpass при перегрузке отдаёт HTML вместо JSON
          lastError = new Error(`${endpoint}: не JSON (вероятно перегрузка)`);
          continue;
        }

        return JSON.parse(text);
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt < attempts) await sleep(backoffMs * attempt);
  }

  throw lastError || new Error('все зеркала Overpass недоступны');
}

/**
 * Привести элементы Overpass к общему виду с координатами.
 *
 * node отдаёт lat/lon напрямую, way и relation — через center.
 * Элементы без координат пропускаются: точка без места бесполезна.
 *
 * @returns {{name: string|null, lat: number, lon: number, osmId: string,
 *            street: string|null, house: string|null, tags: object}[]}
 */
export function parseElements(payload) {
  const elements = payload?.elements || [];
  const out = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const point = el.center || el;
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;

    out.push({
      name: tags.name || null,
      lat: point.lat,
      lon: point.lon,
      osmId: `${el.type}/${el.id}`,
      street: tags['addr:street'] || null,
      house: tags['addr:housenumber'] || null,
      tags,
    });
  }

  return out;
}
