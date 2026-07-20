/**
 * French Bakery. Свой бэкенд-API отдаёт полный список адресов с пагинацией.
 * Проверено 2026-07-20: meta.total = 162 — это и есть stated (сеть сама
 * называет число). КООРДИНАТ НЕТ НИГДЕ: ни в списке, ни в детальной записи —
 * карту на сайте рисуют геокодированием адреса на лету. Поэтому lat/lon = null,
 * точки едут к Диме списком адресов, но не на карте (по решению 2026-07-20).
 *
 * Именно эта сеть вскрыла провал OSM: там её было 6 из 162 (4%).
 */
import { httpJson } from '../../lib/http.js';
import { unescapeHtml } from '../../lib/parse.js';

const API = 'https://backend.frenchbakery.ru/api/addresses';

export default {
  chain: 'french bakery',
  source: 'frenchbakery.ru',
  confidence: 'high',

  async fetch() {
    // Первая страница даёт meta.total (stated) и число страниц.
    const first = await httpJson(`${API}?page=1`);
    const stated = first?.meta?.total ?? null;
    const lastPage = first?.meta?.last_page ?? 1;

    const all = [...(first.data || [])];
    for (let page = 2; page <= lastPage; page++) {
      const chunk = await httpJson(`${API}?page=${page}`);
      all.push(...(chunk.data || []));
    }

    const raw = all
      .filter((r) => r.isActive !== false)
      .map((r) => ({
        id: r.seoName || String(r.id),
        name: unescapeHtml(r.name) || null,
        address: unescapeHtml(r.address || r.name),
        lat: null, // источник координат не публикует
        lon: null,
      }));
    return { stated, raw };
  },
};
