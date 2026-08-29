import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isEncryptedPdf } from '@/lib/pdf-guard';

export class DecryptionError extends Error {}

export interface Decryptor {
  decrypt(bytes: Uint8Array): Promise<Uint8Array>;
}

/**
 * 諸元表PDFの暗号化を外す。
 *
 * トヨタの諸元表は編集制限のために暗号化されている（実測: RC4 / R=4 / P=-3372、
 * ユーザーパスワードは空、`extract for any purpose: allowed`）。読むことはできるが、
 * Claude API のPDF要件は「パスワード/暗号化なしの標準PDF」と書かれている。
 *
 * 受け付けられるかを実測する道もあったが、そちらは
 * 「今は通る」ことしか保証しない。メーカーが保護設定を変えれば同じ問題が戻る。
 * 送る前に必ず外す形にすれば、その変化に左右されない。
 *
 * pdf-lib では外せない。ignoreEncryption を付けても本文の復号をしないため
 * ページツリーの解決に失敗する（pipeline/pdf.ts に同じ経緯がある）。
 * このため外部コマンドに頼っている。
 */
const QPDF_WARNINGS_EXIT_CODE = 3;

export function createQpdfDecryptor(command = 'qpdf'): Decryptor {
  return {
    async decrypt(bytes: Uint8Array): Promise<Uint8Array> {
      // qpdf は標準入力を受け付けない。PDFの解析にランダムアクセスが要るためで、
      // 入力だけは実ファイルにする必要がある。出力は標準出力で受け取れる。
      const directory = await mkdtemp(path.join(tmpdir(), 'qpdf-'));
      const input = path.join(directory, 'input.pdf');

      try {
        await writeFile(input, bytes);
        return await runQpdf(command, ['--decrypt', input, '-']);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

function runQpdf(command: string, args: string[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));

    child.on('error', (error) => {
      reject(
        new DecryptionError(
          `${command} を実行できません（${error.message}）。` +
            'PDFの暗号化を外すために必要です。macOS なら `brew install qpdf`、' +
            'Ubuntu なら `apt-get install -y qpdf` で入ります',
        ),
      );
    });

    child.on('close', (code) => {
      // 3 は「警告は出たが出力は作られた」。実物の諸元表では起こりうるので通す
      if (code !== 0 && code !== QPDF_WARNINGS_EXIT_CODE) {
        reject(
          new DecryptionError(
            `${command} が失敗しました（終了コード ${code}）: ${Buffer.concat(errors).toString().trim()}`,
          ),
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
  });
}

/**
 * 暗号化されているときだけ外す。かかっていないPDFは何もせずそのまま返す。
 *
 * 外した結果にまだ /Encrypt が残っていたら失敗として扱う。黙って暗号化されたまま
 * APIに送ると、原因の分からない拒否として返ってくる。
 */
export async function ensureDecrypted(
  bytes: Uint8Array,
  decryptor: Decryptor,
): Promise<Uint8Array> {
  if (!isEncryptedPdf(bytes)) return bytes;

  const decrypted = await decryptor.decrypt(bytes);

  if (decrypted.length === 0) {
    throw new DecryptionError('復号の結果が空です');
  }
  if (isEncryptedPdf(decrypted)) {
    throw new DecryptionError('復号したはずのPDFにまだ /Encrypt が残っています');
  }
  return decrypted;
}
