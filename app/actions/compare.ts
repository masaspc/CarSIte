'use server';

import { findPublishedGradesByRefs, type ComparisonRow } from '@/db/queries';

/**
 * お気に入り・比較リストは sessionStorage/localStorage に GradeRef の配列しか
 * 持たないため、表示直前にこれで実体を解決する。認可は不要（published のみを返す
 * 公開クエリのラッパー）。
 *
 * 見つかった行を渡された refs の順序に並べ直し、見つからなかった参照
 * （draft/archived になった・入力が壊れている等）は黙って除外する。
 */
export async function getComparisonGrades(refs: string[]): Promise<ComparisonRow[]> {
  const rows = await findPublishedGradesByRefs(refs);
  const byRef = new Map(
    rows.map((row) => [`${row.manufacturerSlug}/${row.modelSlug}/${row.grade.slug}`, row]),
  );

  const ordered: ComparisonRow[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    const row = byRef.get(ref);
    if (row) {
      ordered.push(row);
      seen.add(ref);
    }
  }
  return ordered;
}
