-- Внешние БЦ (Арендатор / Макс / Excel-новостройки) не из перечня 700-ПП:
-- у них нет кадастрового номера и annex. Ключим синтетическим
-- cadastral_no = 'ext:<код>:<lat,lon>', а источник храним в origin —
-- так витрина отделяет реестровые объекты (origin IS NULL) от внешних
-- одним предикатом, без разбора строки ключа.
--
-- origin: NULL = объект из реестра 700-ПП; иначе 'arendator' | 'max' | 'excel2025'.
ALTER TABLE kosmos.objects ADD COLUMN IF NOT EXISTS origin TEXT;

CREATE INDEX IF NOT EXISTS objects_origin_idx ON kosmos.objects (origin);

COMMENT ON COLUMN kosmos.objects.origin IS
  'Источник внешнего объекта (arendator/max/excel2025). NULL = реестр 700-ПП.';
