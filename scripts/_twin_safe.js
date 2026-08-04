// ПРЕВЬЮ безопасной версии: безымянный РЕЕСТРОВЫЙ объект + названный ВНЕШНИЙ
// близнец из каталога на ТОМ ЖЕ адресе (улица+дом, ≤150 м). Это паттерн Кусково.
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const R = 6371000, rad = (d) => d * Math.PI / 180;
const distM = (a, b, c, d) => { const dLa = rad(c - a), dLo = rad(d - b); const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
const ADMIN = /\b(российская федерация|г\.?|город|москва|московская|обл\.?|область|мо|поселение|деревня|д\.|рп|пгт|вн\.?тер\.?г\.?|муниципальный округ|район|р-н|ао|зао|сао|свао|юао|юзао|сзао|ювао|цао|нао|тао)\b/g;
const ST = /\b(улица|ул|проспект|пр-кт|пр-т|проезд|переулок|пер|шоссе|ш|бульвар|б-р|бул|набережная|наб|площадь|пл|аллея|линия|тупик|квартал|кв-л)\b\.?/g;
const HW = /\b(дом|корпус|корп|кор|строение|стр|владение|вл|литера|лит)\b\.?/g;
function parse(s) {
  const t = ` ${String(s).toLowerCase().replace(/ё/g, 'е')} `.replace(/\b\d+\s*-?\s*[йяе]\b/g, ' ').replace(ADMIN, ' ').replace(ST, ' ').replace(HW, ' ');
  const toks = t.replace(/[^0-9a-zа-я/]+/g, ' ').split(/\s+/).filter(Boolean);
  const words = new Set(toks.filter((w) => /^[а-яa-z]+$/.test(w) && w.length > 2));
  const houseTok = toks.find((w) => /\d/.test(w));
  const house = houseTok ? houseTok.split('/')[0].match(/\d+/)?.[0] || null : null;
  return { words, house };
}
try {
  const all = await sql`SELECT cadastral_no, title, origin, vitrina.addr_short(address) addr, address, lat, lon
    FROM kosmos.objects WHERE lat IS NOT NULL AND status='активен'`;
  const ext = all.filter((o) => o.origin && o.title && o.title.trim()).map((o) => ({ o, ...parse(o.address) }));
  const blank = all.filter((o) => !o.origin && (!o.title || !o.title.trim()));
  const pairs = [];
  for (const b of blank) {
    const bp = parse(b.address);
    if (!bp.house) continue;
    let best = null, bd = Infinity;
    for (const e of ext) {
      if (e.house !== bp.house) continue;
      let ov = false; for (const w of bp.words) if (e.words.has(w)) { ov = true; break; }
      if (!ov) continue;
      const d = distM(b.lat, b.lon, e.o.lat, e.o.lon);
      if (d <= 150 && d < bd) { bd = d; best = e.o; }
    }
    if (best) pairs.push({ b, n: best, d: bd });
  }
  console.log(`безымянных реестровых с внешним близнецом на том же адресе: ${pairs.length}\n`);
  for (const p of pairs.slice(0, 40)) console.log(`  «${p.b.addr}»  ←  «${p.n.title}»  (~${Math.round(p.d)} м, ${p.n.origin})`);
} finally { await sql.end({ timeout: 5 }); }
