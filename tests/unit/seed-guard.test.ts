import { describe, expect, it } from 'vitest';
import {
  ALLOW_PUBLISHED_FLAG,
  evaluateSeedGuard,
  FORCE_FLAG,
  parseSeedFlags,
  type ExistingDataCounts,
} from '@/scripts/seed-guard';

const empty: ExistingDataCounts = {
  models: 0,
  grades: 0,
  priceHistory: 0,
  dealers: 0,
  nonDraftGrades: 0,
};

const populated: ExistingDataCounts = {
  models: 100,
  grades: 103,
  priceHistory: 40,
  dealers: 10,
  nonDraftGrades: 0,
};

const published: ExistingDataCounts = { ...populated, nonDraftGrades: 3 };

const decide = (counts: ExistingDataCounts, ...argv: string[]) =>
  evaluateSeedGuard(counts, parseSeedFlags(argv));

describe('parseSeedFlags', () => {
  it('フラグを解釈する', () => {
    expect(parseSeedFlags([FORCE_FLAG, ALLOW_PUBLISHED_FLAG])).toMatchObject({
      force: true,
      allowDestroyingPublished: true,
      unknown: [],
    });
  });

  it('知らない引数を捨てずに残す', () => {
    expect(parseSeedFlags(['--forse']).unknown).toEqual(['--forse']);
  });
});

describe('evaluateSeedGuard', () => {
  it('空のデータベースはフラグなしで投入できる', () => {
    expect(decide(empty)).toEqual({ proceed: true });
  });

  it('既存データがあればフラグなしでは拒否する', () => {
    const decision = decide(populated);
    expect(decision.proceed).toBe(false);
    expect(decision.proceed === false && decision.reason).toBe('existing-data');
  });

  it('拒否メッセージに件数と渡すべきフラグを書く', () => {
    const decision = decide(populated);
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.message).toContain('grades=103');
    expect(decision.message).toContain('models=100');
    expect(decision.message).toContain(`npm run db:seed -- ${FORCE_FLAG}`);
  });

  it('--force があれば既存データを上書きできる', () => {
    expect(decide(populated, FORCE_FLAG)).toEqual({ proceed: true });
  });

  it('公開済みが1件でもあれば --force だけでは拒否する', () => {
    const decision = decide(published, FORCE_FLAG);
    expect(decision.proceed).toBe(false);
    expect(decision.proceed === false && decision.reason).toBe('published-data');
  });

  it('公開済みの拒否メッセージに件数と追加フラグを書く', () => {
    const decision = decide(published, FORCE_FLAG);
    if (decision.proceed) return expect.unreachable('拒否されていない');
    expect(decision.message).toContain('3 件');
    expect(decision.message).toContain(ALLOW_PUBLISHED_FLAG);
  });

  it('公開済みがあるとき、明示フラグだけで --force が無ければ拒否する', () => {
    expect(decide(published, ALLOW_PUBLISHED_FLAG).proceed).toBe(false);
  });

  it('両方のフラグが揃えば公開済みごと上書きできる', () => {
    expect(decide(published, FORCE_FLAG, ALLOW_PUBLISHED_FLAG)).toEqual({ proceed: true });
  });

  it('archived だけでも公開済み扱いで守る', () => {
    // nonDraftGrades は published と archived の合計。archived も人が触った結果なので同じ扱い
    expect(decide({ ...populated, nonDraftGrades: 1 }, FORCE_FLAG).proceed).toBe(false);
  });

  it('ディーラーしか残っていない場合も既存データとして守る', () => {
    expect(decide({ ...empty, dealers: 10 }).proceed).toBe(false);
  });

  it('フラグのタイプミスを「指定なし」として実行しない', () => {
    const decision = decide(empty, '--forse');
    expect(decision.proceed).toBe(false);
    expect(decision.proceed === false && decision.reason).toBe('unknown-flag');
  });
});
