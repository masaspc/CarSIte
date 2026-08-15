import Anthropic from '@anthropic-ai/sdk';
import {
  ExtractedSpecSchema,
  type ExtractedSpec,
  extractionJsonSchema,
} from './extraction-schema';

/**
 * 字間が壊れた日本語PDFから括弧記法の「意味」まで読み取り、
 * パワートレイン列とグレード行という2次元の対応を解釈する必要がある。
 * ここを削ると誤抽出が増え、人間の確認作業が増える。
 * トークン単価より人間の確認コストのほうが高い。
 */
export const EXTRACTION_MODEL = 'claude-opus-5';

/**
 * 構造化JSONは1車種ぶんでも数千トークンになる。
 * 足りないと stop_reason が max_tokens になり、途中で切れたJSONが返る。
 */
const MAX_TOKENS = 32_000;

export const EXTRACTION_SYSTEM_PROMPT = `あなたは日本の自動車メーカーが公開する「主要諸元表・装備一覧」PDFを読み、構造化データに起こす担当です。

## 表の読み方

諸元表は横方向にパワートレイン（例「2.0L プラグインハイブリッド車」「2.0L ハイブリッド車」「1.8L ハイブリッド車」）で区切られ、
その下に駆動方式（2WD / E-Four など）とグレード名（Z / G / U など）が並びます。

- **同名のグレードが別のパワートレインに現れます。** 例えば「Z」は 2.0L PHEV にも 2.0L HV にもあります。
  これらは別の車です。必ず別の要素として出力し、統合しないでください。
- **1つの列が複数の駆動方式を兼ねることがあります。** 見出しが「2WD/E-Four」なら、2WD と E-Four で
  それぞれ1要素を出力してください。
- **［　］は駆動方式ごとの値です。** 例えば「車両重量 1,420 ［1,480］」は
  2WD が 1,420kg、E-Four が 1,480kg という意味です。値を取り違えないでください。

## 出力の決まり

- driveSystemRaw には諸元表の表記をそのまま入れてください（「2WD」「E-Four」など）。変換しないでください。
- powertrain には列見出しの原文をそのまま入れてください。
- typeDesignation には車両型式（例 6LA-MXWH61-AHXHB）を入れてください。記載が無ければ null。
- **表に書かれていない値は推測せず null にしてください。** 他のグレードの値で埋めないでください。
- 装備は凡例に従って standard（標準設定）/ option（設定あり・メーカーオプション）/ none（設定なし）に分類し、
  判断できないものは unknown にしてください。20項目すべてを必ず出力してください。`;

export interface ExtractionInput {
  pdf: Uint8Array;
  jsonSchema: unknown;
  systemPrompt: string;
}

export interface ExtractionRaw {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

/**
 * API呼び出しを差し替え可能にしてある。
 * この環境には ANTHROPIC_API_KEY が無く、実APIを叩くテストは回せないため、
 * 検証・失敗時の扱い・トークン記録は偽のクライアントで単体テストする。
 */
export interface ExtractionClient {
  extract(input: ExtractionInput): Promise<ExtractionRaw>;
}

export function createAnthropicClient(apiKey: string): ExtractionClient {
  // SDK は空のキーを黙って受け取り、実際にリクエストを投げた時点で 401 になる。
  // 収集は数十件を一括で回すため、それでは全件が401で失敗してから気づくことになる。
  // 起動時点で落とす。
  if (!apiKey.trim()) {
    throw new Error(
      'ANTHROPIC_API_KEY が設定されていません。抽出は実行できません',
    );
  }

  const client = new Anthropic({ apiKey });

  return {
    async extract({ pdf, jsonSchema, systemPrompt }) {
      const message = await client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        output_config: {
          format: { type: 'json_schema', schema: jsonSchema as Record<string, unknown> },
        },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: Buffer.from(pdf).toString('base64'),
                },
              },
              { type: 'text', text: 'この諸元表を構造化してください。' },
            ],
          },
        ],
      });

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;

      // 切り詰められたJSONを黙って parse しない。JSON.parse は途中で切れた
      // 文字列に対しても運が悪いと通ってしまう形があり、その場合
      // 「一部のグレードだけ入った」データが正常として流れる
      if (message.stop_reason === 'max_tokens') {
        throw new Error(
          `出力が max_tokens (${MAX_TOKENS}) に達し、JSONが途中で切れています。` +
            'グレード数の多い車種の可能性があります',
        );
      }
      if (message.stop_reason === 'refusal') {
        throw new Error('モデルが安全上の理由で応答を拒否しました');
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return { raw: JSON.parse(text), inputTokens, outputTokens };
    },
  };
}

export type ExtractionOutcome =
  | {
      succeeded: true;
      spec: ExtractedSpec;
      raw: unknown;
      inputTokens: number;
      outputTokens: number;
    }
  | { succeeded: false; raw: unknown; error: string; inputTokens: number; outputTokens: number };

/**
 * 検証に落ちても生の結果は必ず返す。
 *
 * PDFのLLM処理が唯一の実コストなので、失敗しても捨てない。
 * ただし部分的にも書き込ませない — 半分正しいデータは、
 * 全部間違っているデータより見つけにくい。
 */
export async function extractSpec(
  pdf: Uint8Array,
  client: ExtractionClient,
): Promise<ExtractionOutcome> {
  let raw: unknown = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const response = await client.extract({
      pdf,
      jsonSchema: extractionJsonSchema(),
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    });
    raw = response.raw;
    inputTokens = response.inputTokens;
    outputTokens = response.outputTokens;
  } catch (error) {
    return {
      succeeded: false,
      raw,
      error: error instanceof Error ? error.message : String(error),
      inputTokens,
      outputTokens,
    };
  }

  const parsed = ExtractedSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      succeeded: false,
      raw,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' / '),
      inputTokens,
      outputTokens,
    };
  }

  return { succeeded: true, spec: parsed.data, raw, inputTokens, outputTokens };
}
