import { createHash } from 'node:crypto';
import { PdfRejectedError, assertPdfAcceptable } from '@/lib/pdf-guard';
import { buildPdfUrl, candidateMonths } from '@/lib/spec-url';
import type { Http } from './http';

export interface SourceLocation {
  pdfBaseUrl: string;
  knownMonth: string | null;
}

export type FindResult = { found: string } | { deadBaseUrl: true };

/**
 * 最新の諸元表がどの年月かを HEAD だけで突き止める。
 *
 * 新しい順に試し、最初に 200 が返ったところで止める。実測では同時に存在する年月は
 * 1つだけなので、これで最新版が確定する。候補が全て404なら既知の年月を確認し、
 * それも404ならベースパス自体が死んでいる（サイト構成が変わった）。
 *
 * 定常状態では「今月ぶんが404 → 既知が200」の2回で終わる。
 */
export async function findLatestMonth(
  source: SourceLocation,
  http: Http,
  now: string,
): Promise<FindResult> {
  for (const month of candidateMonths(now, source.knownMonth)) {
    if ((await http.head(buildPdfUrl(source.pdfBaseUrl, month))) === 200) {
      return { found: month };
    }
  }

  if (source.knownMonth === null) return { deadBaseUrl: true };

  const stillThere = await http.head(buildPdfUrl(source.pdfBaseUrl, source.knownMonth));
  return stillThere === 200 ? { found: source.knownMonth } : { deadBaseUrl: true };
}

export interface FetchedPdf {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  byteSize: number;
}

/**
 * PDFを取得し、LLMに渡してよいものかを検査したうえでハッシュを計算する。
 *
 * 検査に落ちたものは例外にする。壊れたPDFや取説PDFを黙ってモデルに渡すと、
 * 費用が跳ね上がるうえに誤ったデータが承認キューに流れ込む。
 */
export async function fetchAndValidate(
  url: string,
  http: Http,
  countPages: (bytes: Uint8Array) => Promise<number>,
): Promise<FetchedPdf> {
  const response = await http.get(url);
  if (response.status !== 200) {
    throw new Error(`PDFの取得に失敗しました: HTTP ${response.status} ${url}`);
  }

  // ページ数を数えるにはPDFとして開く必要がある。開けなければ 0 として
  // assertPdfAcceptable に判断させる — 例外の種類を PdfRejectedError に
  // 揃えておくと、呼び出し側が「取得は成功したが中身が使えない」を
  // 一種類の失敗として扱える。
  let pageCount = 0;
  try {
    pageCount = await countPages(response.bytes);
  } catch {
    pageCount = 0;
  }

  assertPdfAcceptable({
    contentType: response.contentType,
    bytes: response.bytes,
    pageCount,
  });

  return {
    bytes: response.bytes,
    sha256: createHash('sha256').update(response.bytes).digest('hex'),
    pageCount,
    byteSize: response.bytes.length,
  };
}

export { PdfRejectedError };
