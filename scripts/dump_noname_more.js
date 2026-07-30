import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const RETAIL = `(o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|молл|аутлет|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)')`;
try {
  const rows = await sql.unsafe(`
    SELECT DISTINCT o.cadastral_no, round(o.area_sqm)::int area, o.address,
      CASE
        WHEN o.object_type IN ('офисное_здание','офис_компании') OR (o.object_type='неизвестен' AND o.annex=1 AND o.area_sqm>=10000 AND o.floors>0 AND o.area_sqm/o.floors<=3000 AND NOT coalesce(o.arendator_matched,false)) THEN 'офисное'
        WHEN (o.object_type='бц' OR o.arendator_matched) AND o.area_sqm>=5000 AND o.area_sqm<10000 THEN 'средние'
        ELSE 'напроверку'
      END AS nabor
    FROM kosmos.objects o
    LEFT JOIN vitrina._last_verdict v ON v.object_id=o.id
    WHERE o.status='активен' AND o.title IS NULL AND o.origin IS NULL
      AND (v.verdict IS NULL OR v.verdict<>'отказ')
      AND (
        -- офисные в Базе
        (o.object_type IN ('офисное_здание','офис_компании')
         OR (o.object_type='неизвестен' AND o.annex=1 AND o.area_sqm>=10000 AND o.floors>0 AND o.area_sqm/o.floors<=3000 AND NOT coalesce(o.arendator_matched,false) AND ${RETAIL}))
        -- средние БЦ 5-10к
        OR ((o.object_type='бц' OR o.arendator_matched) AND o.annex=1 AND o.area_sqm>=5000 AND o.area_sqm<10000)
        -- на проверку (реестр-неясные)
        OR (o.object_type='неизвестен' AND o.annex=1 AND o.area_sqm>=10000 AND (o.floors IS NULL OR o.floors=0 OR o.area_sqm/o.floors>3000) AND ${RETAIL})
      )
    ORDER BY area DESC NULLS LAST`);
  writeFileSync('docs/noname_more.json', JSON.stringify(rows, null, 1));
  const by = {};
  for (const r of rows) by[r.nabor]=(by[r.nabor]||0)+1;
  console.log('безымянных всего:', rows.length, JSON.stringify(by));
} finally { await sql.end({ timeout: 5 }); }
