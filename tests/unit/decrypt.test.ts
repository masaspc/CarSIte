import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isEncryptedPdf } from '@/lib/pdf-guard';
import { countPdfPages } from '@/pipeline/pdf';
import {
  DecryptionError,
  createQpdfDecryptor,
  ensureDecrypted,
  type Decryptor,
} from '@/pipeline/decrypt';

const GOLDEN = new Uint8Array(
  readFileSync(path.resolve(__dirname, '../fixtures/prius_spec_202607.pdf')),
);

const PLAIN = new TextEncoder().encode('%PDF-1.7\n1 0 obj<</Type/Catalog>>');

const stub = (result: Uint8Array): Decryptor => ({ async decrypt() { return result; } });

describe('ensureDecrypted', () => {
  it('暗号化されていないPDFはそのまま返し、復号を呼ばない', async () => {
    let called = false;
    const decryptor: Decryptor = {
      async decrypt() {
        called = true;
        return new Uint8Array();
      },
    };

    expect(await ensureDecrypted(PLAIN, decryptor)).toBe(PLAIN);
    expect(called).toBe(false);
  });

  it('空の結果を失敗として扱う', async () => {
    await expect(ensureDecrypted(GOLDEN, stub(new Uint8Array()))).rejects.toThrow(DecryptionError);
  });

  it('まだ暗号化されたままなら失敗として扱う', async () => {
    // 黙って暗号化されたまま送ると、原因の分からない拒否として返ってくる
    await expect(ensureDecrypted(GOLDEN, stub(GOLDEN))).rejects.toThrow(/\/Encrypt/);
  });

  it('外せていれば結果を返す', async () => {
    const decrypted = await ensureDecrypted(GOLDEN, stub(PLAIN));
    expect(isEncryptedPdf(decrypted)).toBe(false);
  });
});

function hasQpdf(): boolean {
  try {
    execFileSync('qpdf', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// qpdf が無い環境では skip する。CI では collect.yml が入れる
describe.runIf(hasQpdf())('createQpdfDecryptor（実物のPDF）', () => {
  it('ゴールデンPDFの暗号化を外せる', async () => {
    expect(isEncryptedPdf(GOLDEN)).toBe(true);

    const decrypted = await ensureDecrypted(GOLDEN, createQpdfDecryptor());

    expect(isEncryptedPdf(decrypted)).toBe(false);
    // 中身は保たれている
    expect(await countPdfPages(decrypted)).toBe(await countPdfPages(GOLDEN));
  }, 60_000);

  it('qpdf が見つからなければ入れ方を示して失敗する', async () => {
    const missing = createQpdfDecryptor('qpdf-does-not-exist');
    await expect(ensureDecrypted(GOLDEN, missing)).rejects.toThrow(/brew install qpdf/);
  }, 60_000);
});
