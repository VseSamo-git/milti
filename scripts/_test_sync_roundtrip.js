// Проверка обратного синка без загрязнения вердиктов: ставим плашку ОК на
// одну строку «На проверку», убеждаемся что синк её видит (dry-run), возвращаем.
import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';
import { syncVerdicts } from './sync_verdicts.js';

const cfg = loadConfig();
const client = new NocodbClient(cfg);
const DEC = 'Решение (ОК / Хуй)';
const tables = await client.tables();
const tid = tables.get('На проверку');
const rows = await client.records(tid, { fields: ['Ключ', DEC] });
const target = rows.find((r) => r['Ключ']);
console.log('тестовая строка: Id', target.Id, '| Ключ', target['Ключ'], '| решение сейчас:', target[DEC]);

await client.update(tid, [{ Id: target.Id, [DEC]: 'ОК' }]);
console.log('поставили ОК, запускаем синк (dry-run)...\n');
const dry = await syncVerdicts(cfg, { apply: false });
console.log('\nрезультат синка:', JSON.stringify(dry));

await client.update(tid, [{ Id: target.Id, [DEC]: null }]);
console.log('плашка возвращена в пусто — база не изменена');
