// Кадастровые номера режутся кернингом на куски внутри массивов TJ.
// Решение: внутри каждого текстового блока берём только литералы (...)
// и склеиваем их подряд, игнорируя кернинг-числа и hex-глифы кириллицы.
const fs = require('fs'); const zlib = require('zlib');
const buf = fs.readFileSync('pp700-2026.pdf');

const LIT = /\(((?:\.|[^\()])*)\)/g;
let joined = '';
let pos = 0, streams = 0;
while (true) {
  const s = buf.indexOf('stream', pos); if (s === -1) break;
  const e = buf.indexOf('endstream', s); if (e === -1) break;
  let st = s + 6; while (buf[st]===0x0d||buf[st]===0x0a) st++;
  try {
    const c = zlib.inflateSync(buf.subarray(st, e)).toString('latin1');
    if (c.includes('Tj') || c.includes('TJ')) {
      streams++;
      // склеиваем ВСЕ литералы потока подряд: кернинг и глифы просто выпадают
      let m, acc = '';
      LIT.lastIndex = 0;
      while ((m = LIT.exec(c)) !== null) acc += m[1];
      joined += acc + '\n';
    }
  } catch(_) {}
  pos = e + 9;
}

const cads = joined.match(/\d{2}:\d{2}:\d{6,7}:\d+/g) || [];
const uniq = [...new Set(cads)];
console.log('текстовых потоков   :', streams);
console.log('кадастровых номеров :', cads.length);
console.log('уникальных          :', uniq.length);
console.log('примеры             :', uniq.slice(0, 4).join('  '));
const byDistrict = {};
uniq.forEach(c => { const d = c.slice(0,2); byDistrict[d] = (byDistrict[d]||0)+1; });
console.log('по кадастровым округам:', JSON.stringify(byDistrict));
fs.writeFileSync('cadastrals.txt', uniq.join('\n'));
console.log('-> cadastrals.txt');
