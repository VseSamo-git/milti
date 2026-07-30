/**
 * Обратная дыра: у объекта есть название, но нет адреса — хотя координата есть.
 * Добиваем адрес обратным геокодером OSM (Nominatim, без ключа), провенанс
 * address_source='nominatim'. Заодно печатаем тип/площадь — видно мусор в
 * классификации (пожарная часть/ЗАГС/АЗС как «БЦ»).
 *
 * Запуск: node run.js ./scripts/backfill_object_addresses.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import { isMain } from '../src/lib/is_main.js';
import { Registry } from '../src/lib/registry.js';

const UA = 'kosmos-mealty/1.0 (address backfill; contact pochtavsesamo@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverse(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=ru&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const a = j.address || {};
  const road = a.road || a.pedestrian || a.neighbourhood || null;
  const house = a.house_number || null;
  const place = a.city || a.town || a.village || a.municipality || a.county || null;
  return [place, road, house].filter(Boolean).join(', ') || j.display_name || null;
}

export async function backfillAddresses(registry, { apply = false } = {}) {
  const gap = await registry.sql`
    SELECT cadastral_no, title, object_type, arendator_matched, round(area_sqm)::int area, lat, lon
    FROM kosmos.objects
    WHERE title IS NOT NULL AND (address IS NULL OR trim(address)='') AND lat IS NOT NULL
    ORDER BY area_sqm DESC NULLS LAST`;
  console.log(`объектов с именем без адреса: ${gap.length}\n`);

  let written = 0;
  for (const o of gap) {
    let address = null;
    try { address = await reverse(Number(o.lat), Number(o.lon)); }
    catch (e) { console.log(`  «${o.title}»: геокодер ошибка ${e.message}`); }
    const tag = `[${o.object_type}${o.arendator_matched ? '/арендатор' : ''} ${o.area || '?'}м²]`;
    if (address && apply) {
      await registry.sql`UPDATE kosmos.objects SET address=${address}, address_source='nominatim'
        WHERE cadastral_no=${o.cadastral_no} AND (address IS NULL OR trim(address)='')`;
      written++;
    }
    console.log(`  ${tag} «${o.title}» → ${address || '(пусто)'}`);
    await sleep(1100);
  }
  console.log(`\n${apply ? 'записано адресов: ' + written : '(dry-run: --apply чтобы записать)'}`);
  return { gap: gap.length, written };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try { await backfillAddresses(registry, { apply }); }
  finally { await registry.close(); }
}
