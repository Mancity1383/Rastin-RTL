import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Chromium shapes a real Persian font before producing the PDF. This exercises
// PDF.js's original positioned glyphs and Unicode maps, rather than drawing
// Latin glyphs and merely substituting Persian characters in ToUnicode.
export async function persianPdf(context, pageCount = 8) {
  const font = await fs.readFile(path.join(root, 'fonts/Vazirmatn-Regular.woff2'));
  const print = await context.newPage();
  try {
    await print.setContent(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
      @font-face { font-family: Fixture; src: url(data:font/woff2;base64,${font.toString('base64')}); }
      @page { size: 600px 850px; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Fixture; }
      section { position: relative; height: 850px; break-after: page; }
      section:last-child { break-after: auto; }
      p { position: absolute; right: 42px; left: 42px; margin: 0; font-size: 22px; line-height: 1.8; }
      .first { top: 78px; } .mixed { top: 144px; } .third { top: 214px; }
      .lower { top: 718px; } .number { top: 30px; font-size: 12px; color: #777; }
    </style></head><body>${Array.from({ length: pageCount }, (_, index) => `<section>
      <p class="number">صفحه ${index + 1}</p>
      <p class="first">انتخاب متن فارسی روی همان سند آسان است.</p>
      <p class="mixed">در PDF Reader متن فارسی و English با هم هستند.</p>
      <p class="third">این خط دوم برای انتخاب چند خط نوشته شده است.</p>
      <p class="lower">نشانه پایین صفحه برای پرش دقیق</p>
    </section>`).join('')}</body></html>`);
    await print.evaluate(() => document.fonts.ready);
    return await print.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await print.close();
  }
}

export function scannedPdf() {
  const stream = 'q 500 0 0 710 50 45 cm BI /W 2 /H 2 /BPC 8 /CS /RGB /F /ASCIIHexDecode ID 2a407fd3dbebf1f5fa3e649b> EI Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
