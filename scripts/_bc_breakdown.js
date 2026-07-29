import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  // Разбор БЦ из Базы по площади
  const buckets = await sql.unsafe(`
    SELECT CASE
      WHEN "Площадь, м²" IS NULL THEN '0. площадь неизвестна'
      WHEN "Площадь, м²" >= 50000 THEN '5. ≥50к'
      WHEN "Площадь, м²" >= 10000 THEN '4. 10–50к'
      WHEN "Площадь, м²" >= 5000  THEN '3. 5–10к'
      WHEN "Площадь, м²" >= 1000  THEN '2. 1–5к'
      ELSE '1. <1000'
    END bucket, count(*)::int c
    FROM vitrina."База" WHERE "Тип объекта"='БЦ' GROUP BY 1 ORDER BY 1`);
  console.log('=== БЦ в Базе по площади (всего 1657) ===');
  console.table(buckets);

  // По признаку подтверждения (из объектов напрямую)
  const q = await sql.unsafe(`
    SELECT
      count(*) FILTER (WHERE object_type='бц' AND origin IS NULL)::int as osm_bc,
      count(*) FILTER (WHERE object_type<>'бц' AND arendator_matched AND origin IS NULL)::int as arendator_only,
      count(*) FILTER (WHERE object_type='неизвестен' AND origin IS NULL AND NOT coalesce(arendator_matched,false))::int as office_geom,
      count(*) FILTER (WHERE origin IS NOT NULL)::int as external,
      count(*) FILTER (WHERE object_type='бц' AND origin IS NULL AND (area_sqm IS NULL OR area_sqm<10000))::int as osm_bc_under10k
    FROM kosmos.objects o
    LEFT JOIN vitrina._last_verdict v ON v.object_id=o.id
    WHERE o.status NOT LIKE 'вычтен%' AND (v.verdict IS NULL OR v.verdict<>'отказ')
      AND (
        (o.origin IS NULL AND (o.object_type IN ('бц','офисное_здание','офис_компании') OR o.arendator_matched
          OR (o.object_type='неизвестен' AND o.annex=1 AND o.area_sqm>=10000 AND o.floors>0 AND o.area_sqm/o.floors<=3000)))
        OR (o.origin IS NOT NULL AND v.verdict='интересно')
      )
      AND (o.object_type='бц' OR o.arendator_matched)`);
  console.log('=== как 1657 БЦ попали в Базу ===');
  console.table(q);
} finally { await sql.end({ timeout: 5 }); }
