/**
 * Чистая логика движка одобрений — ядро обеих задач Димы (маршруты и мониторинг).
 * Без БД и Telegram: только решения. Побочные эффекты (SQL, sendMessage) — снаружи.
 */

const APPROVE_RE = /^(ок|окей|ok|okay|да|принято|согласен|👍)[\s.!]*$/i;
const NUMBERS_ONLY_RE = /^[\s\d,.;]+$/;

/**
 * Во что превратить ответ Димы.
 * @param {{text?: string, hasVoice?: boolean}} msg
 * @returns {{kind: 'approve'|'select'|'edit'|'unknown', numbers?: number[], needsTranscription?: boolean}}
 */
export function classifyReply(msg = {}) {
  if (msg.hasVoice) return { kind: 'edit', needsTranscription: true };
  const text = (msg.text || '').trim();
  if (!text) return { kind: 'unknown' };
  if (APPROVE_RE.test(text)) return { kind: 'approve' };
  if (NUMBERS_ONLY_RE.test(text)) {
    const numbers = text.match(/\d+/g).map(Number);
    return { kind: 'select', numbers };
  }
  return { kind: 'edit' };
}

/**
 * Пора ли напоминать про неодобренное.
 * @param {{status: string, lastSentAt: number, remindersSent: number}} record
 * @param {{now: number, intervalHours: number, maxReminders: number}} opts
 */
export function shouldRemind(record, { now, intervalHours, maxReminders }) {
  if (record.status !== 'sent') return false;
  if (record.remindersSent >= maxReminders) return false;
  return now - record.lastSentAt >= intervalHours * 3600_000;
}

/**
 * К какому отправленному сообщению относится ответ Димы.
 * reply-to — точный якорь; иначе берём самое свежее ожидающее.
 * @param {{replyToId?: number}} reply
 * @param {Array<{messageId: number, status: string, sentAt: number}>} pending
 * @returns {object|null}
 */
export function matchReply(reply, pending) {
  if (reply.replyToId != null) {
    const exact = pending.find((p) => p.messageId === reply.replyToId);
    if (exact) return exact;
  }
  const waiting = pending.filter((p) => p.status === 'sent');
  if (waiting.length === 0) return null;
  return waiting.reduce((a, b) => (b.sentAt > a.sentAt ? b : a));
}
