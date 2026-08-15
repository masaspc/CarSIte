import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionClient,
  createAnthropicClient,
  extractSpec,
} from '@/pipeline/extract';
import { FEATURE_COLUMNS } from '@/db/schema';

const PDF = new TextEncoder().encode('%PDF-1.7\nfake');

const ALL_FEATURES = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, 'unknown' as const]),
);

const VALID = {
  modelName: 'プリウス',
  grades: [
    {
      name: 'Z',
      powertrain: '2.0L プラグインハイブリッド車',
      driveSystemRaw: '2WD',
      typeDesignation: '6LA-MXWH61-AHXHB',
      price: 4_600_000,
      seating: 5,
      weight: 1620,
      displacement: 1987,
      wltcMode: 26.0,
      engineType: 'PHEV',
      transmission: '電気式無段変速機',
      features: ALL_FEATURES,
    },
  ],
};

function clientReturning(raw: unknown): ExtractionClient {
  return {
    extract: async () => ({ raw, inputTokens: 25_000, outputTokens: 8_000 }),
  };
}

describe('extractSpec', () => {
  it('スキーマに合う結果は成功', async () => {
    const result = await extractSpec(PDF, clientReturning(VALID));

    expect(result.succeeded).toBe(true);
    if (result.succeeded) {
      expect(result.spec.grades).toHaveLength(1);
      expect(result.spec.grades[0].typeDesignation).toBe('6LA-MXWH61-AHXHB');
    }
  });

  it('トークン数を必ず返す（費用の記録に使う）', async () => {
    const result = await extractSpec(PDF, clientReturning(VALID));
    expect(result.inputTokens).toBe(25_000);
    expect(result.outputTokens).toBe(8_000);
  });

  it('検証に落ちても生の結果は保持する（再抽出せずに作り直せるように）', async () => {
    const broken = { modelName: 'プリウス', grades: [] };
    const result = await extractSpec(PDF, clientReturning(broken));

    expect(result.succeeded).toBe(false);
    expect(result.raw).toEqual(broken);
    if (!result.succeeded) expect(result.error).toMatch(/grades/);
  });

  it('検証に落ちたとき spec を返さない（部分的にも書き込ませない）', async () => {
    const result = await extractSpec(PDF, clientReturning({ modelName: 'X' }));
    expect(result.succeeded).toBe(false);
    expect('spec' in result).toBe(false);
  });

  it('失敗してもトークン数は記録する（費用は発生しているため）', async () => {
    const result = await extractSpec(PDF, clientReturning({ modelName: 'X' }));
    expect(result.inputTokens).toBe(25_000);
    expect(result.outputTokens).toBe(8_000);
  });

  it('APIが例外を投げても、失敗として記録できる形で返す', async () => {
    const failing: ExtractionClient = {
      extract: async () => {
        throw new Error('529 overloaded');
      },
    };

    const result = await extractSpec(PDF, failing);
    expect(result.succeeded).toBe(false);
    if (!result.succeeded) expect(result.error).toMatch(/529/);
  });

  it('例外時は raw が null（返ってきていないものを捏造しない）', async () => {
    const failing: ExtractionClient = {
      extract: async () => {
        throw new Error('timeout');
      },
    };

    const result = await extractSpec(PDF, failing);
    expect(result.raw).toBeNull();
  });

  it('列挙外の値が混じった結果は落とす', async () => {
    const bad = {
      ...VALID,
      grades: [{ ...VALID.grades[0], engineType: '水素' }],
    };
    const result = await extractSpec(PDF, clientReturning(bad));
    expect(result.succeeded).toBe(false);
  });
});

describe('createAnthropicClient', () => {
  it('キーが空なら即座に落とす', () => {
    // SDK は空のキーを黙って受け取り、リクエスト時に 401 になる。
    // 数十件を一括で回す用途では、全件失敗してから気づくことになる
    expect(() => createAnthropicClient('')).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createAnthropicClient('   ')).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('キーがあれば生成できる', () => {
    expect(() => createAnthropicClient('sk-ant-dummy')).not.toThrow();
  });
});

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('同名グレードを別々に出すよう指示している', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/同名/);
  });

  it('括弧記法の意味を説明している', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('［');
  });

  it('推測を禁じている', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/推測|null/);
  });

  it('駆動方式を変換せず原文で出すよう指示している', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('driveSystemRaw');
  });
});
