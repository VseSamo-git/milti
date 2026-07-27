/**
 * Добить адреса конкурентам, которых НЕ покрыл московский реестр.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. Реестр data.mos.ru — это город Москва. Пять точек «Здрасте»
 * стоят в Подмосковье (сеть спальных районов МО), и в городском реестре их
 * зданий нет — отсюда «дальше порога». Обратный геокодер OSM (Nominatim)
 * покрывает и область, ключа не требует.
 *
 * ЧЕСТНОСТЬ. Адрес всё равно ВЫВЕДЕННЫЙ — по координате, а не сообщённый
 * сетью. Пишем address_source='nominatim', чтобы происхождение было видно.
 *
 * ЛИМИТЫ Nominatim: не чаще 1 запроса в секунду, обязателен User-Agent.
 * Точек единицы — укладываемся с запасом.
 *
 * Запуск:
 *   node run.js ./scripts/link_nominatim.js
 */
import { loadConfig } from '../src/config.js';
import { isMain } from '../src/lib/is_main.js';
import { Registry } from '../src/lib/registry.js';

const UA = 'kosmos-mealty/1.0 (address backfill; contact pochtavsesamo@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverse(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
    `&accept-language=ru&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const a = j.address || {};
  // Собираем короткий русский адрес: улица + дом, с городом/районом для МО.
  const road = a.road || a.pedestrian || a.neighbourhood || null;
  const house = a.house_number || null;
  const place = a.city || a.town || a.village || a.municipality || a.county || null;
  const line = [place, road, house].filter(Boolean).join(', ');
  return line || j.display_name || null;
}

/**
 * Добить адреса конкурентам без адреса обратным геокодером OSM.
 * @param {Registry} registry
 * @returns {{written: number}}
 */
export async function linkNominatim(registry) {
  const gap = await registry.sql`
    SELECT id, chain, name, lat, lon FROM kosmos.places
    WHERE kind='конкурент' AND address IS NULL AND lat IS NOT NULL AND lon IS NOT NULL`;
  console.log(`конкурентов без адреса: ${gap.length}`);

  let written = 0;
  for (const p of gap) {
    try {
      const address = await reverse(Number(p.lat), Number(p.lon));
      if (!address) {
        console.log(`   ${p.chain} (${p.lat},${p.lon}): геокодер пусто`);
      } else {
        await registry.sql`
          UPDATE kosmos.places
          SET address = ${address}, address_source = 'nominatim', address_distance_m = NULL
          WHERE id = ${p.id} AND address IS NULL`;
        written += 1;
        console.log(`   ${p.chain}: ${address}`);
      }
    } catch (e) {
      console.log(`   ${p.chain} (${p.lat},${p.lon}): ошибка — ${e.message}`);
    }
    await sleep(1100); // вежливо к публичному Nominatim
  }

  console.log(`\nзаписано адресов: ${written}`);
  const [c] = await registry.sql`
    SELECT count(*)::int total, count(*) FILTER (WHERE address IS NOT NULL)::int with_addr
    FROM kosmos.places WHERE kind='конкурент'`;
  console.log(`конкуренты: ${c.total} всего, ${c.with_addr} с адресом`);
  console.log('© OpenStreetMap contributors / Nominatim, ODbL.');
  return { written };
}

if (isMain(import.meta.url)) {
  const registry = new Registry(loadConfig());
  try {
    await linkNominatim(registry);
  } finally {
    await registry.close();
  }
}
