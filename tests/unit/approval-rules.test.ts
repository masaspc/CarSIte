import { describe, expect, it } from 'vitest';
import { decideApproval } from '@/pipeline/approval-rules';

const CONTEXT = { totalGrades: 6, priceChangeCount: 1 };

function priceChange(before: number | null, after: number | null) {
  return {
    kind: 'price_change' as const,
    targetKey: '6LA-MXWH61-AHXHB',
    diff: { price: { before, after } },
  };
}

describe('decideApproval — 人間に回すもの', () => {
  it('new_model は人間', () => {
    expect(decideApproval({ kind: 'new_model', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('new_grade は人間', () => {
    expect(decideApproval({ kind: 'new_grade', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('spec_change は人間（誤抽出と区別がつかない）', () => {
    expect(decideApproval({ kind: 'spec_change', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('discontinued は人間。抽出漏れを廃止と誤認して非公開にしないため', () => {
    const decision = decideApproval({ kind: 'discontinued', targetKey: 'x', diff: {} }, CONTEXT);
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/廃止|抽出/);
  });

  it('人間に回す判断には必ず理由が付く（管理画面にそのまま出す）', () => {
    for (const kind of ['new_model', 'new_grade', 'spec_change', 'discontinued'] as const) {
      const decision = decideApproval({ kind, targetKey: 'x', diff: {} }, CONTEXT);
      expect(decision.auto).toBe(false);
      if (!decision.auto) expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('decideApproval — price_change の歯止め', () => {
  it('小幅な改定は自動', () => {
    expect(decideApproval(priceChange(4_000_000, 4_200_000), CONTEXT).auto).toBe(true);
  });

  it('値下げも自動', () => {
    expect(decideApproval(priceChange(4_000_000, 3_800_000), CONTEXT).auto).toBe(true);
  });

  it('±20%を超えたら人間', () => {
    const decision = decideApproval(priceChange(4_000_000, 5_000_000), CONTEXT);
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/20/);
  });

  it('境界（ちょうど20%）は自動', () => {
    expect(decideApproval(priceChange(4_000_000, 4_800_000), CONTEXT).auto).toBe(true);
  });

  it('値下げ側の境界（ちょうど20%）も自動', () => {
    expect(decideApproval(priceChange(4_000_000, 3_200_000), CONTEXT).auto).toBe(true);
  });

  it('安すぎる値は人間（桁の取り違えを疑う）', () => {
    expect(decideApproval(priceChange(500_000, 460_000), CONTEXT).auto).toBe(false);
  });

  it('高すぎる値は人間', () => {
    expect(decideApproval(priceChange(29_000_000, 31_000_000), CONTEXT).auto).toBe(false);
  });

  it('同じPDFでグレードの半数超の価格が動いたら人間（列の取り違えを疑う）', () => {
    const decision = decideApproval(priceChange(4_000_000, 4_100_000), {
      totalGrades: 6,
      priceChangeCount: 4,
    });
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/半数|4/);
  });

  it('ちょうど半数なら自動', () => {
    expect(
      decideApproval(priceChange(4_000_000, 4_100_000), { totalGrades: 6, priceChangeCount: 3 })
        .auto,
    ).toBe(true);
  });

  it('before が null（価格が無かった）なら人間', () => {
    expect(decideApproval(priceChange(null, 4_000_000), CONTEXT).auto).toBe(false);
  });

  it('after が null（価格が消えた）なら人間', () => {
    expect(decideApproval(priceChange(4_000_000, null), CONTEXT).auto).toBe(false);
  });

  it('diff の形が想定外なら人間（安全側に倒す）', () => {
    expect(decideApproval({ kind: 'price_change', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('price が数値でなければ人間', () => {
    const decision = decideApproval(
      {
        kind: 'price_change',
        targetKey: 'x',
        diff: { price: { before: '4000000', after: '4200000' } },
      },
      CONTEXT,
    );
    expect(decision.auto).toBe(false);
  });

  it('before が 0 なら人間（変化率を計算できない）', () => {
    expect(decideApproval(priceChange(0, 4_000_000), CONTEXT).auto).toBe(false);
  });

  it('グレード数が0なら人間（件数比を判断できない）', () => {
    expect(
      decideApproval(priceChange(4_000_000, 4_100_000), { totalGrades: 0, priceChangeCount: 1 })
        .auto,
    ).toBe(false);
  });

  it('自動承認の理由には具体的な数値が入る', () => {
    const decision = decideApproval(priceChange(4_000_000, 5_000_000), CONTEXT);
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/\d/);
  });
});
