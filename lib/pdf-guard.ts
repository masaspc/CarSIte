/**
 * 取得したPDFをLLMに渡す前の検査。
 *
 * PDFは外部から来るファイルであり、こちらの想定どおりとは限らない。
 * サイトの構成が変わって取説PDF（数百ページ）を掴むこともあれば、
 * 404のHTMLが application/pdf として返ってくることもある。
 * そのままモデルに渡すと、費用が跳ね上がるうえに意図しない文書を読ませることになる。
 *
 * 判定を純粋関数に切り出し、ページ数だけ呼び出し側が渡す形にしてあるのは、
 * PDFパーサを持ち込まずに単体テストできるようにするためである。
 */

/** 諸元表が10MBを超えることはない。超えたら別の文書を掴んでいる */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** 諸元表はせいぜい十数ページ。50を超えたら取説などを掴んでいる */
export const MAX_PDF_PAGES = 50;

export class PdfRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfRejectedError';
  }
}

export interface PdfCandidate {
  contentType: string | null;
  bytes: Uint8Array;
  pageCount: number;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/**
 * 暗号化されたPDFかどうか。拒否はしない。記録して後から追えるようにするためのもの。
 *
 * トヨタの諸元表は編集制限のために暗号化されている（ユーザーパスワードは空なので
 * 読むことはできる）。Claude API のPDF要件は「パスワード/暗号化なしの標準PDF」と
 * 書かれているため、実際に受け付けられるかは初回の実呼び出しで確かめる必要がある。
 * 拒否された場合に「なぜ落ちたか」を突き止められるよう、ここで印を付けておく。
 *
 * トレーラ辞書の位置はPDFの構造（相互参照ストリームの有無）で変わるため、
 * バッファ全体を走査する。本文に同じ文字列が現れて偽陽性になることはあり得るが、
 * この値で何かを拒否するわけではないので実害はない。
 */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  const needle = new TextEncoder().encode('/Encrypt');
  outer: for (let start = 0; start <= bytes.length - needle.length; start++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (bytes[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

export function assertPdfAcceptable({ contentType, bytes, pageCount }: PdfCandidate): void {
  const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/pdf') {
    throw new PdfRejectedError(
      `Content-Type が application/pdf ではありません: ${contentType ?? '(なし)'}`,
    );
  }

  if (!looksLikePdf(bytes)) {
    throw new PdfRejectedError(
      'PDFのマジックナンバー（%PDF-）で始まっていません。エラーページを取得した可能性があります',
    );
  }

  if (bytes.length > MAX_PDF_BYTES) {
    throw new PdfRejectedError(
      `PDFが大きすぎます: ${bytes.length} バイト（上限 ${MAX_PDF_BYTES} = 10MiB）`,
    );
  }

  if (pageCount < 1) {
    throw new PdfRejectedError('ページ数が0です。PDFとして読めていません');
  }

  if (pageCount > MAX_PDF_PAGES) {
    throw new PdfRejectedError(
      `ページ数が多すぎます: ${pageCount} ページ（上限 ${MAX_PDF_PAGES}）。` +
        '諸元表ではなく取扱説明書などを取得した可能性があります',
    );
  }
}
