import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import { matchFeature } from '@/lib/feature-vocabulary';

/*
 * 取り込み用JSONに残した「どの行を見てこの列に入れたか」の記録が、
 * 辞書（lib/feature-vocabulary.ts）と食い違っていないことを確かめる。
 *
 * 記録は散文なので、放っておくと辞書と別々に育つ。片方だけ直しても誰も
 * 気づけない。機械で突き合わせておけば、次のメーカーを足すときに
 * 「トヨタではこう呼んでいた」が確かな出発点になる。
 */
const FIXTURES = ['prius', 'yaris'] as const;

function rowMapping(slug: string): Record<string, string> {
  const raw = JSON.parse(
    readFileSync(path.resolve(__dirname, `../fixtures/${slug}.spec.json`), 'utf8'),
  ) as { _featureProvenance?: { rowMapping?: Record<string, string> } };
  return raw._featureProvenance?.rowMapping ?? {};
}

describe.each(FIXTURES)('%s の rowMapping', (slug) => {
  const mapping = rowMapping(slug);

  it('20項目すべてを記録している', () => {
    expect(Object.keys(mapping).sort()).toEqual([...FEATURE_COLUMNS].sort());
  });

  it('記録した行ラベルが辞書でその列に当たる', () => {
    for (const column of FEATURE_COLUMNS) {
      const note = mapping[column];
      // 「記載なし」はその車種に設定が無いという記録なので、表記の対応づけは無い
      if (note.startsWith('記載なし')) continue;

      const matched = matchFeature(note).map((m) => m.column);
      expect(matched, `${column}: ${note.slice(0, 40)}`).toContain(column as FeatureColumn);
    }
  });

  it('「記載なし」と書いた列は、実際に全グレードが none である', () => {
    const spec = JSON.parse(
      readFileSync(path.resolve(__dirname, `../fixtures/${slug}.spec.json`), 'utf8'),
    ) as { grades: Array<{ name: string; features?: Record<string, string> }> };

    for (const column of FEATURE_COLUMNS) {
      if (!mapping[column].startsWith('記載なし')) continue;
      for (const grade of spec.grades) {
        expect(grade.features?.[column], `${slug} ${grade.name} ${column}`).toBe('none');
      }
    }
  });
});

describe('2車種のあいだで表記が揃っている', () => {
  it('同じ列に「記載なし」以外を記録したなら、どちらも同じ装備列に当たる', () => {
    /*
     * トヨタを基準にする以上、同じメーカーの2車種で対応づけがぶれていては
     * 他社を合わせる土台にならない。
     */
    const prius = rowMapping('prius');
    const yaris = rowMapping('yaris');

    for (const column of FEATURE_COLUMNS) {
      if (prius[column].startsWith('記載なし') || yaris[column].startsWith('記載なし')) continue;
      expect(matchFeature(prius[column]).map((m) => m.column), column).toContain(column);
      expect(matchFeature(yaris[column]).map((m) => m.column), column).toContain(column);
    }
  });
});
