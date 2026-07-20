-- Источник адреса точки.
--
-- Адрес у точки может приехать тремя разными путями, и доверие к ним разное:
--   store_locator  — сайт самой сети, адрес как она его публикует;
--   osm            — теги addr:street/addr:housenumber, заполняются редко;
--   addr_registry  — подставлен нами по ближайшему зданию из адресного
--                    реестра Москвы, то есть ВЫВЕДЕН, а не сообщён.
--
-- Последний случай — единственный, где адрес получен догадкой (пусть и
-- геометрически обоснованной). Дима должен видеть разницу: «сеть говорит,
-- что она здесь» и «мы решили, что это вот то здание» — разные утверждения.
--
-- Как и везде в КОСМОСе: значение без источника недопустимо, но NULL
-- легитимен. Констрейнт требует источник только когда адрес есть.

ALTER TABLE kosmos.places
    ADD COLUMN IF NOT EXISTS address_source TEXT,
    ADD COLUMN IF NOT EXISTS address_distance_m NUMERIC;

-- Задним числом проставляем источник тем адресам, что уже лежат в базе:
-- они пришли со store-locator'ов вместе с самой точкой.
UPDATE kosmos.places
   SET address_source = source
 WHERE address IS NOT NULL AND address_source IS NULL;

ALTER TABLE kosmos.places
    DROP CONSTRAINT IF EXISTS address_needs_source;

ALTER TABLE kosmos.places
    ADD CONSTRAINT address_needs_source
    CHECK (address IS NULL OR address_source IS NOT NULL);

COMMENT ON COLUMN kosmos.places.address_source IS
    'Откуда адрес: имя store-locator''а, osm или addr_registry (выведен по ближайшему зданию)';
COMMENT ON COLUMN kosmos.places.address_distance_m IS
    'Для addr_registry: расстояние до центра здания в метрах. Чем больше, тем слабее догадка';
