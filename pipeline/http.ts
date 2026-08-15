export interface HttpResponse {
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
}

/**
 * HTTPを差し替え可能にしてある。探索ロジックの単体テストで
 * 実際にメーカーのサイトを叩かずに済ませるためである。
 */
export interface Http {
  head(url: string): Promise<number>;
  get(url: string): Promise<HttpResponse>;
}

/**
 * 素性を明かす User-Agent を送る。robots.txt を尊重して諸元表PDFだけを
 * 週1回取りに行く用途であり、隠す理由がない。運営者が問い合わせ先を
 * 辿れるほうが、ブロックされるより双方にとってよい。
 *
 * **ASCII だけで書くこと。** HTTPヘッダの値は ByteString（latin-1）であり、
 * 日本語を入れると fetch が
 * 「Cannot convert argument to a ByteString」で失敗する。
 * この失敗は偽のHTTPを使う単体テストでは再現せず、実際にネットワークへ
 * 出たときに初めて出る。ASCII 判定のテストで固定してある。
 */
export const USER_AGENT =
  'CarSiteBot/1.0 (+personal car comparison site; spec PDFs only, weekly)';

export function createFetchHttp(): Http {
  return {
    async head(url) {
      const response = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
      return response.status;
    },
    async get(url) {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}
