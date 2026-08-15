import { describe, expect, it, vi } from 'vitest';
import { fetchAndValidate, findLatestMonth } from '@/pipeline/fetch';
import { USER_AGENT, type Http } from '@/pipeline/http';
import { PdfRejectedError } from '@/lib/pdf-guard';

const BASE = 'https://example.com/prius_spec_';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nfake');

/** 200 を返すURLの集合だけを持つ偽のHTTP */
function fakeHttp(ok: Set<string>, body = PDF_BYTES, contentType = 'application/pdf'): Http {
  return {
    head: async (url) => (ok.has(url) ? 200 : 404),
    get: async (url) =>
      ok.has(url)
        ? { status: 200, contentType, bytes: body }
        : { status: 404, contentType: 'text/html', bytes: new TextEncoder().encode('<html>') },
  };
}

describe('USER_AGENT', () => {
  it('ASCII だけで書かれている', () => {
    // HTTPヘッダの値は ByteString（latin-1）。日本語を入れると fetch が
    // 「Cannot convert argument to a ByteString」で落ちる。
    // 偽のHTTPを使うテストでは再現しないため、文字種そのものを固定する。
    expect(USER_AGENT).toMatch(/^[\x20-\x7E]+$/);
  });

  it('問い合わせの手がかりになる名前を含む', () => {
    expect(USER_AGENT).toContain('CarSiteBot');
  });
});

describe('findLatestMonth', () => {
  it('既知より新しい版があればそれを返す', async () => {
    const http = fakeHttp(new Set([`${BASE}202608.pdf`]));
    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-05' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-08' });
  });

  it('新しい版が無ければ既知の年月を返す（更新なし）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-07' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-07' });
  });

  it('既知も含めて全て404ならベースパスが死んでいる', async () => {
    const http = fakeHttp(new Set());
    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-07' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ deadBaseUrl: true });
  });

  it('初回（既知なし）でも遡って見つけられる', async () => {
    const http = fakeHttp(new Set([`${BASE}202605.pdf`]));
    const result = await findLatestMonth({ pdfBaseUrl: BASE, knownMonth: null }, http, '2026-08');

    expect(result).toEqual({ found: '2026-05' });
  });

  it('初回で1件も見つからなければベースパスが死んでいる', async () => {
    const http = fakeHttp(new Set());
    const result = await findLatestMonth({ pdfBaseUrl: BASE, knownMonth: null }, http, '2026-08');

    expect(result).toEqual({ deadBaseUrl: true });
  });

  it('新しい順に探し、最初に見つかったところで止める', async () => {
    const http = fakeHttp(new Set([`${BASE}202608.pdf`, `${BASE}202606.pdf`]));
    const spy = vi.spyOn(http, 'head');

    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-01' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-08' });
    expect(spy).toHaveBeenCalledTimes(1); // 202607 以前は試さない
  });

  it('既知が今月と同じなら、既知の生存確認だけを行う', async () => {
    const http = fakeHttp(new Set([`${BASE}202608.pdf`]));
    const spy = vi.spyOn(http, 'head');

    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-08' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-08' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('定常状態のリクエスト数は2回で収まる', async () => {
    // 今月ぶんが404 → 既知が200、で終わる。週1回×150件でも負荷にならない
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const spy = vi.spyOn(http, 'head');

    await findLatestMonth({ pdfBaseUrl: BASE, knownMonth: '2026-07' }, http, '2026-08');

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('fetchAndValidate', () => {
  const countPages = async () => 6;

  it('取得して sha256 とページ数を返す', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const result = await fetchAndValidate(`${BASE}202607.pdf`, http, countPages);

    expect(result.byteSize).toBe(PDF_BYTES.length);
    expect(result.pageCount).toBe(6);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じ内容なら同じ sha256 になる（変更検知の土台）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const first = await fetchAndValidate(`${BASE}202607.pdf`, http, countPages);
    const second = await fetchAndValidate(`${BASE}202607.pdf`, http, countPages);

    expect(first.sha256).toBe(second.sha256);
  });

  it('内容が違えば sha256 も違う', async () => {
    const a = fakeHttp(new Set([`${BASE}202607.pdf`]), new TextEncoder().encode('%PDF-1.7\nA'));
    const b = fakeHttp(new Set([`${BASE}202607.pdf`]), new TextEncoder().encode('%PDF-1.7\nB'));

    const first = await fetchAndValidate(`${BASE}202607.pdf`, a, countPages);
    const second = await fetchAndValidate(`${BASE}202607.pdf`, b, countPages);

    expect(first.sha256).not.toBe(second.sha256);
  });

  it('200以外は例外', async () => {
    const http = fakeHttp(new Set());
    await expect(fetchAndValidate(`${BASE}202607.pdf`, http, countPages)).rejects.toThrow(/404/);
  });

  it('検査に落ちるPDFは PdfRejectedError（LLMに渡さない）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]), PDF_BYTES, 'text/html');
    await expect(fetchAndValidate(`${BASE}202607.pdf`, http, countPages)).rejects.toThrow(
      PdfRejectedError,
    );
  });

  it('ページ数が上限超なら PdfRejectedError', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    await expect(fetchAndValidate(`${BASE}202607.pdf`, http, async () => 500)).rejects.toThrow(
      PdfRejectedError,
    );
  });

  it('PDFとして開けないものも PdfRejectedError（例外を握り潰さない）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const failing = async () => {
      throw new Error('壊れたPDF');
    };

    await expect(fetchAndValidate(`${BASE}202607.pdf`, http, failing)).rejects.toThrow(
      PdfRejectedError,
    );
  });
});
