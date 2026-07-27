-- Движок одобрений: состояние «бот отправил → ждёт вердикт Димы → напоминает».
-- Ядро обеих задач (маршруты и мониторинг Avito/Cian). Логика решений — в
-- src/lib/approvals.js (чистая, покрыта тестами); эта таблица хранит ожидание.
--
-- ПОЧЕМУ отдельная таблица. Текущий бот stateless: спросили — ответил, забыл.
-- Здесь нужна память ожидания и соотнесение ответа с ранее отправленным
-- сообщением (по reply-to или по самому свежему 'sent'). Без неё нельзя ни
-- напоминать о неодобренном, ни понимать, к чему относится «ок» или голос.
--
-- Это НЕ реестр объектов — инвариант провенанса (area_source и т.п.) сюда не
-- относится: таблица про переписку, а не про данные о зданиях.

CREATE TABLE IF NOT EXISTS kosmos.approvals (
    id              BIGSERIAL PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('route', 'monitoring')),
    target_date     DATE NOT NULL,               -- на какую дату маршрут/сводка
    subject         TEXT NOT NULL,               -- имя менеджера или 'avito-cian'
    payload         JSONB NOT NULL,              -- сам маршрут / список ссылок
    message_id      BIGINT,                      -- id отправленного telegram-сообщения
    status          TEXT NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent', 'approved', 'edited')),
    reminders_sent  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одна запись на (вид, дата, субъект): переотправка правит ту же строку.
CREATE UNIQUE INDEX IF NOT EXISTS approvals_uniq
    ON kosmos.approvals (kind, target_date, subject);

-- Крон-напоминалка ищет ожидающие: WHERE status='sent'.
CREATE INDEX IF NOT EXISTS approvals_pending
    ON kosmos.approvals (status) WHERE status = 'sent';

-- Ответ Димы прилетает reply-to на message_id — ищем по нему.
CREATE INDEX IF NOT EXISTS approvals_message_id
    ON kosmos.approvals (message_id);
