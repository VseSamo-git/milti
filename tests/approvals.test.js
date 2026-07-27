import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyReply, shouldRemind, matchReply } from '../src/lib/approvals.js';

// --- classifyReply: во что превратить ответ Димы -------------------------

test('classifyReply: «ок» в любом регистре и с пунктуацией — одобрение', () => {
  for (const t of ['ок', 'Ок', 'ОК!', 'ok', 'да', ' ок. ']) {
    assert.equal(classifyReply({ text: t }).kind, 'approve', `«${t}»`);
  }
});

test('classifyReply: голосовое сообщение — правка (нужна транскрипция)', () => {
  const r = classifyReply({ hasVoice: true });
  assert.equal(r.kind, 'edit');
  assert.equal(r.needsTranscription, true);
});

test('classifyReply: список номеров — выбор объявлений', () => {
  assert.deepEqual(classifyReply({ text: '1, 3, 5' }), { kind: 'select', numbers: [1, 3, 5] });
  assert.deepEqual(classifyReply({ text: '2 4' }), { kind: 'select', numbers: [2, 4] });
});

test('classifyReply: осмысленный текст (не «ок», не номера) — правка', () => {
  const r = classifyReply({ text: 'перенеси второй объект на завтра' });
  assert.equal(r.kind, 'edit');
});

test('classifyReply: пусто и без голоса — не понял', () => {
  assert.equal(classifyReply({ text: '' }).kind, 'unknown');
  assert.equal(classifyReply({}).kind, 'unknown');
});

// --- shouldRemind: пора ли напоминать про неодобренное -------------------

const H = 3600_000; // час в мс

test('shouldRemind: «sent» дольше интервала и лимит не исчерпан — напоминаем', () => {
  const rec = { status: 'sent', lastSentAt: 0, remindersSent: 0 };
  assert.equal(shouldRemind(rec, { now: 3 * H, intervalHours: 2, maxReminders: 3 }), true);
});

test('shouldRemind: интервал ещё не прошёл — молчим', () => {
  const rec = { status: 'sent', lastSentAt: 0, remindersSent: 0 };
  assert.equal(shouldRemind(rec, { now: 1 * H, intervalHours: 2, maxReminders: 3 }), false);
});

test('shouldRemind: уже одобрено — никаких напоминаний', () => {
  const rec = { status: 'approved', lastSentAt: 0, remindersSent: 0 };
  assert.equal(shouldRemind(rec, { now: 99 * H, intervalHours: 2, maxReminders: 3 }), false);
});

test('shouldRemind: лимит напоминаний исчерпан — прекращаем', () => {
  const rec = { status: 'sent', lastSentAt: 0, remindersSent: 3 };
  assert.equal(shouldRemind(rec, { now: 99 * H, intervalHours: 2, maxReminders: 3 }), false);
});

// --- matchReply: к какому отправленному относится ответ ------------------

const pending = [
  { id: 1, kind: 'route', messageId: 100, status: 'sent', sentAt: 10 },
  { id: 2, kind: 'route', messageId: 200, status: 'sent', sentAt: 30 },
  { id: 3, kind: 'monitoring', messageId: 300, status: 'sent', sentAt: 20 },
];

test('matchReply: reply-to точно указывает на своё сообщение', () => {
  const r = matchReply({ replyToId: 100 }, pending);
  assert.equal(r.id, 1);
});

test('matchReply: без reply-to берём самое свежее отправленное', () => {
  const r = matchReply({ text: 'ок' }, pending);
  assert.equal(r.id, 2); // sentAt=30 — позже всех
});

test('matchReply: нечего ждать — null', () => {
  assert.equal(matchReply({ text: 'ок' }, []), null);
});
