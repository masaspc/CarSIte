import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { FEATURE_COLUMNS, grades } from '@/db/schema';

/*
 * 装備列の TypeScript 名と DB 列名の対応を守る。
 *
 * scripts/publish-model.ts は「装備が unknown のグレードが何件あるか」を
 * 生SQLで数える。列名を機械的なスネークケース変換で作ったところ、
 * camera360 が camera_360 にならず SQL がエラーになった。大文字が無い列名は
 * 変換規則では当てられない。
 *
 * 変換規則を使わず getTableColumns から引くのが正しく、それが今後も
 * 成り立つことをここで固定する。
 */
describe('装備列の DB 列名', () => {
  const columns = getTableColumns(grades);

  it('FEATURE_COLUMNS がすべて grades に存在する', () => {
    for (const column of FEATURE_COLUMNS) {
      expect(columns[column], `${column} が grades に無い`).toBeDefined();
      expect(columns[column].name).toBeTruthy();
    }
  });

  it('camera360 の列名は camera_360（機械的な変換では当たらない）', () => {
    expect(columns.camera360.name).toBe('camera_360');
  });

  it('DB 列名は小文字の英数字とアンダースコアだけ（識別子の引用に頼らない）', () => {
    for (const column of FEATURE_COLUMNS) {
      expect(columns[column].name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('DB 列名が重複しない', () => {
    const names = FEATURE_COLUMNS.map((column) => columns[column].name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('20項目ある', () => {
    // 比較表の装備セクション（安全装備8＋快適装備12）と一致する数
    expect(FEATURE_COLUMNS).toHaveLength(20);
  });
});
