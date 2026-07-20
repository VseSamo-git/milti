/**
 * Названия зданий из OpenStreetMap.
 *
 * ЗАЧЕМ. Перечень 700-ПП даёт кадастровый номер, ЕГРН — площадь и адрес.
 * Названия нет ни там, ни там. А Диме адрес без названия почти бесполезен:
 * «Пресненская наб., 6 стр. 2» ничего не говорит, «Башня Федерация» —
 * говорит всё. Проверено 2026-07-20: в OSM 2 496 зданий Москвы с именем.
 *
 * ЛИЦЕНЗИЯ: OpenStreetMap, ODbL, коммерческое использование разрешено
 * при атрибуции. Бесплатно, ключей не требует.
 *
 * КАК ОТЛИЧАЕМ БЦ ОТ ОФИСНОГО ЗДАНИЯ — это прямо из формулировки Димы:
 * «здания, которые по картам не определяются как БЦ, но функционируют
 * как БЦ». То есть признак ровно один — видно ли его на картах:
 *
 *   название нашлось в OSM + профиль деловой  -> БЦ
 *   названия на картах нет, но объект в перечне 700-ПП
 *     (город установил офисное использование) -> офисное здание
 *
 * Второй случай и есть «функционирует как БЦ, но картами не опознан».
 */
import { bboxString, escapeRe, MOSCOW_BBOX, parseElements, runOverpass } from '../lib/overpass.js';

export const SOURCE = 'osm_building_names';

/**
 * Слова, по которым здание опознаётся как деловой центр.
 * Отдельно от торговых: у Димы это разные списки.
 */
export const BC_MARKERS =
  /бизнес[-\s]?центр|бизнес[-\s]?парк|\bбц\b|\bбп\b|деловой центр|деловой квартал|business\s?center|business\s?park|\bplaza\b|\btower\b|башня|офисный центр|технопарк/i;

/** Торговые центры — шестой список Димы. */
export const TC_MARKERS =
  /торгов\w*\s+центр|торгово-развлекательн|\bтц\b|\bтрц\b|\bтрк\b|shopping|молл|\bmall\b|универмаг|гостиный двор/i;

/**
 * Забрать все именованные здания Москвы.
 *
 * Тянем и здания с деловым/торговым профилем, и всё, что помечено
 * тегом office: сеть OSM размечена неровно, и один фильтр половину теряет.
 *
 * @returns {Promise<Array<{name, lat, lon, osmId, street, house, tags}>>}
 */
export async function fetchNamedBuildings(bbox = MOSCOW_BBOX) {
  const area = bboxString(bbox);
  const query =
    '[out:json][timeout:180];' +
    '(' +
    `nwr["building"~"office|commercial|retail|industrial"]["name"](${area});` +
    `nwr["office"]["name"]["building"](${area});` +
    ');' +
    'out tags center 6000;';

  const payload = await runOverpass(query, { attempts: 3, backoffMs: 15000 });

  // Дедуп по osmId: один объект попадает в оба подзапроса.
  const seen = new Set();
  const out = [];
  for (const el of parseElements(payload)) {
    if (!el.name || seen.has(el.osmId)) continue;
    seen.add(el.osmId);
    out.push(el);
  }
  return out;
}

/**
 * Определить тип здания по названию и тегам.
 * @returns {'бц'|'тц'|'иное'}
 */
export function classify(element) {
  const name = element.name || '';
  const tags = element.tags || {};

  // Тег shop/mall у OSM надёжнее слов в названии: «Центральный детский
  // магазин» — это ТЦ, хотя слова «торговый центр» в имени нет.
  if (tags.shop === 'mall' || tags.building === 'retail') return 'тц';
  if (TC_MARKERS.test(name)) return 'тц';
  if (BC_MARKERS.test(name)) return 'бц';
  if (tags.office || tags.building === 'office') return 'бц';
  return 'иное';
}

/**
 * Расстояние между точками в метрах. Формула гаверсинуса.
 *
 * Для Москвы (широта ~55.7) годится: на таких расстояниях кривизна
 * не искажает результат заметно, а привязка идёт на десятках метров.
 */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
