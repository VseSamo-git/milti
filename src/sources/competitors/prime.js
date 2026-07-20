/**
 * Prime (Prime Star). Bitrix-сайт: на /contacts/ вшит инлайновый Yandex Maps
 * GeoJSON FeatureCollection со всеми точками. Координаты [lon, lat].
 * Проверено 2026-07-20: 78 точек. Своего числа сеть не пишет — сверяем с оценкой.
 */
import { httpText } from '../../lib/http.js';
import { extractBalanced, unescapeHtml } from '../../lib/parse.js';

const URL = 'https://prime-star.ru/contacts/';

export default {
  chain: 'prime',
  source: 'prime-star.ru',
  confidence: 'high',
  expectedMin: 70,

  async fetch() {
    const html = await httpText(URL);
    // Якорь внутри объекта — открывающая '{' стоит перед ним.
    const fc = extractBalanced(html, '"type":"FeatureCollection"', '{', { back: true });
    const raw = (fc.features || [])
      .map((f) => {
        const [lon, lat] = f.geometry?.coordinates || [];
        const p = f.properties || {};
        const address = unescapeHtml(p.address || p.balloonContentHeader);
        return {
          id: String(p.id ?? f.id),
          name: unescapeHtml(p.balloonContentHeader) || address || null,
          address,
          lat,
          lon,
        };
      })
      .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
    return { stated: null, raw };
  },
};
