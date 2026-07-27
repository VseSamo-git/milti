/**
 * Досбор Арендатора: тянет все страницы списка БЦ ≥10 000 м² по Москве и
 * достаёт чистый JSON-LD (адрес + координаты + ссылка). Заменяет ручное
 * сохранение страниц браузером. Сайт отдаёт 200 без анти-бота; нужен лишь
 * User-Agent и вежливая пауза между страницами.
 *
 * Фильтр зашит в URL (square_total:10000 → все ≥10к, geo_regions Москва).
 * Имя БЦ в JSON-LD не приходит — берём из slug ссылки и, если нашли, из HTML.
 *
 * Запуск: node scripts/fetch_arendator.mjs
 * Результат: docs/arendator_bc.json
 */
const BASE = 'https://www.arendator.ru/objects/office/state:70/square_total:10000,0/geo_regions:55,9/page:';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function getPage(n, tries = 3) {
  const url = `${BASE}${n}/`;
  for (let a = 1; a <= tries; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru' } });
      if (r.status >= 500 || r.status === 429) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} (постоянная)`);
      return await r.text();
    } catch (e) {
      if (a === tries) throw e;
      await sleep(1500 * a);
    }
  }
}

function parsePage(html) {
  const out = [];
  // имя БЦ: карта url -> текст ссылки в HTML (если найдётся)
  const nameByUrl = new Map();
  for (const m of html.matchAll(/href="(https:\/\/www\.arendator\.ru\/objects\/\d+-[^"]+)"[^>]*>\s*([^<>{}]{3,120}?)\s*</g)) {
    const nm = clean(m[2]);
    if (nm && !/^\s*$/.test(nm) && !nameByUrl.has(m[1])) nameByUrl.set(m[1], nm);
  }
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    if (j['@type'] !== 'ItemList') continue;
    for (const e of j.itemListElement || []) {
      if (e['@type'] !== 'Place') continue;
      const url = e.url || null;
      const slug = url ? decodeURIComponent(url.split('/').filter(Boolean).pop() || '').replace(/^\d+-/, '').replace(/_/g, ' ') : '';
      out.push({
        name: (url && nameByUrl.get(url)) || slug || null,
        address: clean(e.address?.name),
        lat: e.geo?.latitude ? +e.geo.latitude : null,
        lon: e.geo?.longitude ? +e.geo.longitude : null,
        url,
      });
    }
  }
  return out;
}

const all = [];
const seen = new Set();
for (let p = 1; p <= 9; p++) {
  const html = await getPage(p);
  const items = parsePage(html);
  let added = 0;
  for (const it of items) {
    const key = it.url || it.address;
    if (seen.has(key)) continue;
    seen.add(key); all.push(it); added++;
  }
  console.log(`стр.${p}: карточек ${items.length}, новых ${added}, всего ${all.length}`);
  if (p < 9) await sleep(1200);
}

const withGeo = all.filter((x) => x.lat && x.lon).length;
console.log(`\nИТОГО БЦ: ${all.length} | с координатами: ${withGeo} | с именем: ${all.filter((x) => x.name).length}`);
console.log('Примеры:');
for (const x of all.slice(0, 5)) console.log(`  • ${x.name} — ${x.address} [${x.lat}, ${x.lon}]`);

const fs = await import('node:fs');
fs.writeFileSync('docs/arendator_bc.json', JSON.stringify({ source: 'arendator.ru БЦ ≥10к Москва', fetched_pages: 9, count: all.length, items: all }, null, 1));
console.log('\nСохранил: docs/arendator_bc.json');
