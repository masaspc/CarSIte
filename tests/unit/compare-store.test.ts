import { beforeEach, describe, expect, it } from 'vitest';
import { addToCompare, parseStored, MAX_COMPARE } from '@/lib/compare-store';

describe('parseStored', () => {
  it('壊れたJSONで例外を投げず空配列を返す', () => {
    expect(parseStored('{壊れている')).toEqual([]);
  });

  it('配列でない値を空配列にする', () => {
    expect(parseStored('{"a":1}')).toEqual([]);
  });

  it('文字列以外の要素を捨てる', () => {
    expect(parseStored('["toyota/prius/z", 42, null]')).toEqual(['toyota/prius/z']);
  });
});

describe('addToCompare', () => {
  it('重複を追加しない', () => {
    expect(addToCompare(['toyota/prius/z'], 'toyota/prius/z')).toEqual(['toyota/prius/z']);
  });

  it('上限を超えたら追加しない', () => {
    const full = ['a/b/c', 'd/e/f', 'g/h/i'];
    expect(full).toHaveLength(MAX_COMPARE);
    expect(addToCompare(full, 'j/k/l')).toEqual(full);
  });

  it('空きがあれば末尾に追加する', () => {
    expect(addToCompare(['a/b/c'], 'd/e/f')).toEqual(['a/b/c', 'd/e/f']);
  });
});
