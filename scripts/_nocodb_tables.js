import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';
const client = new NocodbClient(loadConfig());
const KEEP = new Set(['База','На проверку','8 БЦ средние 5-10к','6 ТЦ с супермаркетом','7 Конкуренты','Открытые точки','Закрытые точки']);
const t = await client.tables();
console.log('Всего таблиц в NocoDB:', t.size);
const orphans = [];
for (const name of t.keys()) { console.log(`  ${KEEP.has(name)?'✓':'✗ СИРОТА'} ${name}`); if (!KEEP.has(name)) orphans.push(name); }
console.log('\nСирот к удалению:', orphans.length, '→', orphans.join(' | '));
