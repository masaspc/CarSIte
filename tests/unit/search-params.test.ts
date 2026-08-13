import { describe, expect, it } from 'vitest';
import { buildSearchParams, parseSearchParams } from '@/lib/search-params';

const parse = (query: string) => parseSearchParams(new URLSearchParams(query));

describe('parseSearchParams', () => {
  it('キーワードを読む', () => {
    expect(parse('keyword=プリウス').keyword).toBe('プリウス');
  });

  it('複数のbodyTypeをすべて読む（1つ目だけにしない）', () => {
    expect(parse('bodyType=ミニバン&bodyType=SUV').bodyTypes).toEqual(['ミニバン', 'SUV']);
  });

  it('診断ページが渡す全パラメータを読む', () => {
    const filters = parse('bodyType=SUV&priceMax=3000000&fuelEfficiencyMin=20&seatingMin=7');
    expect(filters).toMatchObject({
      bodyTypes: ['SUV'],
      priceMax: 3000000,
      fuelEfficiencyMin: 20,
      seatingMin: 7,
    });
  });

  it('価格は円単位の整数として読む', () => {
    expect(parse('priceMin=1500000&priceMax=3000000')).toMatchObject({
      priceMin: 1_500_000,
      priceMax: 3_000_000,
    });
  });

  it('数値でない値は無視する', () => {
    expect(parse('priceMax=abc').priceMax).toBeUndefined();
  });

  it('負の価格は無視する', () => {
    expect(parse('priceMax=-100').priceMax).toBeUndefined();
  });

  it('装備の指定を配列で読む', () => {
    expect(parse('feature=sunroof&feature=camera360').features).toEqual(['sunroof', 'camera360']);
  });

  it('未知の装備キーは捨てる', () => {
    expect(parse('feature=sunroof&feature=nonexistent').features).toEqual(['sunroof']);
  });

  it('ページ番号は1以上に丸める', () => {
    expect(parse('page=0').page).toBe(1);
    expect(parse('page=3').page).toBe(3);
  });

  it('未知のsort値は既定値にする', () => {
    expect(parse('sort=nonsense').sort).toBe('price-asc');
  });
});

describe('buildSearchParams', () => {
  it('parseした結果を戻すと同じ条件になる', () => {
    const original = 'bodyType=SUV&bodyType=ミニバン&keyword=ハイブリッド&priceMax=3000000&feature=sunroof';
    const roundTripped = parseSearchParams(buildSearchParams(parse(original)));
    expect(roundTripped).toEqual(parse(original));
  });

  it('未指定の条件はクエリに出さない', () => {
    expect(buildSearchParams({}).toString()).toBe('');
  });

  it('1ページ目はクエリに出さない', () => {
    expect(buildSearchParams({ page: 1 }).toString()).toBe('');
    expect(buildSearchParams({ page: 2 }).toString()).toBe('page=2');
  });
});
