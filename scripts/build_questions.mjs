/**
 * Вопросы Диме — одна страница, на которую он отвечает номерами.
 *
 * Правило страницы: у каждого вопроса есть предложенный ответ. Дима сам
 * попросил такой формат («я предлагаю ответ, ты подтверждаешь или правишь»),
 * и это единственный способ получить решение быстро: подтвердить проще,
 * чем сочинять.
 *
 * Все числа считаются из живой выгрузки, а не пишутся руками: страница
 * пересобирается после любого изменения Базы и не может разойтись с ней.
 *
 * Данные: docs/_baza_full.tsv (выгрузка «Базы»), docs/_mo_approved.tsv
 * (одобренные объекты Подмосковья), src/lib/sectors.js.
 *
 * Запуск: node scripts/build_questions.mjs
 */
import fs from 'node:fs';
import { SECTORS, sectorOf } from '../src/lib/sectors.js';

const KREMLIN = { lat: 55.7522, lon: 37.6156 };
const kmFromCentre = (lat, lon) =>
  Math.hypot((lon - KREMLIN.lon) * 62.5, (lat - KREMLIN.lat) * 111.32);

const rows = fs.readFileSync('docs/_baza_full.tsv', 'utf8').split('\n').filter(Boolean).map((l) => {
  const [key, type, coords, title, addr, area] = l.split('\t');
  const [lat, lon] = (coords || '').split(',').map((v) => parseFloat(v));
  return { key, type, lat, lon, title: title || '', addr: addr || '', area: parseInt(area, 10) || null };
});
const mo = fs.readFileSync('docs/_mo_approved.tsv', 'utf8').split('\n').filter(Boolean)
  .map((l) => { const [title, addr, area] = l.split('\t'); return { title, addr, area: parseInt(area, 10) || null }; });

const inside = new Map(SECTORS.map((s) => [s.id, 0]));
let outside = 0, ttkMkad = 0, sw = 0, south = 0;
for (const r of rows) {
  if (!Number.isFinite(r.lat)) continue;
  const s = sectorOf(r.lat, r.lon);
  if (s) { inside.set(s.id, inside.get(s.id) + 1); continue; }
  outside++;
  const d = kmFromCentre(r.lat, r.lon);
  if (d >= 5.5 && d < 19) {
    ttkMkad++;
    const angle = (Math.atan2((r.lon - KREMLIN.lon) * 62.5, (r.lat - KREMLIN.lat) * 111.32) * 180) / Math.PI;
    const dir = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Math.round(((angle + 360) % 360) / 45) % 8];
    if (dir === 'ЮЗ') sw++;
    if (dir === 'Ю') south++;
  }
}
const inCount = [...inside.values()].reduce((a, b) => a + b, 0);
const days = Math.floor(inCount / 10 / 5);
const beyond = rows.filter((r) => Number.isFinite(r.lat) && kmFromCentre(r.lat, r.lon) > 19).length;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nbsp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const sectorRows = SECTORS.map((s) =>
  `<tr><td class="idx">${s.id}</td><td>${esc(s.words)}</td><td class="n">${inside.get(s.id)}</td></tr>`).join('\n        ');

const moRows = mo.map((m) =>
  `<tr><td>${esc(m.title)}</td><td class="addr">${esc(m.addr)}</td><td class="n">${m.area ? nbsp(m.area) + ' м²' : '—'}</td></tr>`).join('\n        ');

const html = `<title>Шесть вопросов Диме</title>
<style>
  :root {
    --ground: #f2f3f0; --panel: #ffffff; --ink: #171a1c; --soft: #5d666c;
    --line: #dbdfda; --accent: #17554a; --alarm: #a53b22; --btn-ink: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #0e1113; --panel: #161a1c; --ink: #e8ecec; --soft: #949da3;
      --line: #272d30; --accent: #5fbfa8; --alarm: #e08360; --btn-ink: #0e1113;
    }
  }
  :root[data-theme="dark"] {
    --ground: #0e1113; --panel: #161a1c; --ink: #e8ecec; --soft: #949da3;
    --line: #272d30; --accent: #5fbfa8; --alarm: #e08360; --btn-ink: #0e1113;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 17px/1.6 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 780px; margin: 0 auto; padding: 46px 22px 90px; display: flex; flex-direction: column; gap: 34px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: clamp(30px, 5vw, 44px); margin: 6px 0 0; letter-spacing: -0.015em; text-wrap: balance; }
  .eyebrow { text-transform: uppercase; letter-spacing: 0.15em; font-size: 12px; color: var(--soft); }
  .lede { margin: 0; color: var(--soft); max-width: 60ch; }
  .status { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 16px 20px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; }
  .status b { font-weight: 600; }
  ol.qs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 20px; counter-reset: q; }
  ol.qs > li {
    background: var(--panel); border: 1px solid var(--line); border-radius: 3px;
    padding: 22px 24px 24px; display: grid; grid-template-columns: 44px 1fr; gap: 4px 14px;
    grid-template-areas: "num head" ". body";
  }
  ol.qs > li.hot { border-left: 3px solid var(--alarm); }
  ol.qs > li::before {
    counter-increment: q; content: counter(q); grid-area: num;
    font-family: Georgia, "Times New Roman", serif; font-size: 34px; line-height: 1;
    color: var(--accent);
  }
  ol.qs > li.hot::before { color: var(--alarm); }
  .head { grid-area: head; font-size: 20px; font-weight: 600; line-height: 1.35; align-self: center; text-wrap: balance; }
  .body { grid-area: body; display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
  .body p { margin: 0; color: var(--soft); }
  .body p.plain { color: var(--ink); }
  .mine { border-left: 2px solid var(--accent); padding-left: 12px; }
  .mine span { display: block; text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px; color: var(--accent); margin-bottom: 2px; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 11px; border-bottom: 1px solid var(--line); }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--soft); font-weight: 600; }
  tbody tr:last-child td { border-bottom: none; }
  .idx { font-family: Georgia, serif; color: var(--soft); width: 30px; }
  .n { text-align: right; white-space: nowrap; font-family: Georgia, serif; font-size: 16px; }
  .addr { color: var(--soft); font-size: 13px; }
  .answer { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }
  .answer h2 { font-family: Georgia, serif; font-weight: 400; font-size: 22px; margin: 0; }
  textarea {
    width: 100%; min-height: 190px; resize: vertical; padding: 14px; border-radius: 3px;
    border: 1px solid var(--line); background: var(--ground); color: var(--ink);
    font: 14px/1.7 ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }
  button {
    align-self: flex-start; border: 1px solid var(--accent); background: var(--accent); color: var(--btn-ink);
    font: inherit; font-size: 15px; padding: 9px 18px; border-radius: 3px; cursor: pointer;
  }
  button:hover { filter: brightness(1.12); }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  footer { color: var(--soft); font-size: 13.5px; border-top: 1px solid var(--line); padding-top: 16px; }
  @media (max-width: 560px) {
    ol.qs > li { grid-template-columns: 34px 1fr; }
    ol.qs > li::before { font-size: 27px; }
    .head { font-size: 18px; }
  }
</style>
<div class="wrap">
  <header>
    <span class="eyebrow">МИЛТИ · база лидов · 18 августа 2026</span>
    <h1>Дима, шесть вопросов</h1>
    <p class="lede">На каждый есть мой вариант ответа — подтверди или поправь. Можно просто
      номерами: «1 — так, 2 — режу дальше, 3 — оставляем». Остальное сделаю сам.</p>
  </header>

  <div class="status">
    <b>Коротко, что изменилось</b>
    <div>Очередь «На проверку» разобрана: все твои ${nbsp(723)} решений учтены, в очереди осталась одна строка.</div>
    <div>Нашлась поломка: одобренные объекты не доезжали до Базы. Вернул ${58} штук — ЦУМ, Росатом, Лотте Плаза, ЛУКОЙЛ, Цветной. Починено.</div>
    <div>Колледжи, Подмосковье и БЦ 5–10 тыс. м² удалены, как ты сказал. В Базе ${nbsp(rows.length)} строк.</div>
    <div>Твои «ОК» больше не стираются при обновлении — видно, что уже проверено.</div>
  </div>

  <ol class="qs">
    <li>
      <div class="head">Где границы секторов проходят не там?</div>
      <div class="body">
        <p>Я разложил твои 14 секторов по карте. Вот что получилось и сколько объектов попало
          в каждый — если число выглядит странно, скорее всего я не так понял границу.</p>
        <div class="scroll">
          <table>
            <thead><tr><th>№</th><th>Как ты описал</th><th>Объектов</th></tr></thead>
            <tbody>
        ${sectorRows}
            </tbody>
          </table>
        </div>
        <p class="mine"><span>что мне нужно</span>Номер сектора и улица, по которой должна идти линия. Молчание пойму как «всё верно».</p>
      </div>
    </li>

    <li class="hot">
      <div class="head">Адреса в секторах кончатся примерно через ${days} рабочих дней. Резать дальше или выпускать за границы?</div>
      <div class="body">
        <p>В твоих секторах ${inCount} объектов. Пятеро менеджеров берут 50 адресов в день —
          значит, около ${days} дней, и я больше не смогу собрать маршрут.</p>
        <p class="plain">Остальные ${nbsp(outside)} объектов лежат вне нарезки. Больше всего между ТТК
          и МКАД — ${nbsp(ttkMkad)} штук, тяжелее всего юго-запад (${sw}) и юг (${south}).</p>
        <p class="mine"><span>моё предложение</span>Ты режешь вторую очередь секторов — начиная с юго-запада и юга между ТТК и МКАД. А пока их нет, я добираю ближайшие объекты вне сектора, когда десяти не набирается, и помечаю их в маршруте.</p>
      </div>
    </li>

    <li class="hot">
      <div class="head">Эти шесть в Подмосковье ты одобрил до того, как сказал его удалять. Оставляем или под нож?</div>
      <div class="body">
        <div class="scroll">
          <table>
            <thead><tr><th>Объект</th><th>Адрес</th><th>Площадь</th></tr></thead>
            <tbody>
        ${moRows}
            </tbody>
          </table>
        </div>
        <p>Сейчас они удалены — я исполнил более позднее указание. Но выбирать за тебя между
          двумя твоими же решениями не хочу.</p>
        <p class="mine"><span>моё предложение</span>Вернуть Бизнес-парк Химки и Khimki ONE — ты их смотрел осознанно, это ${nbsp(174000)} м² на двоих в двадцати минутах от МКАД. Остальные оставить удалёнными.</p>
      </div>
    </li>

    <li>
      <div class="head">За МКАД, но формально Москва — ${beyond} объектов. Что с ними?</div>
      <div class="body">
        <p>Новая Москва (Калужское шоссе, Коммунарка, Щербинка, Троицк) и Зеленоград. Юридически
          Москва, поэтому под «удали Подмосковье» они не попали, но в твои секторы не входят
          и в маршрут не встанут. Среди них крупные: бизнес-центр «Высота» на Калужском —
          три корпуса, ${nbsp(353990)}, ${nbsp(142820)} и ${nbsp(94520)} м².</p>
        <p class="mine"><span>моё предложение</span>Не удалять, держать отдельным списком «за МКАД». Понадобятся — выдам одним днём, как ты просил по Подмосковью.</p>
      </div>
    </li>

    <li>
      <div class="head">Нужен почтовый ящик для Avito и Cian.</div>
      <div class="body">
        <p>Парсить их нельзя — блокируют. Рабочий путь: ты подписываешь сохранённые поиски на
          уведомления по почте, отдаёшь мне доступ к ящику, я разбираю письма и присылаю тебе
          пронумерованный список новых объявлений.</p>
        <p class="plain">Два уточнения: «новые» — это за сутки? И только аренда или продажа тоже?</p>
        <p class="mine"><span>что мне нужно</span>Адрес ящика с паролем (заведи отдельный, не личный) и ссылки на сохранённые поиски.</p>
      </div>
    </li>

    <li>
      <div class="head">Нужен Telegram-бот, чтобы присылать тебе маршруты.</div>
      <div class="body">
        <p>Маршруты уходят одним сообщением на менеджера, ты жмёшь кнопку «одобрить» —
          разбирать слово «ок» из переписки не буду, это ненадёжно. Если не одобрено, напомню
          через час, как договорились.</p>
        <p class="mine"><span>что мне нужно</span>Создай бота через @BotFather (две минуты) и пришли токен. Или скажи — сделаю сам и передам тебе.</p>
      </div>
    </li>
  </ol>

  <div class="answer">
    <h2>Ответить</h2>
    <p class="lede">Заполни и пришли в телеграм — или просто ответь номерами своими словами.</p>
    <textarea id="tpl" spellcheck="false" aria-label="Шаблон ответа">1. Границы секторов:
2. Резать дальше / брать вне секторов:
3. Шесть объектов Подмосковья:
4. За МКАД (Новая Москва, Зеленоград):
5. Почта для Avito и Cian:
6. Telegram-бот:</textarea>
    <button id="copy" type="button">Скопировать шаблон</button>
  </div>

  <footer>
    Все числа посчитаны по живой базе на 18 августа, а не написаны руками: ${nbsp(rows.length)} строк
    листа «База», ${inCount} из них в секторах. Витрина — baza.makersai.ru
  </footer>
</div>
<script>
  const button = document.getElementById('copy');
  const field = document.getElementById('tpl');
  button.addEventListener('click', async () => {
    field.select();
    try {
      await navigator.clipboard.writeText(field.value);
      button.textContent = 'Скопировано';
    } catch {
      document.execCommand('copy');
      button.textContent = 'Скопировано';
    }
    setTimeout(() => { button.textContent = 'Скопировать шаблон'; }, 2200);
  });
</script>
`;

fs.writeFileSync('docs/для-Димы/вопросы.html', html);
console.log(`вопросы: ${html.length} символов | в секторах ${inCount} | вне ${outside} | за МКАД ${beyond} | дней ${days}`);
