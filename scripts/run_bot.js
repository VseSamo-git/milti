/**
 * Телеграм-бот КОСМОСа: Дима пишет боту, агент делает с базой.
 *
 * Long-poll getUpdates → whitelist → agent.answer() → sendMessage. Без вебхука
 * и без внешних библиотек: одному пользователю (Диме) long-poll достаточно,
 * а лишний сервер и зависимость — только риск.
 *
 * БЕЗОПАСНОСТЬ. Отвечаем ТОЛЬКО тем, чей Telegram-id в whitelist
 * (KOSMOS_TELEGRAM_ALLOWED). Чужие сообщения игнорируем молча — бот не должен
 * подтверждать посторонним даже факт своего существования.
 *
 * Запуск:
 *   node run.js ./scripts/run_bot.js
 * Нужны: ANTHROPIC_API_KEY, KOSMOS_TELEGRAM_TOKEN, KOSMOS_TELEGRAM_ALLOWED.
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { answer } from '../src/bot/agent.js';

const config = loadConfig();
for (const [k, v] of Object.entries({
  ANTHROPIC_API_KEY: config.anthropicKey,
  KOSMOS_TELEGRAM_TOKEN: config.telegramToken,
})) {
  if (!v) throw new Error(`${k} не задан — бот не может стартовать`);
}
if (config.telegramAllowedIds.length === 0) {
  throw new Error('KOSMOS_TELEGRAM_ALLOWED пуст — некому отвечать. Укажи Telegram-id Димы.');
}

const API = `https://api.telegram.org/bot${config.telegramToken}`;
const registry = new Registry(config);

// История диалога по чату: последние ходы, чтобы Дима мог уточнять «а из них
// в ЦАО?». Ограничиваем, чтобы контекст (и счёт) не рос без предела.
const HISTORY_LIMIT = 12;
const histories = new Map();

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

// Телеграм режет сообщения на 4096 символов.
async function reply(chatId, text) {
  const chunk = text.slice(0, 4000);
  await tg('sendMessage', { chat_id: chatId, text: chunk });
}

async function handle(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const fromId = String(msg.from?.id ?? '');
  if (!config.telegramAllowedIds.includes(fromId)) {
    console.log(`игнор: чужой id ${fromId} (${msg.from?.username || '?'})`);
    return; // молчим для посторонних
  }

  const chatId = msg.chat.id;
  const author = `telegram:${msg.from?.username || fromId}`;

  if (msg.text.trim() === '/start') {
    await reply(chatId, 'Привет! Спрашивай базу словами: «покажи БЦ больше 50000», ' +
      '«сколько конкурентов возможно закрылись», «пометь БЦ на Автозаводской 18 — интересно, созвон в пятницу».');
    return;
  }

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  try {
    const history = histories.get(chatId) || [];
    const { reply: text, history: next } = await answer(config, registry, {
      text: msg.text,
      author,
      history,
    });
    histories.set(chatId, next.slice(-HISTORY_LIMIT));
    await reply(chatId, text);
  } catch (e) {
    console.log(`ошибка обработки: ${e.message}`);
    await reply(chatId, `Спотыкнулся: ${e.message}`);
  }
}

async function main() {
  const me = await tg('getMe', {});
  console.log(`бот @${me.username} на связи. Разрешённые id: ${config.telegramAllowedIds.join(', ')}`);

  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await tg('getUpdates', { offset, timeout: 30 });
    } catch (e) {
      console.log(`getUpdates упал: ${e.message}; пауза 5с`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      await handle(u);
    }
  }
}

main().catch(async (e) => {
  console.error(e);
  await registry.close();
  process.exit(1);
});
