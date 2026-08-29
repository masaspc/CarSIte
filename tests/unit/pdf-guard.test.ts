import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PdfRejectedError,
  assertPdfAcceptable,
  isEncryptedPdf,
  looksLikePdf,
} from '@/lib/pdf-guard';

const PDF_HEADER = new TextEncoder().encode('%PDF-1.7\n');

function candidate(overrides: Partial<Parameters<typeof assertPdfAcceptable>[0]> = {}) {
  return {
    contentType: 'application/pdf',
    bytes: PDF_HEADER,
    pageCount: 6,
    ...overrides,
  };
}

describe('looksLikePdf', () => {
  it('%PDF- で始まれば真', () => {
    expect(looksLikePdf(PDF_HEADER)).toBe(true);
  });

  it('HTMLのエラーページは偽', () => {
    expect(looksLikePdf(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false);
  });

  it('空バイト列は偽', () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe('isEncryptedPdf', () => {
  it('トレーラに /Encrypt があれば真', () => {
    // 実物のトヨタ諸元表と同じ形。編集制限のため暗号化されている
    const bytes = new TextEncoder().encode(
      '%PDF-1.7\n3745 0 obj\r<</DecodeParms<</Columns 4>>/Encrypt 3721 0 R/Filter/FlateDecode>>',
    );
    expect(isEncryptedPdf(bytes)).toBe(true);
  });

  it('無ければ偽', () => {
    expect(isEncryptedPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj<</Type/Catalog>>'))).toBe(
      false,
    );
  });

  it('暗号化されていても拒否はしない（読めるものは通す）', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n/Encrypt 1 0 R');
    expect(() => assertPdfAcceptable(candidate({ bytes }))).not.toThrow();
  });
});

describe('assertPdfAcceptable', () => {
  it('正常な諸元表は通る', () => {
    expect(() => assertPdfAcceptable(candidate())).not.toThrow();
  });

  it('Content-Type が application/pdf でなければ拒否', () => {
    expect(() => assertPdfAcceptable(candidate({ contentType: 'text/html' }))).toThrow(
      PdfRejectedError,
    );
  });

  it('charset 付きの Content-Type は通す', () => {
    expect(() =>
      assertPdfAcceptable(candidate({ contentType: 'application/pdf; charset=binary' })),
    ).not.toThrow();
  });

  it('マジックナンバーが違えば拒否（404のHTMLを掴んだ場合）', () => {
    expect(() =>
      assertPdfAcceptable(candidate({ bytes: new TextEncoder().encode('<html>404</html>') })),
    ).toThrow(PdfRejectedError);
  });

  it('サイズ上限を超えたら拒否', () => {
    const huge = new Uint8Array(MAX_PDF_BYTES + 1);
    huge.set(PDF_HEADER);
    expect(() => assertPdfAcceptable(candidate({ bytes: huge }))).toThrow(/10/);
  });

  it('サイズが上限ちょうどなら通す', () => {
    const exact = new Uint8Array(MAX_PDF_BYTES);
    exact.set(PDF_HEADER);
    expect(() => assertPdfAcceptable(candidate({ bytes: exact }))).not.toThrow();
  });

  it('ページ数上限を超えたら拒否（取説PDFを掴んだ場合）', () => {
    expect(() => assertPdfAcceptable(candidate({ pageCount: MAX_PDF_PAGES + 1 }))).toThrow(
      /ページ/,
    );
  });

  it('ページ数0は拒否', () => {
    expect(() => assertPdfAcceptable(candidate({ pageCount: 0 }))).toThrow(PdfRejectedError);
  });

  it('拒否の理由がメッセージに入る', () => {
    expect(() => assertPdfAcceptable(candidate({ contentType: 'text/html' }))).toThrow(
      /text\/html/,
    );
  });
});
