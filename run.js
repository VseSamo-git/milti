// Загрузчик .env без лишних зависимостей.
// Убирает свой аргумент из argv, чтобы целевой скрипт видел стадию как argv[2].
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  process.env[t.slice(0, i)] = t.slice(i + 1);
}

const target = process.argv[2];
process.argv.splice(1, 2, target); // argv: [node, target, ...остальное]
await import(target);
