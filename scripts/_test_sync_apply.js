// Полный цикл обратного синка с откатом: ОК на внешнем БЦ → вердикт →
// строка уходит из «На проверку» и появляется в «Базе». Затем чистим тест.
import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';
import { Registry } from '../src/lib/registry.js';
import { syncVerdicts } from './sync_verdicts.js';

const cfg = loadConfig();
const client = new NocodbClient(cfg);
const registry = new Registry(cfg);
const DEC = 'Решение (ОК / Хуй)';
try {
  const tables = await client.tables();
  const tid = tables.get('На проверку');
  const rows = await client.records(tid, { fields: ['Ключ', DEC] });
  const target = rows.find((r) => r['Ключ'] && String(r['Ключ']).startsWith('ext:'));
  const key = target['Ключ'];
  const inProv = async () => (await registry.sql`SELECT 1 FROM vitrina."На проверку" WHERE "Ключ"=${key} LIMIT 1`).length;
  const inBaza = async () => (await registry.sql`SELECT 1 FROM vitrina."База" WHERE "Ключ"=${key} LIMIT 1`).length;

  console.log('тест-ключ:', key);
  console.log('ДО:            в «На проверку»', await inProv(), '| в «Базе»', await inBaza());

  await client.update(tid, [{ Id: target.Id, [DEC]: 'ОК' }]);
  await syncVerdicts(cfg, { apply: true });
  console.log('ПОСЛЕ ОК+синк: в «На проверку»', await inProv(), '| в «Базе»', await inBaza());

  // Откат: удалить тестовый вердикт (я его только что создал) и вернуть плашку.
  const [obj] = await registry.sql`SELECT id FROM kosmos.objects WHERE cadastral_no=${key} LIMIT 1`;
  const del = await registry.sql`DELETE FROM kosmos.verdicts WHERE object_id=${obj.id} AND author='дима (NocoDB)'`;
  await client.update(tid, [{ Id: target.Id, [DEC]: null }]);
  console.log('ОТКАТ:         удалено тест-вердиктов', del.count);
  console.log('КОНТРОЛЬ:      в «На проверку»', await inProv(), '| в «Базе»', await inBaza());
} finally { await registry.close(); }
