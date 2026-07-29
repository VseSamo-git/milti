import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  for (const v of ['База','На проверку','8 БЦ средние 5-10к']) {
    const [{ count }] = await sql.unsafe(`SELECT count(*)::int FROM vitrina."${v}"`);
    console.log(`${v}: ${count}`);
  }
  console.log('\n=== База по типам ===');
  console.table(await sql.unsafe(`SELECT "Тип объекта" t, count(*)::int c FROM vitrina."База" GROUP BY 1 ORDER BY 2 DESC`));
  console.log('=== БЦ в Базе по площади ===');
  console.table(await sql.unsafe(`SELECT CASE WHEN "Площадь, м²" IS NULL THEN 'неизвестна' WHEN "Площадь, м²">=50000 THEN '≥50к' WHEN "Площадь, м²">=10000 THEN '10-50к' ELSE '<10к!' END b, count(*)::int c FROM vitrina."База" WHERE "Тип объекта"='БЦ' GROUP BY 1 ORDER BY 1`));
} finally { await sql.end({ timeout: 5 }); }
