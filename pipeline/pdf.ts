import { getDocumentProxy } from 'unpdf';

/**
 * ページ数を数えるためだけに unpdf（PDF.js のサーバレス向けビルド）を使う。
 *
 * 最初は pdf-lib を使うつもりだったが、実物のトヨタの諸元表で動かなかった。
 * このPDFは編集制限のために暗号化されており（トレーラに /Encrypt がある）、
 * pdf-lib は ignoreEncryption を付けても本文の復号をしないため
 * ページツリーの解決に失敗する。PDF.js は空のユーザーパスワードで復号できる。
 *
 * 本文の抽出には使わない。この諸元表は字間が壊れた形でしかテキストが取れず
 * （「プラグイ ンハイブ リ ッ ド車」）、正規表現でのパースは成立しない。
 * 表の読み取りはLLMの仕事である（設計書2.3）。
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  // 必ず複製を渡す。PDF.js は受け取ったバッファの所有権を奪い、
  // 呼び出し側の Uint8Array を長さ0にしてしまう。複製しないと、
  // ページ数を数えた直後に本体のバイト列が消え、
  // sha256 の計算もマジックナンバーの検査も空データに対して行われる。
  const document = await getDocumentProxy(new Uint8Array(bytes));
  return document.numPages;
}
