import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';
import { SHEET_LIST } from '../src/lib/vitrina_views.js';
const client = new NocodbClient(loadConfig());
const KEEP = new Set(SHEET_LIST);
const t = await client.tables();
for (const [name, id] of t.entries()) {
  if (!KEEP.has(name)) { await client.deleteTable(id); console.log('удалён старый лист:', name); }
}
const after = await client.tables();
console.log('осталось таблиц:', after.size, '→', [...after.keys()].join(' | '));
