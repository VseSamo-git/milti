// Разовый: удалить лист витрины в NocoDB по имени. Данные живут в Postgres,
// таблица NocoDB — только показ, поэтому удаление здесь безопасно и обратимо
// пересборкой. Запуск: node run.js ./scripts/_del_sheet.js "<имя листа>"
import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';

const name = process.argv[2];
if (!name) throw new Error('нужно имя листа');
const client = new NocodbClient(loadConfig());
const tables = await client.tables();
console.log('листы в NocoDB:', [...tables.keys()].join(' | '));
const id = tables.get(name);
if (!id) { console.log(`листа «${name}» нет — удалять нечего`); process.exit(0); }
await client.deleteTable(id);
console.log(`удалён лист «${name}» (${id})`);
