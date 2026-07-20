/**
 * Шоколадница. Свой JSON-API, GeoJSON со всей сетью по РФ.
 * Проверено 2026-07-20: 185 точек, координаты в порядке [lat, lon] (нестандарт).
 * Москву отфильтрует раннер по bbox.
 */
import { httpJson } from '../../lib/http.js';
import { unescapeHtml } from '../../lib/parse.js';

const URL = 'https://shoko.ru/local/api/restaurants2';

export default {
  chain: 'шоколадница',
  source: 'shoko.ru',
  confidence: 'high',
  // Своего числа сеть на сайте не пишет — сверяем с оценкой из разведки (РФ).
  expectedMin: 180,

  async fetch() {
    const data = await httpJson(URL, { method: 'POST' });
    const features = data?.rest?.features || [];
    const raw = features
      .map((f) => {
        const [lat, lon] = f.geometry?.coordinates || [];
        const p = f.properties || {};
        const address = [unescapeHtml(p.title), unescapeHtml(p.subtitle)].filter(Boolean).join(', ');
        return { id: String(p.id ?? f.id), name: address || null, address, lat, lon };
      })
      .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
    return { stated: null, raw };
  },
};
