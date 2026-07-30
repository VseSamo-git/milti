import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  // БЦ в Базе без названия
  const [t] = await sql`SELECT
    count(*) FILTER (WHERE object_type='бц' OR arendator_matched)::int bc_total,
    count(*) FILTER (WHERE (object_type='бц' OR arendator_matched) AND title IS NULL)::int bc_noname,
    count(*) FILTER (WHERE (object_type='бц' OR arendator_matched) AND title IS NULL AND arendator_url IS NOT NULL)::int noname_has_arendator,
    count(*) FILTER (WHERE (object_type='бц' OR arendator_matched) AND title IS NULL AND arendator_url IS NULL)::int noname_no_source
    FROM kosmos.objects WHERE status='активен' AND origin IS NULL`;
  console.log('БЦ (реестр) в Базе:');
  console.table([t]);
  console.log('bc_total = всего БЦ; bc_noname = без названия; из них: с привязкой к Арендатору (можно подтянуть имя) / вообще без источника имени');
} finally { await sql.end({ timeout: 5 }); }
