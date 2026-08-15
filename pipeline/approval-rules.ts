import type { ChangeDraft } from './diff';

/**
 * 自動承認は price_change だけ。しかも無条件ではない。
 *
 * 価格は公開ページの絞り込みと並び替えに直接効く（db/queries.ts）ため、
 * 誤った値がそのまま検索結果を歪める。3つの歯止めを置く。
 *
 * discontinued を自動にしないのは、「PDFに載っていない」ことの原因が
 * 「本当に廃止された」と「抽出が失敗した」の2つあり、区別がつかないためである。
 * 自動で通すと販売中のグレードを誤って非公開にする。
 * 取得失敗時に古いデータを黙って使わないのと同じ理由で、
 * 消える方向の変更も黙って通してはいけない。
 */
export const MAX_PRICE_CHANGE_RATIO = 0.2;
export const MIN_PLAUSIBLE_PRICE = 500_000;
export const MAX_PLAUSIBLE_PRICE = 30_000_000;

export interface DocumentContext {
  /** この諸元表に含まれるグレードの総数 */
  totalGrades: number;
  /** この諸元表から生成された price_change の件数 */
  priceChangeCount: number;
}

export type ApprovalDecision = { auto: true } | { auto: false; reason: string };

const HUMAN_REASONS: Record<string, string> = {
  new_model: '新しい車種のメタデータ全体が未検証のため、人間の確認が要ります',
  new_grade: 'グレードの識別単位が正しく取れているか、人間の確認が要ります',
  spec_change: '諸元値の変更は誤抽出と区別がつかないため、人間の確認が要ります',
  discontinued:
    '諸元表に載っていない理由は「廃止」と「抽出漏れ」の区別がつきません。' +
    '自動で通すと販売中のグレードを誤って非公開にするため、人間の確認が要ります',
};

function asPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function decideApproval(
  draft: ChangeDraft,
  context: DocumentContext,
): ApprovalDecision {
  if (draft.kind !== 'price_change') {
    return { auto: false, reason: HUMAN_REASONS[draft.kind] ?? '自動承認の対象外です' };
  }

  const price = draft.diff.price;
  const before = asPrice(price?.before);
  const after = asPrice(price?.after);

  if (before === null || after === null) {
    return {
      auto: false,
      reason: '変更前後のどちらかの価格が数値として取れていません。人間の確認が要ります',
    };
  }

  if (before === 0) {
    return { auto: false, reason: '変更前の価格が0のため、変化率を計算できません' };
  }

  if (after < MIN_PLAUSIBLE_PRICE || after > MAX_PLAUSIBLE_PRICE) {
    return {
      auto: false,
      reason:
        `変更後の価格 ${after.toLocaleString()}円 が想定範囲` +
        `（${MIN_PLAUSIBLE_PRICE.toLocaleString()}〜${MAX_PLAUSIBLE_PRICE.toLocaleString()}円）の外です。` +
        '桁の取り違えの可能性があります',
    };
  }

  // 変化率の比較は整数のまま行う。0.2 を掛けると浮動小数の誤差で
  // ちょうど20%の改定が弾かれたり通ったりする
  const delta = Math.abs(after - before);
  if (delta * 5 > Math.abs(before)) {
    const ratio = ((delta / Math.abs(before)) * 100).toFixed(1);
    return {
      auto: false,
      reason:
        `変化率 ${ratio}% が上限 ${MAX_PRICE_CHANGE_RATIO * 100}% を超えています` +
        `（${before.toLocaleString()}円 → ${after.toLocaleString()}円）`,
    };
  }

  if (context.totalGrades <= 0) {
    return { auto: false, reason: 'グレード総数が不明なため、変更の広がりを判断できません' };
  }

  if (context.priceChangeCount * 2 > context.totalGrades) {
    return {
      auto: false,
      reason:
        `この諸元表の ${context.totalGrades} グレード中 ${context.priceChangeCount} 件の価格が動いています。` +
        '半数を超える一斉の変化は、価格改定ではなく列の取り違えを疑うべき状況です',
    };
  }

  return { auto: true };
}
