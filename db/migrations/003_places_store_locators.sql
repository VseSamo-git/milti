-- Конкуренты переезжают с OpenStreetMap на store-locator'ы самих сетей.
--
-- ПОЧЕМУ. OSM — краудсорсинг: покрытие сети зависит от того, кто её нанёс,
-- а не от её размера. Проверено на живых данных 2026-07-20: French Bakery
-- в OSM — 6 точек при 154 реальных (4%), Правда кофе — 81 из 153 (53%),
-- Prime — 101 при ~70 реальных (144%, регэксп ловил «АЭИ ПРАЙМ», такси,
-- стоматологии). Разброс покрытия 4–141%, предсказать провал нельзя.
-- Первоисточник — сайт самой сети: она знает свои точки точно.
--
-- СЛЕДСТВИЯ ДЛЯ СХЕМЫ:
-- 1. osm_id больше не «osm_id»: для конкурента ключ — 'frenchbakery:arbat',
--    источник — 'frenchbakery.ru', а не OSM. Столбец с именем osm_id,
--    хранящий такое, был бы ложью в схеме. Переименовываем в place_key —
--    универсальный стабильный внешний ключ. Для ВУЗов/НИИ/супермаркетов
--    (по-прежнему OSM) значение остаётся 'node/123' — тоже валидный ключ.
-- 2. Атрибуция ODbL верна только для OSM-точек. Провенанс у каждой строки
--    свой — в столбце source. Комментарий таблицы делаем источник-нейтральным.

ALTER TABLE kosmos.places RENAME COLUMN osm_id TO place_key;

-- Координаты больше не обязательны. French Bakery отдаёт 162 адреса, но
-- координат не публикует НИГДЕ — карту на сайте рисуют геокодированием на лету.
-- Адрес без координат честнее выдуманной точки: NULL легитимен (принцип КОСМОСа).
-- Точки без координат просто не лягут на карту, но список адресов у Димы будет.
ALTER TABLE kosmos.places ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE kosmos.places ALTER COLUMN lon DROP NOT NULL;

-- Достоверность источника. 'high' — сайт самой сети; 'low' — вторичный
-- (карты/агрегаторы для сетей без своего store-locator). Дима видит, чему верить.
ALTER TABLE kosmos.places ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'high'
    CHECK (confidence IN ('high', 'low'));

-- Полный адрес строкой. У OSM-точек адрес собирался из street+house или из
-- связанного здания; store-locator отдаёт готовую строку — храним как есть.
ALTER TABLE kosmos.places ADD COLUMN IF NOT EXISTS address TEXT;

-- Лист «Конкуренты» для Димы: теперь с источником и достоверностью,
-- адрес берём из готовой строки, затем из здания, затем из street+house.
-- DROP перед CREATE: набор колонок меняется, а CREATE OR REPLACE так не умеет.
DROP VIEW IF EXISTS kosmos.v_competitors;
CREATE VIEW kosmos.v_competitors AS
SELECT
    p.chain                                   AS "Сеть",
    p.name                                    AS "Название",
    coalesce(p.address, o.address, nullif(trim(coalesce(p.street, '') || ' ' || coalesce(p.house, '')), '')) AS "Адрес",
    p.status                                  AS "Статус",
    p.source                                  AS "Источник",
    p.confidence                              AS "Достоверность",
    p.first_seen_at::date                     AS "Найдена",
    p.last_seen_at::date                      AS "Последний раз видели",
    p.lat, p.lon
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind = 'конкурент'
ORDER BY p.chain, p.first_seen_at DESC;

COMMENT ON COLUMN kosmos.places.place_key IS
    'Стабильный внешний ключ. OSM: node/way/relation-id. Store-locator: chain:slug. '
    'Источник строки — в столбце source; атрибуция зависит от него.';

COMMENT ON TABLE kosmos.places IS
    'Точки на карте: конкуренты (store-locator'' сетей), ВУЗы, НИИ, супермаркеты (OSM). '
    'Провенанс и лицензия — построчно в столбце source. OSM-строки: © OpenStreetMap contributors, ODbL.';
