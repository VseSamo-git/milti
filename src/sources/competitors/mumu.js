/**
 * Му-Му. JSON-endpoint ajax/get_points.php (Bitrix). Требует www (иначе 301).
 * Проверено 2026-07-20: 18 точек по Москве и МО; 4 аэропорта в МО отсекает
 * раннер по «Московская обл» в адресе. Своего числа сеть не пишет.
 */
import { httpJson } from '../../lib/http.js';
import { unescapeHtml, slugify } from '../../lib/parse.js';

const URL = 'https://www.cafemumu.ru/ajax/get_points.php';

export default {
  chain: 'муму',
  source: 'cafemumu.ru',
  confidence: 'high',
  expectedMin: 16,

  async fetch() {
    const list = await httpJson(URL);
    const raw = (Array.isArray(list) ? list : [])
      .map((r) => {
        const lat = Number(r.position?.lat);
        const lon = Number(r.position?.lng);
        const address = unescapeHtml(r.address);
        return {
          id: String(r.id ?? r.cafe_id ?? slugify(address)),
          name: unescapeHtml(r.title) || null,
          address,
          lat,
          lon,
        };
      })
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    return { stated: null, raw };
  },
};
