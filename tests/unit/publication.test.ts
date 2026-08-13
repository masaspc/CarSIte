import { describe, expect, it } from 'vitest';
import { assertModelVerifiedForPublish, UnverifiedModelError } from '@/lib/publication';

const unverified = { manufacturer: 'トヨタ', name: 'プリウス', verifiedAt: null };
const verified = { ...unverified, verifiedAt: new Date('2026-08-14T00:00:00Z') };

describe('assertModelVerifiedForPublish', () => {
  it('未検証の車種のグレードは公開できない', () => {
    expect(() => assertModelVerifiedForPublish('published', unverified)).toThrow(
      UnverifiedModelError,
    );
  });

  it('エラーメッセージで車種を名指しする', () => {
    expect(() => assertModelVerifiedForPublish('published', unverified)).toThrow(/トヨタ プリウス/);
  });

  it('検証済みの車種のグレードは公開できる', () => {
    expect(() => assertModelVerifiedForPublish('published', verified)).not.toThrow();
  });

  // 非公開へ戻す操作まで塞ぐと、未検証と分かった車種を止められなくなる
  it('draft・archived への変更は未検証でも止めない', () => {
    expect(() => assertModelVerifiedForPublish('draft', unverified)).not.toThrow();
    expect(() => assertModelVerifiedForPublish('archived', unverified)).not.toThrow();
  });
});
