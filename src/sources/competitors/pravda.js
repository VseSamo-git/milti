/**
 * Правда кофе. WordPress admin-ajax отдаёт JSON со всей сетью.
 * Проверено 2026-07-20: 162 точки по РФ, поля lat/lng/addr. Москву режет раннер.
 */
import { httpJson } from '../../lib/http.js';

const URL = 'https://pravdacoffee.ru/wp-admin/admin-ajax.php?action=get_addresses';

export default {
  chain: 'правда кофе',
  source: 'pravdacoffee.ru',
  confidence: 'high',
  expectedMin: 150,

  async fetch() {
    const data = await httpJson(URL);
    const list = data?.response || [];
    const raw = list
      .map((r) => ({
        id: String(r.ID),
        name: r.addr || null,
        address: r.addr || null,
        lat: Number(r.lat),
        lon: Number(r.lng),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    return { stated: null, raw };
  },
};
