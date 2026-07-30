-- Провенанс адреса объекта: как у мест (004_places_address_source), у объектов
-- адрес мог прийти из реестра 700-ПП (NULL = реестр) или быть добит обратным
-- геокодером OSM. Чтобы происхождение было видно — отдельная колонка.
ALTER TABLE kosmos.objects ADD COLUMN IF NOT EXISTS address_source TEXT;
