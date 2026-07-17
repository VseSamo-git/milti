/**
 * ВУЗы и НИИ — из OpenStreetMap.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ИСТОЧНИК, а не перечень 700-ПП. Перечень — это список
 * плательщиков налога на коммерческую недвижимость. Государственные ВУЗы
 * и НИИ его во многом не платят и в перечень НЕ ПОПАДАЮТ. Значит для этих
 * двух листов Димы перечень — слабый посев, и нужен свой.
 *
 * 2ГИС не нужен. Проверено на живых данных 2026-07-16:
 *   ВУЗы (amenity=university): 380, название у 364 (96%)
 *   НИИ                      : 620, название у 611 (98%)
 *   Колледжи (amenity=college): 298
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Дима просит «количество студентов по этому адресу» —
 * такого источника нет ни у кого: публичная статистика даёт число
 * студентов на весь ВУЗ, а не по корпусам. Поле остаётся NULL.
 * Пустая ячейка честнее выдуманной.
 *
 * Площадь берётся не отсюда, а из Росреестра — по зданию, найденному
 * по координате.
 */
import { bboxString, MOSCOW_BBOX, parseElements, runOverpass } from '../lib/overpass.js';

export const SOURCE = 'osm_education';

/**
 * Родовые названия, которые не несут информации. Проверено: регэксп по
 * «НИИ|Научно-исследовательс» ловит и посторонние объекты — например,
 * «Св. князю Даниилу» (памятник). Поэтому имя перепроверяется.
 */
// Аббревиатура может идти слитно с остальным именем — живые примеры из OSM:
// «ЦНИИТМАШ», «ВНИИГаз». Поэтому границу требуем только СЛЕВА: она
// не даёт поймать «нии» внутри слова («Да-нии-лу»).
const NII_RE = /(^|\s|«|"|-)(НИИ|ВНИИ|ЦНИИ|ГНИИ)|научно-исследовательс|научный центр|институт\s/i;

// Явные не-НИИ, которые ловятся по подстроке.
const NII_FALSE_POSITIVE = /храм|церк|собор|часовн|памятник|князю|мемориал/i;

export function buildUniversitiesQuery(bbox = MOSCOW_BBOX) {
  const box = bboxString(bbox);
  return (
    '[out:json][timeout:120];' +
    '(' +
    `nwr["amenity"="university"](${box});` +
    `nwr["amenity"="college"](${box});` +
    ');' +
    'out tags center 3000;'
  );
}

export function buildResearchQuery(bbox = MOSCOW_BBOX) {
  const box = bboxString(bbox);
  return (
    '[out:json][timeout:120];' +
    '(' +
    `nwr["office"="research"](${box});` +
    `nwr["name"~"НИИ|Научно-исследовательс",i](${box});` +
    ');' +
    'out tags center 3000;'
  );
}

/** Отсеять ложные срабатывания регэкспа по названию. */
export function isResearchInstitute(name, tags = {}) {
  if (tags.office === 'research') return true;
  if (!name) return false;
  if (NII_FALSE_POSITIVE.test(name)) return false;
  return NII_RE.test(name);
}

/**
 * ВУЗы и колледжи Москвы.
 * @returns {{name, lat, lon, osmId, kind: 'вуз'|'колледж'}[]}
 */
export async function fetchUniversities(bbox = MOSCOW_BBOX) {
  const payload = await runOverpass(buildUniversitiesQuery(bbox));

  return parseElements(payload)
    .filter((el) => el.name) // без названия объект бесполезен для листа Димы
    .map((el) => ({
      name: el.name,
      lat: el.lat,
      lon: el.lon,
      osmId: el.osmId,
      street: el.street,
      house: el.house,
      kind: el.tags.amenity === 'college' ? 'колледж' : 'вуз',
      // Источника нет ни у кого — см. шапку модуля.
      students: null,
    }));
}

/**
 * НИИ Москвы.
 * @returns {{name, lat, lon, osmId}[]}
 */
export async function fetchResearchInstitutes(bbox = MOSCOW_BBOX) {
  const payload = await runOverpass(buildResearchQuery(bbox));

  return parseElements(payload)
    .filter((el) => isResearchInstitute(el.name, el.tags))
    .map((el) => ({
      name: el.name,
      lat: el.lat,
      lon: el.lon,
      osmId: el.osmId,
      street: el.street,
      house: el.house,
    }));
}
