import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';
const client = new NocodbClient(loadConfig());
const KEEP = new Set(['База','На проверку','8 БЦ средние 5-10к','6 ТЦ с супермаркетом','7 Конкуренты','Открытые точки','Закрытые точки']);
const t = await client.tables();
for (const [name, id] of t.entries()) {
  if (!KEEP.has(name)) { await client.deleteTable(id); console.log('удалён старый лист:', name); }
}
const after = await client.tables();
console.log('осталось таблиц:', after.size, '→', [...after.keys()].join(' | '));
