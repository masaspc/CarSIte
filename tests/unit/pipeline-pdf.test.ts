import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@/pipeline/pdf';

/**
 * 最小のPDFをその場で組み立てる。外部ファイルに依存させないためで、
 * 実物の諸元表に対する検証は tests/unit/golden-pdf.test.ts が行う。
 */
function minimalPdf(pageCount: number): Uint8Array {
  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');

  objects.push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  objects.push(`2 0 obj<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>endobj\n`);
  for (let i = 0; i < pageCount; i++) {
    objects.push(`${3 + i} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n`);
  }

  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

describe('countPdfPages', () => {
  it('ページ数を返す', async () => {
    await expect(countPdfPages(minimalPdf(6))).resolves.toBe(6);
  });

  it('1ページのPDFも数えられる', async () => {
    await expect(countPdfPages(minimalPdf(1))).resolves.toBe(1);
  });

  it('呼び出し側のバイト列を破壊しない', async () => {
    // PDF.js は渡されたバッファの所有権を奪い、長さ0にしてしまう。
    // 複製せずに渡すと、ページ数を数えた直後に本体が消え、
    // sha256 もマジックナンバーの検査も空データに対して行われることになる。
    const bytes = minimalPdf(6);
    const before = bytes.length;

    await countPdfPages(bytes);

    expect(bytes.length).toBe(before);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('二度続けて呼んでも同じ結果になる', async () => {
    const bytes = minimalPdf(6);
    expect(await countPdfPages(bytes)).toBe(6);
    expect(await countPdfPages(bytes)).toBe(6);
  });

  it('PDFとして読めないものは例外', async () => {
    await expect(countPdfPages(new TextEncoder().encode('<html>404</html>'))).rejects.toThrow();
  });
});
