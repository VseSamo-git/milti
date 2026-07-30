import test from 'node:test';
import assert from 'node:assert/strict';
import { addrKey, nameKey, dupKey } from '../src/lib/addr_key.js';

test('addrKey: один дом, записанный четырьмя источниками по-разному', () => {
  const k = addrKey('ул. Бутырская, д. 77');
  assert.equal(addrKey('улица Бутырская, дом 77'), k);
  assert.equal(addrKey('Бутырская ул., 77'), k);
  assert.equal(addrKey('г. Москва, Бутырская улица, д 77'), k);
});

test('addrKey: разные дома на одной улице не склеиваются', () => {
  assert.notEqual(addrKey('ул. Бутырская, д. 77'), addrKey('ул. Бутырская, д. 78'));
});

test('addrKey: корпус — часть ключа', () => {
  assert.equal(addrKey('Звёздный бул., д. 19с2'), addrKey('Звездный бульвар, дом 19, строение 2'));
  assert.notEqual(addrKey('Звездный бульвар, дом 19, строение 1'),
                  addrKey('Звездный бульвар, дом 19, строение 2'));
});

test('addrKey: «земельный участок» = дом (реестр пишет и так)', () => {
  assert.equal(addrKey('улица Миклухо-Маклая, земельный участок 27'),
               addrKey('ул. Миклухо-Маклая, д. 27'));
});

test('addrKey: без номера дома ключа нет — по одной улице не склеиваем', () => {
  assert.equal(addrKey('Бутырская улица'), null);
  assert.equal(addrKey(''), null);
  assert.equal(addrKey(null), null);
});

test('nameKey: родовые слова не различают объекты', () => {
  assert.equal(nameKey('БЦ «Оружейный»'), nameKey('Бизнес-центр Оружейный'));
  assert.equal(nameKey('Оружейный'), nameKey('БЦ Оружейный'));
});

test('nameKey: пустышки не становятся ключом', () => {
  assert.equal(nameKey('(без названия)'), null);
  assert.equal(nameKey('БЦ'), null);
  assert.equal(nameKey(null), null);
});

test('dupKey: дубль только при совпадении И названия, И адреса', () => {
  const a = dupKey('БЦ Оружейный', 'переулок Оружейный, дом 41');
  assert.equal(dupKey('Бизнес-центр «Оружейный»', 'Оружейный пер., д. 41'), a);
  assert.notEqual(dupKey('БЦ Оружейный', 'Оружейный пер., д. 43'), a);
  assert.notEqual(dupKey('БЦ Белая площадь', 'Оружейный пер., д. 41'), a);
});

test('dupKey: без названия или без адреса дубль не объявляем', () => {
  assert.equal(dupKey('(без названия)', 'Оружейный пер., д. 41'), null);
  assert.equal(dupKey('БЦ Оружейный', null), null);
});
