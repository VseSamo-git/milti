-- Лист 7 «Конкуренты»: показать, откуда точка и насколько полон источник.
--
-- К восьми сетям со store-locator'ов добавились три вторичные из OSM
-- (drinkit, здрасте, parle market) — их локатор за анти-ботом или его нет,
-- обход не встраиваем. OSM неполон (drinkit 48 из ~116, здрасте 21 из ~111,
-- parle 3 из ~24), поэтому Дима должен видеть разницу: по первичным сетям
-- список полный, по вторичным — выборка, где «нет точки» ≠ «нет заведения».
--
-- Технический ключ source ('osm_secondary', домены сетей) Диме не нужен —
-- выводим человекочитаемую метку. Вторичные сети в «возможно закрылась»
-- не попадают по построению (см. markMissingPlaces), но на всякий случай
-- статус для них тут не драматизируем.

DROP VIEW IF EXISTS vitrina."7 Конкуренты";
CREATE VIEW vitrina."7 Конкуренты" AS
SELECT
    p.chain                                                  AS "Сеть",
    coalesce(p.address, nullif(trim(coalesce(p.street, '') || ' ' || coalesce(p.house, '')), ''))
                                                             AS "Адрес",
    CASE p.status
        WHEN 'активна'              THEN 'работает'
        WHEN 'кандидат_на_закрытие' THEN 'возможно закрылась'
        ELSE p.status
    END                                                      AS "Статус",
    CASE
        WHEN p.source = 'osm_secondary'
            THEN 'OpenStreetMap — выборка, неполно'
        ELSE 'store-locator сети — полно'
    END                                                      AS "Источник",
    to_char(p.first_seen_at, 'DD.MM.YYYY')                   AS "Впервые увидели",
    to_char(p.last_seen_at, 'DD.MM.YYYY')                    AS "Последний раз видели"
FROM kosmos.places p
WHERE p.kind = 'конкурент'
ORDER BY p.chain, p.address NULLS LAST;
