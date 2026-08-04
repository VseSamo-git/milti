// ПРЕВЬЮ (только чтение): безымянные объекты, у которых есть названный близнец
// (то же здание). Показывает, какое имя они бы получили и откуда.
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const R = 6371000, rad = (d) => d * Math.PI / 180;
const distM = (a, b, c, d) => { const dLa = rad(c - a), dLo = rad(d - b); const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
try {
  const all = await sql`SELECT cadastral_no, title, origin, vitrina.addr_short(address) addr, lat, lon
    FROM kosmos.objects WHERE lat IS NOT NULL AND status='активен'`;
  const named = all.filter((o) => o.title && o.title.trim());
  const blank = all.filter((o) => !o.title || !o.title.trim());
  console.log(`всего активных с коорд: ${all.length} | названо ${named.length} | пусто ${blank.length}\n`);

  const THRESH = 60; // ≤60 м — уверенно то же здание
  const pairs = [];
  for (const b of blank) {
    let best = null, bd = Infinity;
    for (const n of named) {
      const d = distM(b.lat, b.lon, n.lat, n.lon);
      if (d <= THRESH && d < bd) { bd = d; best = n; }
    }
    if (best) pairs.push({ b, n: best, d: bd });
  }
  console.log(`безымянных, у которых есть названный близнец ≤${THRESH} м: ${pairs.length}\n`);
  console.log('--- примеры (пустой адрес → имя близнеца) ---');
  for (const p of pairs.slice(0, 30)) {
    const src = p.n.origin ? `внешний ${p.n.origin}` : 'реестр';
    console.log(`  «${p.b.addr || p.b.cadastral_no}»  ←  «${p.n.title}»  (~${Math.round(p.d)} м, ${src})`);
  }
} finally { await sql.end({ timeout: 5 }); }
