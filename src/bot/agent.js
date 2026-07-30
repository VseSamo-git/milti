/**
 * Мозг телеграм-агента Димы. Дима пишет словами — Claude решает, что сделать
 * с базой, вызывая безопасные инструменты (tools.js), и отвечает по-русски.
 *
 * БЕЗ SDK. Проект держит минимум зависимостей (postgres + undici), поэтому
 * ходим в Messages API напрямую через fetch ручным tool-loop — как советует
 * гайд Anthropic для проектов без установленного SDK. Модель — Claude Haiku
 * 4.5: команду понимает, SQL под guard'ом генерит надёжно, стоит копейки.
 *
 * Инструментов ровно два, и оба безопасны by design:
 *   sprosi_bazu     — читающий SELECT (read-only, см. tools.isReadOnlySelect);
 *   pometit_zdanie  — добавить вердикт Димы к зданию (append-only verdicts).
 * Удалить, перезаписать площадь, снести таблицу модель не может — нет тула.
 */
import { queryBase, recordVerdict, VERDICTS } from './tools.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_STEPS = 6; // потолок витков tool-loop, чтобы не зациклиться

// Что Дима видит в базе — чтобы модель писала SELECT по реальным колонкам.
// Структура — единая «База» со столбцом «Тип объекта» + очередь «На проверку».
const SCHEMA_HINT = `Схема vitrina (листы Димы, читать через sprosi_bazu):
- "База": "Тип объекта","Название","Адрес","Площадь, м²","Этажей","Координаты","Подтверждён","Источник","Ключ"
    ("Тип объекта" = БЦ | Офисное здание | Офис компании | ВУЗ | Колледж | НИИ). Это главный список лидов.
- "На проверку": "Что это","Название","Адрес","Площадь, м²","Этажей","Координаты","Почему на проверке","Решение (ОК / Хуй)","Ключ"
    ("Что это" = внешний БЦ | реестр: профиль неясен). Очередь на ОК/Хуй.
- "БЦ средние 5-10к": "Название БЦ","Адрес","Общая площадь, м²","Этажей","Год постройки","Подтверждён","Кадастровый номер"
- "ТЦ с супермаркетом": "Название ТЦ","Адрес","Продуктовый супермаркет","Общая площадь, м²","Этажей","Кадастровый номер"
- "Конкуренты": "Сеть","Адрес","Статус","Источник","Впервые увидели","Последний раз видели"
- "Открытые точки"/"Закрытые точки": "Название","Адрес","Координаты","Загружено" (точки МИЛТИ, справочно)
Имена листов и колонок — в двойных кавычках, площадь числовая. Пример:
SELECT "Тип объекта","Название","Адрес","Площадь, м²" FROM "База" WHERE "Тип объекта"='БЦ' AND "Площадь, м²" >= 50000 ORDER BY "Площадь, м²" DESC`;

const SYSTEM = `Ты — помощник Димы, директора по развитию сети готовой еды МИЛТИ.
База КОСМОС — лиды: где открыть точку. Отвечай кратко, по-русски, для телефона:
несколько строк, без Markdown-таблиц. Если строк много — покажи первые и скажи сколько всего.

Чтение — инструментом sprosi_bazu (обычный SQL SELECT).
${SCHEMA_HINT}

Пометки Димы — инструментом pometit_zdanie: вердикт и заметка, по ключу здания
(колонка "Ключ" в "База"/"На проверку" или "Кадастровый номер" в других листах).
Дима говорит просто «ОК» или «Хуй» — переводи так:
  ОК → "интересно"  (объект подтверждён, попадёт в Базу);
  Хуй → "отказ"     (объект отклонён, исчезнет из списков).
Ещё можно "не_наш_формат" и "проверить". Прежде чем пометить — найди здание через
sprosi_bazu и возьми его "Ключ"/"Кадастровый номер" (ключи внешних объектов вида
'ext:...' тоже годятся; ключи вида 'place:...' — это ВУЗ/НИИ, для них пометка не работает).

Никогда не выдумывай данные — бери из базы. Если чего-то нет — так и скажи.`;

const TOOLS = [
  {
    name: 'sprosi_bazu',
    description: 'Выполнить читающий SQL SELECT против схемы vitrina и вернуть строки. Только чтение.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'Один SELECT-запрос' } },
      required: ['sql'],
    },
  },
  {
    name: 'pometit_zdanie',
    description: 'Добавить вердикт Димы к зданию по ключу (ОК→интересно, Хуй→отказ).',
    input_schema: {
      type: 'object',
      properties: {
        cadastral_no: { type: 'string', description: 'Ключ здания: "Ключ" из База/На проверку (в т.ч. ext:...) или "Кадастровый номер"' },
        verdict: { type: 'string', enum: VERDICTS },
        note: { type: 'string', description: 'Заметка Димы (необязательно)' },
      },
      required: ['cadastral_no', 'verdict'],
    },
  },
];

async function callClaude(config, messages) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.botModel,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Выполнить один инструмент, вернуть текст результата (или ошибку — модель
// её увидит и переиграет). Инвариант «сбой не молчит» соблюдён: ошибка
// возвращается как is_error, а не проглатывается.
async function runTool(registry, author, name, input) {
  try {
    if (name === 'sprosi_bazu') {
      const rows = await queryBase(registry, input.sql);
      return { text: rows.length ? JSON.stringify(rows) : 'пусто: строк нет', isError: false };
    }
    if (name === 'pometit_zdanie') {
      const r = await recordVerdict(registry, {
        cadastralNo: input.cadastral_no,
        verdict: input.verdict,
        note: input.note ?? null,
        author,
      });
      return { text: `помечено: «${r.title || input.cadastral_no}» → ${input.verdict}`, isError: false };
    }
    return { text: `неизвестный инструмент ${name}`, isError: true };
  } catch (e) {
    return { text: String(e.message || e), isError: true };
  }
}

/**
 * Ответить на сообщение Димы. Ведёт tool-loop до финального текста.
 *
 * @param {object} config — loadConfig()
 * @param {import('../lib/registry.js').Registry} registry
 * @param {{text: string, author: string, history?: object[]}} req
 * @returns {Promise<{reply: string, history: object[]}>}
 */
export async function answer(config, registry, { text, author, history = [] }) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY не задан');
  const messages = [...history, { role: 'user', content: text }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await callClaude(config, messages);
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason !== 'tool_use') {
      const reply = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply: reply || '(пустой ответ)', history: messages };
    }

    // Выполнить все запрошенные инструменты, вернуть результаты одним user-ходом.
    const toolResults = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const out = await runTool(registry, author, block.name, block.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: out.text,
        is_error: out.isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { reply: 'не смог довести до ответа за отведённые шаги — переформулируй, пожалуйста', history: messages };
}
