import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  console.log('--- kosmos.places (ВУЗ/НИИ/конкуренты/ТЦ): координаты, адреса, названия ---');
  console.table(await sql`
    SELECT kind,
           count(*)::int                                             AS всего,
           count(*) FILTER (WHERE lat IS NULL OR lon IS NULL)::int    AS без_коорд,
           count(*) FILTER (WHERE address IS NULL OR address='')::int AS без_адреса,
           count(*) FILTER (WHERE name IS NULL OR name='')::int       AS без_названия
      FROM kosmos.places
     WHERE status <> 'вычтен' OR status IS NULL
     GROUP BY kind ORDER BY 2 DESC`);

  console.log('--- kosmos.objects по типу: координаты и адреса (только активные) ---');
  console.table(await sql`
    SELECT object_type,
           count(*)::int                                             AS всего,
           count(*) FILTER (WHERE lat IS NULL OR lon IS NULL)::int    AS без_коорд,
           count(*) FILTER (WHERE address IS NULL OR address='')::int AS без_адреса,
           count(*) FILTER (WHERE title IS NULL OR title='')::int     AS без_названия
      FROM kosmos.objects
     WHERE status = 'активен'
     GROUP BY object_type ORDER BY 2 DESC`);
} finally { await sql.end({ timeout: 5 }); }
