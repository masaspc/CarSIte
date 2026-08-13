import { describe, expect, it } from 'vitest';
import { gradeSlug, manufacturerSlug, modelSlug } from '@/lib/slug';

describe('manufacturerSlug', () => {
  it('既知の9メーカーをローマ字にする', () => {
    expect(manufacturerSlug('トヨタ')).toBe('toyota');
    expect(manufacturerSlug('日産')).toBe('nissan');
    expect(manufacturerSlug('レクサス')).toBe('lexus');
    expect(manufacturerSlug('三菱')).toBe('mitsubishi');
  });

  it('未知のメーカーは決定的なハッシュにする', () => {
    const first = manufacturerSlug('未知自動車');
    expect(first).toMatch(/^maker-[0-9a-f]{6}$/);
    expect(manufacturerSlug('未知自動車')).toBe(first);
  });
});

describe('modelSlug', () => {
  it('officialUrl の末尾セグメントを最優先する', () => {
    expect(modelSlug('プリウス', 'https://toyota.jp/prius/')).toBe('prius');
    expect(modelSlug('クラウンクロスオーバー', 'https://toyota.jp/crown/crossover/')).toBe('crossover');
  });

  it('URLが使えないときはASCII名から作る', () => {
    expect(modelSlug('C-HR', '')).toBe('c-hr');
    expect(modelSlug('N-BOX', '')).toBe('n-box');
    expect(modelSlug('MAZDA2', '')).toBe('mazda2');
    expect(modelSlug('WRX S4', '')).toBe('wrx-s4');
  });

  it('どちらも使えないときは決定的なハッシュにする', () => {
    const first = modelSlug('カローラ', '');
    expect(first).toMatch(/^model-[0-9a-f]{6}$/);
    expect(modelSlug('カローラ', '')).toBe(first);
  });

  it('異なる車種名は異なるハッシュになる', () => {
    expect(modelSlug('カローラ', '')).not.toBe(modelSlug('カムリ', ''));
  });
});

describe('gradeSlug', () => {
  it('記号と空白をハイフンに畳む', () => {
    expect(gradeSlug('S-Z')).toBe('s-z');
    expect(gradeSlug('HYBRID G')).toBe('hybrid-g');
    expect(gradeSlug('Type S')).toBe('type-s');
  });

  it('ASCIIにできないグレード名はハッシュにする', () => {
    expect(gradeSlug('標準')).toMatch(/^grade-[0-9a-f]{6}$/);
  });
});
