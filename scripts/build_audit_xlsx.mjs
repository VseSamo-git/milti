/**
 * Собирает xlsx-аудит из audit.json (выход audit_all_sheets.js --json).
 * Один лист на каждый лист витрины + «Итоги». Без внешних зависимостей:
 * OOXML с инлайновыми строками, упаковка — свой store-only ZIP (CRC32).
 *
 *   node scripts/build_audit_xlsx.mjs <audit.json> <выход.xlsx>
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ---- CRC32 + store-only ZIP ------------------------------------------------
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const locals = [], central = []; let off = 0;
  for (const [name, str] of files) {
    const data = Buffer.from(str, 'utf8'); const nm = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += lh.length + nm.length + data.length;
  }
  const cstart = off; let clen = 0; for (const b of central) clen += b.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(clen, 12); eocd.writeUInt32LE(cstart, 16);
  return Buffer.concat([...locals, ...central, eocd]);
}

// ---- OOXML ------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colRef = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
function sheetXml(rows) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach((row, r) => {
    out.push(`<row r="${r + 1}">`);
    row.forEach((val, c) => {
      const ref = colRef(c) + (r + 1); const num = typeof val === 'number';
      if (num) out.push(`<c r="${ref}"><v>${val}</v></c>`);
      else out.push(`<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(val)}</t></is></c>`);
    });
    out.push('</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

// заголовки колонок для листа данных
const HDR = ['Название', 'Адрес', 'Площадь, м²', 'Этажей', 'Ключ', 'Координаты', 'Справочник (reverse)', 'Флаги', 'Комментарий сверки'];

function main() {
  const [, , inp = 'audit.json', outp = 'БАЗА_аудит_все_листы.xlsx'] = process.argv;
  const data = JSON.parse(readFileSync(inp, 'utf8'));
  const sheetNames = Object.keys(data);

  // Итоги
  const itogi = [['Лист', 'Строк', 'Чистых', '% чистых', 'Топ-флаги']];
  for (const sn of sheetNames) {
    const rows = data[sn]; const fc = {}; let clean = 0;
    for (const x of rows) { const fs = x.flags ? x.flags.split(', ').filter(Boolean) : []; if (!fs.length) clean++; for (const f of fs) fc[f] = (fc[f] || 0) + 1; }
    const top = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join('  ');
    itogi.push([sn, rows.length, clean, Math.round(clean / rows.length * 100) + '%', top]);
  }

  // соберём листы: Итоги первым
  const sheets = [{ name: 'Итоги', rows: itogi }];
  for (const sn of sheetNames) {
    const rows = [HDR];
    for (const x of data[sn]) rows.push([
      x.name, x.addr, x.area === '' ? '' : Number(x.area) || x.area, x.floors === '' ? '' : Number(x.floors) || x.floors,
      x.key, x.lat === '' ? '' : `${x.lat}, ${x.lon}`, x.geo || '', x.flags || '', x.geoNote || '',
    ]);
    // NocoDB/Excel ограничение имени листа 31 симв, без : \ / ? * [ ]
    let nm = sn.replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 31);
    sheets.push({ name: nm, rows });
  }

  // XML части
  const files = [];
  files.push(['[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>']);
  files.push(['_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
  files.push(['xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>']);
  files.push(['xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(['xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>']);
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)]));

  writeFileSync(outp, zip(files));
  console.log(`xlsx готов: ${outp} (${sheets.length} листов)`);
}
main();
