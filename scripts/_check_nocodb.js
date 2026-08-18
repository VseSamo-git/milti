// Разовая сверка: то, что в Postgres, доехало ли до экрана Димы.
import { loadConfig } from '../src/config.js';
import { NocodbClient } from '../src/lib/nocodb.js';

const client = new NocodbClient(loadConfig());
const tables = await client.tables();
console.log('листы у Димы:', [...tables.keys()].join(' | '));
for (const [name, id] of tables) console.log(`  ${name}: ${await client.count(id)} строк`);

const baza = tables.get('База');
const rows = await client.records(baza, { fields: ['Название', 'Адрес', 'Решение (ОК / Хуй)'] });
const ищем = ['ЦУМ', 'Росатом', 'Лотте Плаза', 'ЛУКОЙЛ', 'Цветной'];
console.log('\nодобренные Димой — на экране:');
for (const n of ищем) {
  const hit = rows.find((r) => (r['Название'] || '').trim() === n);
  console.log(`  ${hit ? '✓' : '✗'} ${n}${hit ? ' — ' + (hit['Адрес'] || '').slice(0, 46) : ' НЕ НАЙДЕН'}`);
}
const withDecision = rows.filter((r) => r['Решение (ОК / Хуй)']);
console.log(`\nстрок в листе «База»: ${rows.length}; из них с проставленным решением: ${withDecision.length}`);
