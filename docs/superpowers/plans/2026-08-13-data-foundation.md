# データ基盤 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JSONファイルを唯一のデータストアにしている現在の構造を、Neon Postgres + Drizzle + Server Component に置き換え、未検証データが公開されない公開制御と、まともな認証を備えたデータ基盤を作る。

**Architecture:** 公開ページは Server Component から Drizzle 経由で Postgres を読み、`publication_status = 'published'` の行だけをクエリヘルパ越しに取得する。書き込みは Server Actions のみで、Auth.js v5 の GitHub OAuth と Zod 検証を通る。既存105件は**開発用フィクスチャ**として全件 `draft` で投入し、公開はしない。

**Tech Stack:** Next.js 15.5 (App Router) / TypeScript 5.6 / Drizzle ORM / Neon Postgres (`@neondatabase/serverless`) / Auth.js v5 (`next-auth@beta`) / Zod / Vitest / Tailwind CSS

## Global Constraints

- Node.js 26.5 / npm 11.17。パスエイリアスは `@/*` → `./*`（`tsconfig.json` 既存設定）
- 価格はすべて**円単位の整数**。「万円」で保持・入力しない
- 装備は `feature_availability` の4値（`standard` / `option` / `none` / `unknown`）。boolean に戻さない
- `data/cars.json` の105件は**59%が機械生成の架空データ**。仕様値の正しさを前提にした実装・テストを書かない
- シードは全件 `publication_status = 'draft'`。公開ページのクエリは必ず `published` で絞る
- 公開識別子は slug。UUIDを URL・localStorage・sessionStorage に出さない
- 日付は `YYYY-MM` 形式の text。DB側の CHECK 制約で形式を強制する
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 前提: 環境変数

Task 6 以降で必要。`.env.local`（gitignore 済み）に置く。

```
DATABASE_URL=postgresql://<user>:<password>@<host>/<db>?sslmode=require
```

**`DATABASE_URL` には「プールなし（direct / unpooled）」の接続文字列を使うこと。**
Neon の接続文字列は既定でプール版（ホスト名に `-pooler` が付く）だが、Drizzle Kit の
マイグレーションをプール接続で実行するとエラーになる（PgBouncer 経由のためスキーマ操作が通らない）。
Neon コンソールの Connect モーダルで **Connection pooling のトグルを OFF** にして取得する。

実行時側の `@neondatabase/serverless` の `neon()` は HTTP ドライバで TCP 接続を保持しないため、
プールなしの文字列でも問題なく動作する。したがって1つの変数を両方で使い回せる。

```
AUTH_SECRET=<openssl rand -base64 32 の出力>
AUTH_GITHUB_ID=<GitHub OAuth App の Client ID>
AUTH_GITHUB_SECRET=<GitHub OAuth App の Client Secret>
ADMIN_GITHUB_IDS=<管理者のGitHub数値user ID。カンマ区切り>
```

GitHub の数値 user ID は `curl -s https://api.github.com/users/<login> | jq .id` で取得する。

## File Structure

| ファイル | 責務 |
|---|---|
| `db/schema.ts` | Drizzle のテーブル・enum 定義のみ |
| `db/index.ts` | Neon 接続と `db` インスタンス |
| `db/queries.ts` | 公開クエリ。`published` 絞り込みをここに封じ込める |
| `db/admin-queries.ts` | 管理用クエリ。`draft` を含む全件を扱う |
| `lib/transmission.ts` | `6AT` → 機構 + 段数 の正規化（純粋関数） |
| `lib/slug.ts` | slug 生成（純粋関数） |
| `lib/search-params.ts` | URLSearchParams ⇄ フィルタ条件の変換（純粋関数） |
| `lib/validation.ts` | Zod スキーマ。単一の真実の源 |
| `lib/compare-store.ts` | お気に入り・比較リストの slug 配列を localStorage/sessionStorage で扱う |
| `scripts/seed-transform.ts` | `cars.json` → 投入用データ構造（純粋関数） |
| `scripts/seed.ts` | 上記を DB に流す実行スクリプト |
| `auth.ts` | Auth.js v5 設定 |
| `middleware.ts` | `/admin/*` のガード |
| `app/actions/cars.ts` | 車両の作成・更新・削除・公開切替の Server Actions |
| `tests/fixtures/cars.json` | 旧 `data/cars.json` の移設先 |

`lib/carData.ts` は Task 15 で削除する。

---

## Task 1: 依存追加とVitestの土台

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/unit/sanity.test.ts`

**Interfaces:**
- Produces: `npm test` でユニットテストが走る状態

- [ ] **Step 1: 依存をインストール**

```bash
npm install drizzle-orm @neondatabase/serverless zod
npm install -D drizzle-kit vitest dotenv tsx @types/pg
```

- [ ] **Step 2: vitest.config.ts を作成**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 3: 失敗するテストを書く**

`tests/unit/sanity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('テスト基盤', () => {
  it('パスエイリアスとTypeScriptが解決できる', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: package.json にスクリプトを追加**

`scripts` に以下を追加する。

```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:seed": "tsx scripts/seed.ts"
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS 1 test

- [ ] **Step 6: コミット**

```bash
git add package.json package-lock.json vitest.config.ts tests/unit/sanity.test.ts
git commit -m "$(cat <<'EOF'
chore: Drizzle・Zod・Vitest を導入

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: transmission の正規化

`data/cars.json` には `6AT`・`10AT` が実在し、既存の `types/car.ts` の `Transmission` 型に**すでに違反している**（`as Car[]` のキャストで隠れている）。原文を保持しつつ検索用の分類と段数に分ける。

**Files:**
- Create: `lib/transmission.ts`
- Test: `tests/unit/transmission.test.ts`

**Interfaces:**
- Produces:
  - `type TransmissionType = 'CVT' | 'AT' | 'MT' | 'DCT' | '電気式無段変速機' | 'other'`
  - `parseTransmission(raw: string): { raw: string; type: TransmissionType; gearCount: number | null }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/transmission.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTransmission } from '@/lib/transmission';

describe('parseTransmission', () => {
  it('段数なしの表記をそのまま分類する', () => {
    expect(parseTransmission('CVT')).toEqual({ raw: 'CVT', type: 'CVT', gearCount: null });
    expect(parseTransmission('MT')).toEqual({ raw: 'MT', type: 'MT', gearCount: null });
  });

  it('段数付きの表記を機構と段数に分ける', () => {
    expect(parseTransmission('6AT')).toEqual({ raw: '6AT', type: 'AT', gearCount: 6 });
    expect(parseTransmission('10AT')).toEqual({ raw: '10AT', type: 'AT', gearCount: 10 });
    expect(parseTransmission('7DCT')).toEqual({ raw: '7DCT', type: 'DCT', gearCount: 7 });
    expect(parseTransmission('6MT')).toEqual({ raw: '6MT', type: 'MT', gearCount: 6 });
  });

  it('電気式無段変速機をそのまま扱う', () => {
    expect(parseTransmission('電気式無段変速機')).toEqual({
      raw: '電気式無段変速機',
      type: '電気式無段変速機',
      gearCount: null,
    });
  });

  it('e-CVT表記をCVTに寄せる', () => {
    expect(parseTransmission('e-CVT')).toEqual({ raw: 'e-CVT', type: 'CVT', gearCount: null });
  });

  it('分類できない表記はotherにし、原文を必ず残す', () => {
    expect(parseTransmission('謎の変速機')).toEqual({
      raw: '謎の変速機',
      type: 'other',
      gearCount: null,
    });
  });

  it('前後の空白を落とす', () => {
    expect(parseTransmission('  6AT  ')).toEqual({ raw: '6AT', type: 'AT', gearCount: 6 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- transmission`
Expected: FAIL — `Failed to resolve import "@/lib/transmission"`

- [ ] **Step 3: 実装する**

`lib/transmission.ts`:

```ts
export type TransmissionType = 'CVT' | 'AT' | 'MT' | 'DCT' | '電気式無段変速機' | 'other';

export interface ParsedTransmission {
  /** 諸元表の原文。分類に失敗しても必ず保持する */
  raw: string;
  type: TransmissionType;
  gearCount: number | null;
}

const GEARED = /^(\d{1,2})?(AT|MT|DCT|CVT)$/i;
const MECHANISM: Record<string, TransmissionType> = {
  AT: 'AT',
  MT: 'MT',
  DCT: 'DCT',
  CVT: 'CVT',
};

export function parseTransmission(input: string): ParsedTransmission {
  const raw = input.trim();

  if (raw === '電気式無段変速機') {
    return { raw, type: '電気式無段変速機', gearCount: null };
  }

  if (/^e-?CVT$/i.test(raw)) {
    return { raw, type: 'CVT', gearCount: null };
  }

  const matched = GEARED.exec(raw);
  if (matched) {
    const [, gears, mechanism] = matched;
    return {
      raw,
      type: MECHANISM[mechanism.toUpperCase()],
      gearCount: gears ? Number(gears) : null,
    };
  }

  return { raw, type: 'other', gearCount: null };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- transmission`
Expected: PASS 6 tests

- [ ] **Step 5: コミット**

```bash
git add lib/transmission.ts tests/unit/transmission.test.ts
git commit -m "$(cat <<'EOF'
feat: transmission を原文・機構・段数に分解する

6AT・10AT が既存の型定義に違反していたため、enum 単体で持たず
原文を保持したうえで検索用の分類と段数を導出する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: slug 生成

公開識別子は slug にする。既存105件のうち **39車種は `officialUrl` から取れ、24車種はASCII名から作れ、残り38車種はハッシュになる**。ハッシュ行きはすべてフィクスチャで、`draft` のまま公開されないため実害はない。本物の slug はサブプロジェクト2のクロールが供給する。

**Files:**
- Create: `lib/slug.ts`
- Test: `tests/unit/slug.test.ts`

**Interfaces:**
- Produces:
  - `manufacturerSlug(name: string): string`
  - `modelSlug(model: string, officialUrl: string): string`
  - `gradeSlug(grade: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/slug.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- slug`
Expected: FAIL — `Failed to resolve import "@/lib/slug"`

- [ ] **Step 3: 実装する**

`lib/slug.ts`:

```ts
import { createHash } from 'node:crypto';

const MANUFACTURERS: Record<string, string> = {
  トヨタ: 'toyota',
  日産: 'nissan',
  ホンダ: 'honda',
  マツダ: 'mazda',
  スバル: 'subaru',
  スズキ: 'suzuki',
  ダイハツ: 'daihatsu',
  三菱: 'mitsubishi',
  レクサス: 'lexus',
};

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 6);
}

/** ASCII英数字だけを残したslug。作れないときは空文字 */
function asciiSlug(value: string): string {
  return value
    .replace(/[^0-9A-Za-z]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function manufacturerSlug(name: string): string {
  const known = MANUFACTURERS[name];
  if (known) return known;

  const ascii = asciiSlug(name);
  return ascii || `maker-${shortHash(name)}`;
}

export function modelSlug(model: string, officialUrl: string): string {
  const fromUrl = urlTailSegment(officialUrl);
  if (fromUrl) return fromUrl;

  const ascii = asciiSlug(model);
  return ascii || `model-${shortHash(model)}`;
}

export function gradeSlug(grade: string): string {
  const ascii = asciiSlug(grade);
  return ascii || `grade-${shortHash(grade)}`;
}

function urlTailSegment(officialUrl: string): string {
  if (!officialUrl) return '';
  try {
    const path = new URL(officialUrl).pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return '';
    const tail = path.split('/').pop() ?? '';
    return asciiSlug(tail);
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- slug`
Expected: PASS 8 tests

- [ ] **Step 5: コミット**

```bash
git add lib/slug.ts tests/unit/slug.test.ts
git commit -m "$(cat <<'EOF'
feat: 公開識別子となる slug の生成を追加

UUIDではなくslugを公開識別子にする。再シードで値が変わらず、
共有URLとお気に入りが壊れない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Drizzle スキーマとマイグレーション

**Files:**
- Create: `db/schema.ts`
- Create: `drizzle.config.ts`
- Create: `drizzle/` （`db:generate` が生成）

**Interfaces:**
- Produces: `models` / `grades` / `priceHistory` / `dealers` テーブルと、`bodyTypeEnum` などの enum。`FEATURE_COLUMNS` は Task 5・Task 11 が参照する

- [ ] **Step 1: drizzle.config.ts を作成**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 2: スキーマを書く**

`db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const bodyTypeEnum = pgEnum('body_type', [
  '軽自動車', 'コンパクトカー', 'セダン', 'ハッチバック',
  'ステーションワゴン', 'SUV', 'ミニバン', 'スポーツカー', 'クーペ',
]);
export const engineTypeEnum = pgEnum('engine_type', [
  'ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV',
]);
export const driveSystemEnum = pgEnum('drive_system', ['FF', 'FR', '4WD', 'MR', 'RR']);
export const transmissionTypeEnum = pgEnum('transmission_type', [
  'CVT', 'AT', 'MT', 'DCT', '電気式無段変速機', 'other',
]);
export const featureAvailabilityEnum = pgEnum('feature_availability', [
  'standard', 'option', 'none', 'unknown',
]);
export const publicationStatusEnum = pgEnum('publication_status', [
  'draft', 'published', 'archived',
]);

/** 検索対象になるコア装備。これ以外は grades.extraFeatures (JSONB) に逃がす */
export const FEATURE_COLUMNS = [
  'collisionMitigationBrake', 'falseStartSuppression', 'laneDepartureWarning',
  'laneKeepingAssist', 'adaptiveCruiseControl', 'blindSpotMonitor',
  'camera360', 'parkingAssist',
  'navigation', 'etc', 'backCamera', 'powerSeat', 'seatHeater', 'steeringHeater',
  'autoAircon', 'ledHeadlight', 'smartKey', 'powerBackDoor',
  'handsFreeBackDoor', 'sunroof',
] as const;

export type FeatureColumn = (typeof FEATURE_COLUMNS)[number];

const feature = (columnName: string) =>
  featureAvailabilityEnum(columnName).notNull().default('unknown');

const YYYY_MM = (column: string) => sql.raw(`${column} ~ '^[0-9]{4}-[0-9]{2}$'`);

export const models = pgTable(
  'models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manufacturer: text('manufacturer').notNull(),
    manufacturerSlug: text('manufacturer_slug').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    bodyType: bodyTypeEnum('body_type').notNull(),
    officialUrl: text('official_url'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('models_manufacturer_name_key').on(t.manufacturer, t.name),
    unique('models_slug_key').on(t.manufacturerSlug, t.slug),
    index('models_body_type_idx').on(t.bodyType),
  ],
);

export const grades = pgTable(
  'grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),

    price: integer('price').notNull(),
    releaseDate: text('release_date'),
    discontinuedAt: text('discontinued_at'),

    engineType: engineTypeEnum('engine_type').notNull(),
    driveSystem: driveSystemEnum('drive_system').notNull(),
    transmission: text('transmission'),
    transmissionType: transmissionTypeEnum('transmission_type'),
    gearCount: smallint('gear_count'),
    seating: smallint('seating').notNull(),
    displacement: integer('displacement'),
    weight: integer('weight'),
    wltcMode: numeric('wltc_mode', { precision: 4, scale: 1 }),
    cruisingRange: integer('cruising_range'),
    ecoCarTax: boolean('eco_car_tax').notNull().default(false),
    airbags: smallint('airbags'),

    dimensions: jsonb('dimensions'),
    performance: jsonb('performance'),
    fuelDetail: jsonb('fuel_detail'),
    images: jsonb('images'),
    extraFeatures: jsonb('extra_features').notNull().default({}),

    collisionMitigationBrake: feature('collision_mitigation_brake'),
    falseStartSuppression: feature('false_start_suppression'),
    laneDepartureWarning: feature('lane_departure_warning'),
    laneKeepingAssist: feature('lane_keeping_assist'),
    adaptiveCruiseControl: feature('adaptive_cruise_control'),
    blindSpotMonitor: feature('blind_spot_monitor'),
    camera360: feature('camera_360'),
    parkingAssist: feature('parking_assist'),
    navigation: feature('navigation'),
    etc: feature('etc'),
    backCamera: feature('back_camera'),
    powerSeat: feature('power_seat'),
    seatHeater: feature('seat_heater'),
    steeringHeater: feature('steering_heater'),
    autoAircon: feature('auto_aircon'),
    ledHeadlight: feature('led_headlight'),
    smartKey: feature('smart_key'),
    powerBackDoor: feature('power_back_door'),
    handsFreeBackDoor: feature('hands_free_back_door'),
    sunroof: feature('sunroof'),

    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('grades_model_name_key').on(t.modelId, t.name),
    unique('grades_model_slug_key').on(t.modelId, t.slug),
    index('grades_model_id_idx').on(t.modelId),
    index('grades_status_price_idx').on(t.publicationStatus, t.price),
    index('grades_status_wltc_idx').on(t.publicationStatus, t.wltcMode),
    index('grades_engine_type_idx').on(t.engineType),
    index('grades_seating_idx').on(t.seating),
    check('grades_release_date_format', YYYY_MM('release_date')),
    check('grades_discontinued_at_format', YYYY_MM('discontinued_at')),
  ],
);

export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gradeId: uuid('grade_id').notNull().references(() => grades.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    price: integer('price').notNull(),
    sourceUrl: text('source_url'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('price_history_grade_date_key').on(t.gradeId, t.date),
    index('price_history_grade_idx').on(t.gradeId),
    check('price_history_date_format', YYYY_MM('date')),
  ],
);

export const dealers = pgTable(
  'dealers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    manufacturer: text('manufacturer').notNull(),
    prefecture: text('prefecture').notNull(),
    city: text('city'),
    address: text('address'),
    phone: text('phone'),
    businessHours: text('business_hours'),
    closedDays: text('closed_days'),
    services: jsonb('services').notNull().default([]),
  },
  (t) => [
    index('dealers_prefecture_idx').on(t.prefecture),
    index('dealers_manufacturer_idx').on(t.manufacturer),
  ],
);
```

`CHECK` は `NULL` に対して真偽不定となり通過するため、`release_date` / `discontinued_at` が null でも問題ない。

- [ ] **Step 3: マイグレーションを生成する**

Run: `npm run db:generate`
Expected: `drizzle/0000_*.sql` が生成され、`CREATE TYPE`・`CREATE TABLE`・`CREATE INDEX` を含む

- [ ] **Step 4: 生成SQLを目視で確認する**

`drizzle/0000_*.sql` を開き、以下を確認する。

- 6つの `CREATE TYPE ... AS ENUM` がある
- `grades` の装備20列がすべて `DEFAULT 'unknown'` になっている
- `publication_status` の `DEFAULT 'draft'` がある
- `CHECK` 制約が3つある

- [ ] **Step 5: コミット**

```bash
git add db/schema.ts drizzle.config.ts drizzle/
git commit -m "$(cat <<'EOF'
feat: Drizzle スキーマと初回マイグレーションを追加

車種/グレードの2階層、装備の3値化(+unknown)、公開状態、
価格推移テーブルを定義する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: シード変換ロジック

**Files:**
- Create: `scripts/seed-transform.ts`
- Test: `tests/unit/seed-transform.test.ts`

**Interfaces:**
- Consumes: `parseTransmission`（Task 2）、`manufacturerSlug` / `modelSlug` / `gradeSlug`（Task 3）、`FEATURE_COLUMNS`（Task 4）
- Produces:
  - `class DuplicateGradeError extends Error { duplicates: string[] }`
  - `transformCars(cars: RawCar[]): SeedData`
  - `SeedData = { models: SeedModel[]; grades: SeedGrade[]; priceHistory: SeedPricePoint[] }`
  - `SeedGrade` は `modelKey: string`（`modelKeyOf(manufacturer, name)` の戻り値）でモデルを参照する
  - `modelKeyOf(manufacturer: string, name: string): string` を **export する**。Task 7 の
    `seed.ts` はこの関数でキーを組み立てる。区切り文字をファイル間で重複定義してはいけない

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/seed-transform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DuplicateGradeError, transformCars, type RawCar } from '@/scripts/seed-transform';

function car(overrides: Partial<RawCar> = {}): RawCar {
  return {
    id: 'toyota-prius-2023-e',
    manufacturer: 'トヨタ',
    model: 'プリウス',
    grade: 'E',
    bodyType: 'ハッチバック',
    price: 2750000,
    releaseDate: '2023-01',
    dimensions: { length: 4600, width: 1780, height: 1430, wheelbase: 2750, weight: 1390, minTurningRadius: 5.4, groundClearance: 130 },
    capacity: { seating: 5 },
    engine: { type: 'ハイブリッド', displacement: 1797, maxPower: '72kW(98PS)', maxTorque: '142N・m', transmission: '電気式無段変速機', driveSystem: 'FF' },
    fuelEfficiency: { wltcMode: 32.6, cityMode: 35, suburbanMode: 34.2, highwayMode: 30.7, ecoCarTax: true },
    safety: { collisionMitigationBrake: true, falseStartSuppression: true, laneDepartureWarning: true, laneKeepingAssist: true, adaptiveCruiseControl: true, blindSpotMonitor: false, camera360: false, parkingAssist: true, airbags: 7 },
    comfort: { navigation: false, etc: false, backCamera: true, powerSeat: false, seatHeater: false, steeringHeater: false, autoAircon: true, ledHeadlight: true, smartKey: true, powerBackDoor: false, handsFreeBackDoor: false, sunroof: false },
    images: { exterior: ['/images/placeholder-car.jpg'], interior: ['/images/placeholder-interior.jpg'] },
    officialUrl: 'https://toyota.jp/prius/',
    description: 'テスト用',
    ...overrides,
  };
}

describe('transformCars', () => {
  it('同一車種の複数グレードを1つのmodelにまとめる', () => {
    const result = transformCars([
      car({ id: 'a', grade: 'E' }),
      car({ id: 'b', grade: 'G', price: 3200000 }),
    ]);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      manufacturer: 'トヨタ',
      name: 'プリウス',
      manufacturerSlug: 'toyota',
      slug: 'prius',
      bodyType: 'ハッチバック',
    });
    expect(result.grades).toHaveLength(2);
    expect(result.grades.map((g) => g.name)).toEqual(['E', 'G']);
  });

  it('全グレードを draft で投入する', () => {
    const result = transformCars([car()]);
    expect(result.grades[0].publicationStatus).toBe('draft');
  });

  it('装備の true は standard、false は unknown にする', () => {
    const result = transformCars([car()]);
    const grade = result.grades[0];

    expect(grade.collisionMitigationBrake).toBe('standard');
    expect(grade.blindSpotMonitor).toBe('unknown');
    expect(grade.sunroof).toBe('unknown');
  });

  it('transmission を原文・分類・段数に分ける', () => {
    const result = transformCars([
      car({ engine: { ...car().engine, transmission: '6AT' } }),
    ]);

    expect(result.grades[0]).toMatchObject({
      transmission: '6AT',
      transmissionType: 'AT',
      gearCount: 6,
    });
  });

  it('priceHistory を展開する', () => {
    const result = transformCars([
      car({
        priceHistory: [
          { date: '2023-01', price: 2750000 },
          { date: '2024-01', price: 2850000 },
        ],
      }),
    ]);

    expect(result.priceHistory).toHaveLength(2);
    expect(result.priceHistory[0]).toMatchObject({ date: '2023-01', price: 2750000 });
    expect(result.priceHistory[0].gradeKey).toBe(result.grades[0].key);
  });

  it('重複グレードを検出したらエラーで停止する', () => {
    expect(() =>
      transformCars([
        car({ id: 'a', grade: 'X' }),
        car({ id: 'b', grade: 'X', price: 9999999 }),
      ]),
    ).toThrow(DuplicateGradeError);
  });

  it('重複エラーは該当グレードを列挙する', () => {
    try {
      transformCars([car({ grade: 'X' }), car({ grade: 'X' })]);
      expect.unreachable('エラーが投げられていない');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateGradeError);
      expect((error as DuplicateGradeError).duplicates).toEqual(['トヨタ / プリウス / X']);
    }
  });

  it('検索対象外の諸元はJSONBに寄せる', () => {
    const result = transformCars([car()]);
    expect(result.grades[0].dimensions).toMatchObject({ length: 4600, minTurningRadius: 5.4 });
    expect(result.grades[0].performance).toMatchObject({ maxPower: '72kW(98PS)' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- seed-transform`
Expected: FAIL — `Failed to resolve import "@/scripts/seed-transform"`

- [ ] **Step 3: 実装する**

`scripts/seed-transform.ts`:

```ts
import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import { parseTransmission } from '@/lib/transmission';
import { gradeSlug, manufacturerSlug, modelSlug } from '@/lib/slug';

export interface RawCar {
  id: string;
  manufacturer: string;
  model: string;
  grade: string;
  bodyType: string;
  price: number;
  releaseDate: string;
  dimensions: Record<string, number>;
  capacity: { seating: number };
  engine: {
    type: string;
    displacement?: number;
    maxPower: string;
    maxTorque: string;
    transmission: string;
    driveSystem: string;
  };
  fuelEfficiency: {
    wltcMode?: number;
    cityMode?: number;
    suburbanMode?: number;
    highwayMode?: number;
    cruisingRange?: number;
    ecoCarTax: boolean;
  };
  safety: Record<string, boolean | number>;
  comfort: Record<string, boolean>;
  images: { exterior: string[]; interior: string[] };
  officialUrl: string;
  description: string;
  priceHistory?: { date: string; price: number }[];
}

export interface SeedModel {
  key: string;
  manufacturer: string;
  manufacturerSlug: string;
  name: string;
  slug: string;
  bodyType: string;
  officialUrl: string;
  description: string;
}

export type SeedGrade = {
  key: string;
  modelKey: string;
  name: string;
  slug: string;
  publicationStatus: 'draft';
  price: number;
  releaseDate: string | null;
  engineType: string;
  driveSystem: string;
  transmission: string;
  transmissionType: string;
  gearCount: number | null;
  seating: number;
  displacement: number | null;
  weight: number | null;
  wltcMode: string | null;
  cruisingRange: number | null;
  ecoCarTax: boolean;
  airbags: number | null;
  dimensions: Record<string, number>;
  performance: { maxPower: string; maxTorque: string };
  fuelDetail: Record<string, number | undefined>;
  images: { exterior: string[]; interior: string[] };
  extraFeatures: Record<string, never>;
} & Record<FeatureColumn, 'standard' | 'unknown'>;

export interface SeedPricePoint {
  gradeKey: string;
  date: string;
  price: number;
}

export interface SeedData {
  models: SeedModel[];
  grades: SeedGrade[];
  priceHistory: SeedPricePoint[];
}

export class DuplicateGradeError extends Error {
  constructor(public readonly duplicates: string[]) {
    super(
      `重複したグレードが ${duplicates.length} 件あります。値が食い違うため自動では解決できません:\n` +
        duplicates.map((d) => `  - ${d}`).join('\n'),
    );
    this.name = 'DuplicateGradeError';
  }
}

/** 内部キーの区切り。車種名・メーカー名に現れない文字列にする */
const SEPARATOR = '::';

/** Task 7 の seed.ts もこの関数を使う。キー構築をファイル間で重複させないこと */
export function modelKeyOf(manufacturer: string, name: string): string {
  return `${manufacturer}${SEPARATOR}${name}`;
}

/**
 * 既存の boolean 装備を feature_availability に写す。
 * true は standard、false は **unknown**。
 * 元データは機械生成のテンプレート値であり、false に「設定なし」の根拠がないため
 * none に丸めない。
 */
function mapFeature(value: unknown): 'standard' | 'unknown' {
  return value === true ? 'standard' : 'unknown';
}

export function transformCars(cars: RawCar[]): SeedData {
  const models = new Map<string, SeedModel>();
  const grades: SeedGrade[] = [];
  const priceHistory: SeedPricePoint[] = [];
  const seenGrades = new Set<string>();
  const duplicates: string[] = [];

  for (const car of cars) {
    const modelKey = `${car.manufacturer}${SEPARATOR}${car.model}`;

    if (!models.has(modelKey)) {
      models.set(modelKey, {
        key: modelKey,
        manufacturer: car.manufacturer,
        manufacturerSlug: manufacturerSlug(car.manufacturer),
        name: car.model,
        slug: modelSlug(car.model, car.officialUrl),
        bodyType: car.bodyType,
        officialUrl: car.officialUrl,
        description: car.description,
      });
    }

    const gradeKey = `${modelKey}${SEPARATOR}${car.grade}`;
    if (seenGrades.has(gradeKey)) {
      duplicates.push(`${car.manufacturer} / ${car.model} / ${car.grade}`);
      continue;
    }
    seenGrades.add(gradeKey);

    const transmission = parseTransmission(car.engine.transmission);
    const features = Object.fromEntries(
      FEATURE_COLUMNS.map((column) => [
        column,
        mapFeature(car.safety[column] ?? car.comfort[column]),
      ]),
    ) as Record<FeatureColumn, 'standard' | 'unknown'>;

    grades.push({
      key: gradeKey,
      modelKey,
      name: car.grade,
      slug: gradeSlug(car.grade),
      publicationStatus: 'draft',
      price: car.price,
      releaseDate: car.releaseDate || null,
      engineType: car.engine.type,
      driveSystem: car.engine.driveSystem,
      transmission: transmission.raw,
      transmissionType: transmission.type,
      gearCount: transmission.gearCount,
      seating: car.capacity.seating,
      displacement: car.engine.displacement ?? null,
      weight: car.dimensions.weight ?? null,
      wltcMode: car.fuelEfficiency.wltcMode == null ? null : String(car.fuelEfficiency.wltcMode),
      cruisingRange: car.fuelEfficiency.cruisingRange ?? null,
      ecoCarTax: car.fuelEfficiency.ecoCarTax,
      airbags: typeof car.safety.airbags === 'number' ? car.safety.airbags : null,
      dimensions: car.dimensions,
      performance: { maxPower: car.engine.maxPower, maxTorque: car.engine.maxTorque },
      fuelDetail: {
        cityMode: car.fuelEfficiency.cityMode,
        suburbanMode: car.fuelEfficiency.suburbanMode,
        highwayMode: car.fuelEfficiency.highwayMode,
      },
      images: car.images,
      extraFeatures: {},
      ...features,
    });

    for (const point of car.priceHistory ?? []) {
      priceHistory.push({ gradeKey, date: point.date, price: point.price });
    }
  }

  if (duplicates.length > 0) {
    throw new DuplicateGradeError(duplicates);
  }

  return { models: [...models.values()], grades, priceHistory };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- seed-transform`
Expected: PASS 8 tests

- [ ] **Step 5: コミット**

```bash
git add scripts/seed-transform.ts tests/unit/seed-transform.test.ts
git commit -m "$(cat <<'EOF'
feat: cars.json をDB投入形式に変換する純粋関数を追加

重複グレードはエラーで停止する。既存の false 装備は根拠がないため
none ではなく unknown に寄せる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: DB接続とマイグレーション適用

**Files:**
- Create: `db/index.ts`
- Create: `.env.local`（コミットしない）
- Modify: `.gitignore`

**Interfaces:**
- Produces: `db`（Drizzle インスタンス）

- [ ] **Step 1: Neon プロジェクトを作る**

<https://console.neon.tech> で新規プロジェクトを作成し、接続文字列を取得する。ブランチ機能を使うため、`main` のほかに `test` ブランチも作る。

- [ ] **Step 2: .env.local を作る**

冒頭の「前提: 環境変数」の `DATABASE_URL` を設定する。

- [ ] **Step 3: .gitignore を確認する**

`.env*.local` が含まれていることを確認する。無ければ追加する。

- [ ] **Step 4: 環境変数ローダを作る**

`dotenv/config` は `.env` しか読まず、`.env.local` は読まない。一方 `.gitignore` は
`.env*.local` のみを無視するため、素の `.env` に接続文字列を置くと**コミットされる危険がある**。
`.env.local` を使い、Node から動くスクリプトは明示的にそれを読む。

`load-env.ts`:

```ts
import { config } from 'dotenv';

// Next.js は .env.local を自動で読むが、drizzle-kit や tsx から動く
// スクリプトは読まないため、ここで明示的に読み込む。
config({ path: '.env.local' });
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL が設定されていません。.env.local にプールなし(-pooler なし)の接続文字列を置いてください。',
  );
}
```

`drizzle.config.ts` の先頭を `import 'dotenv/config';` から `import './load-env';` に差し替える。

`.gitignore` に `.env` を追加する（`.env*.local` だけでは素の `.env` が追跡されるため）。

- [ ] **Step 5: DBクライアントを作る**

`db/index.ts`:

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL が設定されていません');
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });
export { schema };
```

- [ ] **Step 6: マイグレーションを適用する**

Run: `npm run db:migrate`
Expected: エラーなく完了

- [ ] **Step 7: 適用結果を確認する**

Run:
```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "\d grades" | head -40
```
Expected: `models` / `grades` / `price_history` / `dealers` が存在し、`grades` に装備20列と `publication_status` がある

- [ ] **Step 8: コミット**

```bash
git add db/index.ts load-env.ts drizzle.config.ts .gitignore
git commit -m "$(cat <<'EOF'
feat: Neon への接続とマイグレーション適用を追加

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: シードスクリプト

**Files:**
- Create: `scripts/seed.ts`
- Create: `tests/fixtures/cars.json`（`data/cars.json` を移設）
- Create: `tests/fixtures/dealers.json`（`data/dealers.json` を移設）

**Interfaces:**
- Consumes: `transformCars` / `DuplicateGradeError`（Task 5）、`db`（Task 6）

- [ ] **Step 1: フィクスチャを移設する**

```bash
mkdir -p tests/fixtures
git mv data/cars.json tests/fixtures/cars.json
git mv data/dealers.json tests/fixtures/dealers.json
git rm data/additional-cars.json
```

- [ ] **Step 2: シードスクリプトを書く**

`scripts/seed.ts`:

```ts
import '../load-env';
import { db } from '@/db';
import { dealers, grades, models, priceHistory } from '@/db/schema';
import { DuplicateGradeError, modelKeyOf, transformCars, type RawCar } from './seed-transform';
import carsFixture from '../tests/fixtures/cars.json';
import dealersFixture from '../tests/fixtures/dealers.json';

async function main() {
  let data;
  try {
    data = transformCars(carsFixture as RawCar[]);
  } catch (error) {
    if (error instanceof DuplicateGradeError) {
      console.error('シードを中止しました。');
      console.error(error.message);
      console.error(
        '\nこれらは値が食い違う重複です。どちらが正しいかはフィクスチャからは判断できません。',
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(
    `投入対象: models=${data.models.length} grades=${data.grades.length} priceHistory=${data.priceHistory.length}`,
  );

  await db.delete(priceHistory);
  await db.delete(grades);
  await db.delete(models);
  await db.delete(dealers);

  const insertedModels = await db
    .insert(models)
    .values(data.models.map(({ key, ...row }) => row))
    .returning({ id: models.id, manufacturer: models.manufacturer, name: models.name });

  const modelIdByKey = new Map(
    insertedModels.map((m) => [modelKeyOf(m.manufacturer, m.name), m.id]),
  );

  const insertedGrades = await db
    .insert(grades)
    .values(
      data.grades.map(({ key, modelKey, ...row }) => ({
        ...row,
        modelId: modelIdByKey.get(modelKey)!,
      })),
    )
    .returning({ id: grades.id, modelId: grades.modelId, name: grades.name });

  const gradeIdByKey = new Map<string, string>();
  for (const grade of data.grades) {
    const modelId = modelIdByKey.get(grade.modelKey)!;
    const match = insertedGrades.find((g) => g.modelId === modelId && g.name === grade.name)!;
    gradeIdByKey.set(grade.key, match.id);
  }

  if (data.priceHistory.length > 0) {
    await db.insert(priceHistory).values(
      data.priceHistory.map((point) => ({
        gradeId: gradeIdByKey.get(point.gradeKey)!,
        date: point.date,
        price: point.price,
      })),
    );
  }

  await db.insert(dealers).values(
    (dealersFixture as Record<string, unknown>[]).map((d) => ({
      name: d.name as string,
      manufacturer: d.manufacturer as string,
      prefecture: d.prefecture as string,
      city: d.city as string,
      address: d.address as string,
      phone: d.phone as string,
      businessHours: d.businessHours as string,
      closedDays: d.closedDays as string,
      services: d.services as string[],
    })),
  );

  console.log('シード完了。全グレードは draft のため公開ページには出ません。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: シードを実行し、重複で停止することを確認する**

Run: `npm run db:seed`
Expected: FAIL（exit 1）。`トヨタ / アルファード / X` と `ホンダ / ステップワゴン / AIR` が列挙される

**この失敗は正常である。** 設計どおり、値が食い違う重複を自動で握りつぶさずに止めている。

- [ ] **Step 4: フィクスチャの重複を解消する**

`tests/fixtures/cars.json` から、後から現れる方の重複レコード2件を削除する。

```bash
node -e '
const fs = require("fs");
const path = "tests/fixtures/cars.json";
const cars = JSON.parse(fs.readFileSync(path, "utf8"));
const seen = new Set();
const kept = cars.filter((c) => {
  const key = [c.manufacturer, c.model, c.grade].join("::");
  if (seen.has(key)) { console.log("削除:", c.id, c.manufacturer, c.model, c.grade); return false; }
  seen.add(key);
  return true;
});
fs.writeFileSync(path, JSON.stringify(kept, null, 2) + "\n");
console.log(cars.length, "->", kept.length);
'
```
Expected: `105 -> 103`、削除2件が表示される

- [ ] **Step 5: 再度シードする**

Run: `npm run db:seed`
Expected: `投入対象: models=100 grades=103 priceHistory=40` の後に「シード完了」

`priceHistory` の 40 は**車種数ではなく価格推移の点数**である。`priceHistory` を持つ
車両は重複除去後10件で各4点を持つため 40 点になる。11 という値を期待しないこと。

- [ ] **Step 6: 投入結果を確認する**

Run:
```bash
psql "$DATABASE_URL" -c "select publication_status, count(*) from grades group by 1;"
psql "$DATABASE_URL" -c "select transmission, transmission_type, gear_count from grades where transmission in ('6AT','10AT');"
```
Expected: `draft | 103` のみ。`6AT | AT | 6` と `10AT | AT | 10` が出る

- [ ] **Step 7: コミット**

```bash
git add scripts/seed.ts tests/fixtures/ data/
git commit -m "$(cat <<'EOF'
feat: シードスクリプトを追加し既存データをフィクスチャへ移設

105件のうち59%が機械生成の架空データであるため、資産ではなく
開発用フィクスチャとして扱い、全件 draft で投入する。
値が食い違う重複2件は削除した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 公開クエリヘルパ

未検証データを公開しないという要件を、呼び出し側の規律ではなく**型と関数の境界**で守る。

**Files:**
- Create: `db/queries.ts`
- Create: `tests/integration/queries.test.ts`
- Create: `vitest.integration.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `db`（Task 6）
- Produces:
  - `listPublishedGrades(filters: GradeFilters): Promise<{ rows: GradeListItem[]; total: number }>`
  - `findPublishedModel(manufacturerSlug: string, modelSlug: string): Promise<ModelDetail | null>`
  - `GradeFilters`、`GradeListItem`、`ModelDetail`、`PAGE_SIZE`（Task 9・Task 13 が使う）

- [ ] **Step 1: 統合テスト用の設定を作る**

`vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['dotenv/config'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

`package.json` の `scripts` に追加する。

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/integration/queries.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades } from '@/db/schema';
import { findPublishedModel, listPublishedGrades } from '@/db/queries';

let publishedSlug: { manufacturer: string; model: string };

beforeAll(async () => {
  // シード直後は全件 draft。1件だけ published にして検証する
  const [target] = await db.select().from(grades).limit(1);
  await db
    .update(grades)
    .set({ publicationStatus: 'published' })
    .where(eq(grades.id, target.id));

  const detail = await db.query.models.findFirst({ where: (m, { eq: e }) => e(m.id, target.modelId) });
  publishedSlug = { manufacturer: detail!.manufacturerSlug, model: detail!.slug };
});

describe('listPublishedGrades', () => {
  it('draft を1件も返さない', async () => {
    const { rows } = await listPublishedGrades({});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.publicationStatus === 'published')).toBe(true);
  });

  it('公開件数と総数が一致する', async () => {
    const { rows, total } = await listPublishedGrades({});
    expect(total).toBe(rows.length);
  });

  it('価格の上限で絞り込める', async () => {
    const { rows } = await listPublishedGrades({ priceMax: 1 });
    expect(rows).toHaveLength(0);
  });

  it('装備の unknown をヒットさせない', async () => {
    const { rows } = await listPublishedGrades({ features: ['sunroof'] });
    expect(rows.every((r) => r.sunroof === 'standard')).toBe(true);
  });
});

describe('findPublishedModel', () => {
  it('公開グレードを持つ車種を slug で引ける', async () => {
    const found = await findPublishedModel(publishedSlug.manufacturer, publishedSlug.model);
    expect(found).not.toBeNull();
    expect(found!.grades.every((g) => g.publicationStatus === 'published')).toBe(true);
  });

  it('存在しない slug は null を返す', async () => {
    expect(await findPublishedModel('no-such-maker', 'no-such-model')).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test:integration`
Expected: FAIL — `Failed to resolve import "@/db/queries"`

- [ ] **Step 4: 実装する**

`db/queries.ts`:

```ts
import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models, priceHistory, type FeatureColumn } from '@/db/schema';

const PUBLISHED = eq(grades.publicationStatus, 'published');

export interface GradeFilters {
  keyword?: string;
  manufacturers?: string[];
  bodyTypes?: string[];
  engineTypes?: string[];
  driveSystem?: string;
  priceMin?: number;
  priceMax?: number;
  fuelEfficiencyMin?: number;
  seatingMin?: number;
  /** 指定した装備が standard のものだけを返す。unknown はヒットさせない */
  features?: FeatureColumn[];
  sort?: 'price-asc' | 'price-desc' | 'fuel-desc' | 'date-desc' | 'date-asc';
  page?: number;
}

export const PAGE_SIZE = 24;

function buildConditions(filters: GradeFilters): SQL[] {
  const conditions: SQL[] = [PUBLISHED];

  if (filters.keyword) {
    const pattern = `%${filters.keyword}%`;
    conditions.push(
      sql`(${models.manufacturer} ILIKE ${pattern} OR ${models.name} ILIKE ${pattern} OR ${grades.name} ILIKE ${pattern})`,
    );
  }
  if (filters.manufacturers?.length) {
    conditions.push(sql`${models.manufacturer} = ANY(${filters.manufacturers})`);
  }
  if (filters.bodyTypes?.length) {
    conditions.push(sql`${models.bodyType}::text = ANY(${filters.bodyTypes})`);
  }
  if (filters.engineTypes?.length) {
    conditions.push(sql`${grades.engineType}::text = ANY(${filters.engineTypes})`);
  }
  if (filters.driveSystem) {
    conditions.push(sql`${grades.driveSystem}::text = ${filters.driveSystem}`);
  }
  if (filters.priceMin !== undefined) conditions.push(gte(grades.price, filters.priceMin));
  if (filters.priceMax !== undefined) conditions.push(lte(grades.price, filters.priceMax));
  if (filters.fuelEfficiencyMin !== undefined) {
    conditions.push(gte(grades.wltcMode, String(filters.fuelEfficiencyMin)));
  }
  if (filters.seatingMin !== undefined) conditions.push(gte(grades.seating, filters.seatingMin));

  for (const feature of filters.features ?? []) {
    conditions.push(sql`${grades[feature]} = 'standard'`);
  }

  return conditions;
}

function orderBy(sort: GradeFilters['sort']) {
  switch (sort) {
    case 'price-desc': return [desc(grades.price)];
    case 'fuel-desc': return [sql`${grades.wltcMode} DESC NULLS LAST`];
    case 'date-desc': return [sql`${grades.releaseDate} DESC NULLS LAST`];
    case 'date-asc': return [sql`${grades.releaseDate} ASC NULLS LAST`];
    default: return [asc(grades.price)];
  }
}

export async function listPublishedGrades(filters: GradeFilters) {
  const conditions = buildConditions(filters);
  const page = filters.page ?? 1;

  const rows = await db
    .select({
      id: grades.id,
      slug: grades.slug,
      name: grades.name,
      price: grades.price,
      wltcMode: grades.wltcMode,
      engineType: grades.engineType,
      driveSystem: grades.driveSystem,
      seating: grades.seating,
      publicationStatus: grades.publicationStatus,
      sunroof: grades.sunroof,
      images: grades.images,
      modelName: models.name,
      modelSlug: models.slug,
      manufacturer: models.manufacturer,
      manufacturerSlug: models.manufacturerSlug,
      bodyType: models.bodyType,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(and(...conditions))
    .orderBy(...orderBy(filters.sort))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(and(...conditions));

  return { rows, total };
}

export type GradeListItem = Awaited<ReturnType<typeof listPublishedGrades>>['rows'][number];

export async function findPublishedModel(manufacturerSlug: string, modelSlug: string) {
  const [model] = await db
    .select()
    .from(models)
    .where(and(eq(models.manufacturerSlug, manufacturerSlug), eq(models.slug, modelSlug)))
    .limit(1);

  if (!model) return null;

  const modelGrades = await db
    .select()
    .from(grades)
    .where(and(eq(grades.modelId, model.id), PUBLISHED))
    .orderBy(asc(grades.price));

  if (modelGrades.length === 0) return null;

  const history = await db
    .select()
    .from(priceHistory)
    .where(sql`${priceHistory.gradeId} = ANY(${modelGrades.map((g) => g.id)})`)
    .orderBy(asc(priceHistory.date));

  return { model, grades: modelGrades, priceHistory: history };
}

export type ModelDetail = NonNullable<Awaited<ReturnType<typeof findPublishedModel>>>;
```

- [ ] **Step 5: キャッシュタグを付ける**

`db/queries.ts` の末尾に、Server Component から呼ぶキャッシュ済みの入口を追加する。Neon の無料枠はアイドル時にサスペンドし初回接続に時間がかかるため、ほとんどのリクエストをDBに到達させない。

```ts
import { unstable_cache } from 'next/cache';

/** Server Component からはこちらを使う。Task 12 の revalidateTag('cars') で無効化される */
export const getPublishedGrades = (filters: GradeFilters) =>
  unstable_cache(
    () => listPublishedGrades(filters),
    ['published-grades', JSON.stringify(filters)],
    { tags: ['cars'] },
  )();

export const getPublishedModel = (manufacturerSlug: string, modelSlug: string) =>
  unstable_cache(
    () => findPublishedModel(manufacturerSlug, modelSlug),
    ['published-model', manufacturerSlug, modelSlug],
    { tags: ['cars', `model:${manufacturerSlug}/${modelSlug}`] },
  )();
```

統合テストは `listPublishedGrades` / `findPublishedModel` を直接呼ぶ（キャッシュを挟むと `draft` 漏れの検証が不安定になるため）。Task 13 の画面は `getPublishedGrades` / `getPublishedModel` を使う。

- [ ] **Step 6: テストが通ることを確認**

Run: `npm run test:integration`
Expected: PASS 6 tests

- [ ] **Step 7: コミット**

```bash
git add db/queries.ts tests/integration/queries.test.ts vitest.integration.config.ts package.json
git commit -m "$(cat <<'EOF'
feat: published 限定の公開クエリヘルパを追加

未検証データを公開しない要件を、呼び出し側の規律ではなく
関数の境界で守る。draft が漏れないことを統合テストで担保する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 検索パラメータの変換

現行の「フィルタ状態を `useState` とURLで二重管理する」構造が、キーワード消失バグと診断結果の欠落バグの原因である。URLを単一の真実の源にすることで両方を根治する。

**Files:**
- Create: `lib/search-params.ts`
- Test: `tests/unit/search-params.test.ts`

**Interfaces:**
- Consumes: `GradeFilters`（Task 8）
- Produces:
  - `parseSearchParams(params: URLSearchParams): GradeFilters`
  - `buildSearchParams(filters: GradeFilters): URLSearchParams`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/search-params.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- search-params`
Expected: FAIL — `Failed to resolve import "@/lib/search-params"`

- [ ] **Step 3: 実装する**

`lib/search-params.ts`:

```ts
import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import type { GradeFilters } from '@/db/queries';

const SORTS = ['price-asc', 'price-desc', 'fuel-desc', 'date-desc', 'date-asc'] as const;
type Sort = (typeof SORTS)[number];

const FEATURE_SET = new Set<string>(FEATURE_COLUMNS);

function positiveNumber(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function parseSearchParams(params: URLSearchParams): GradeFilters {
  const filters: GradeFilters = {};

  const keyword = params.get('keyword')?.trim();
  if (keyword) filters.keyword = keyword;

  const manufacturers = params.getAll('manufacturer').filter(Boolean);
  if (manufacturers.length) filters.manufacturers = manufacturers;

  const bodyTypes = params.getAll('bodyType').filter(Boolean);
  if (bodyTypes.length) filters.bodyTypes = bodyTypes;

  const engineTypes = params.getAll('engineType').filter(Boolean);
  if (engineTypes.length) filters.engineTypes = engineTypes;

  const driveSystem = params.get('driveSystem');
  if (driveSystem) filters.driveSystem = driveSystem;

  const priceMin = positiveNumber(params.get('priceMin'));
  if (priceMin !== undefined) filters.priceMin = priceMin;

  const priceMax = positiveNumber(params.get('priceMax'));
  if (priceMax !== undefined) filters.priceMax = priceMax;

  const fuelEfficiencyMin = positiveNumber(params.get('fuelEfficiencyMin'));
  if (fuelEfficiencyMin !== undefined) filters.fuelEfficiencyMin = fuelEfficiencyMin;

  const seatingMin = positiveNumber(params.get('seatingMin'));
  if (seatingMin !== undefined) filters.seatingMin = seatingMin;

  const features = params
    .getAll('feature')
    .filter((f): f is FeatureColumn => FEATURE_SET.has(f));
  if (features.length) filters.features = features;

  const sort = params.get('sort');
  filters.sort = SORTS.includes(sort as Sort) ? (sort as Sort) : 'price-asc';

  const page = Number(params.get('page'));
  filters.page = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

  return filters;
}

export function buildSearchParams(filters: GradeFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.keyword) params.set('keyword', filters.keyword);
  for (const value of filters.manufacturers ?? []) params.append('manufacturer', value);
  for (const value of filters.bodyTypes ?? []) params.append('bodyType', value);
  for (const value of filters.engineTypes ?? []) params.append('engineType', value);
  if (filters.driveSystem) params.set('driveSystem', filters.driveSystem);
  if (filters.priceMin !== undefined) params.set('priceMin', String(filters.priceMin));
  if (filters.priceMax !== undefined) params.set('priceMax', String(filters.priceMax));
  if (filters.fuelEfficiencyMin !== undefined) {
    params.set('fuelEfficiencyMin', String(filters.fuelEfficiencyMin));
  }
  if (filters.seatingMin !== undefined) params.set('seatingMin', String(filters.seatingMin));
  for (const value of filters.features ?? []) params.append('feature', value);
  if (filters.sort && filters.sort !== 'price-asc') params.set('sort', filters.sort);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));

  return params;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- search-params`
Expected: PASS 13 tests

- [ ] **Step 5: コミット**

```bash
git add lib/search-params.ts tests/unit/search-params.test.ts
git commit -m "$(cat <<'EOF'
feat: 検索条件をURLパラメータに一本化する変換を追加

複数bodyType・priceMax・fuelEfficiencyMin・seatingMin をすべて読む。
診断結果が無視される問題とキーワード消失の根治になる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Zod スキーマ

**Files:**
- Create: `lib/validation.ts`
- Test: `tests/unit/validation.test.ts`

**Interfaces:**
- Produces: `gradeInputSchema`、`type GradeInput`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gradeInputSchema } from '@/lib/validation';

const valid = {
  modelId: '0189a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b',
  name: 'Z',
  slug: 'z',
  price: 3200000,
  releaseDate: '2023-01',
  engineType: 'ハイブリッド',
  driveSystem: 'FF',
  seating: 5,
};

describe('gradeInputSchema', () => {
  it('妥当な入力を通す', () => {
    expect(gradeInputSchema.safeParse(valid).success).toBe(true);
  });

  it('価格に負数を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, price: -1 }).success).toBe(false);
  });

  it('価格に小数を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, price: 100.5 }).success).toBe(false);
  });

  it('1億円を超える価格を弾く', () => {
    expect(gradeInputSchema.safeParse({ ...valid, price: 100_000_001 }).success).toBe(false);
  });

  it('releaseDate の形式を強制する', () => {
    expect(gradeInputSchema.safeParse({ ...valid, releaseDate: '2023/01' }).success).toBe(false);
    expect(gradeInputSchema.safeParse({ ...valid, releaseDate: '2023-1' }).success).toBe(false);
  });

  it('未知のengineTypeを弾く', () => {
    expect(gradeInputSchema.safeParse({ ...valid, engineType: '核融合' }).success).toBe(false);
  });

  it('装備は未指定なら unknown になる', () => {
    const parsed = gradeInputSchema.parse(valid);
    expect(parsed.sunroof).toBe('unknown');
  });

  it('装備に不正な値を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, sunroof: 'maybe' }).success).toBe(false);
  });

  it('slug に大文字や空白を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, slug: 'Type S' }).success).toBe(false);
  });

  it('定義していないキーを落とす', () => {
    const parsed = gradeInputSchema.parse({ ...valid, publicationStatus: 'published' });
    expect(parsed).not.toHaveProperty('publicationStatus');
  });
});
```

`publicationStatus` を入力スキーマに含めないのは意図的である。公開状態は専用の Server Action（Task 12）でのみ変更でき、通常の編集では動かせない。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- validation`
Expected: FAIL — `Failed to resolve import "@/lib/validation"`

- [ ] **Step 3: 実装する**

`lib/validation.ts`:

```ts
import { z } from 'zod';
import { FEATURE_COLUMNS } from '@/db/schema';

const YYYY_MM = /^\d{4}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const featureValue = z.enum(['standard', 'option', 'none', 'unknown']).default('unknown');

const featureFields = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, featureValue]),
) as Record<(typeof FEATURE_COLUMNS)[number], typeof featureValue>;

export const gradeInputSchema = z
  .object({
    modelId: z.string().uuid(),
    name: z.string().min(1).max(60),
    slug: z.string().regex(SLUG, 'slug は小文字英数字とハイフンのみ'),
    price: z.number().int().min(0).max(100_000_000),
    releaseDate: z.string().regex(YYYY_MM, 'YYYY-MM 形式で入力してください').nullish(),
    discontinuedAt: z.string().regex(YYYY_MM).nullish(),
    engineType: z.enum(['ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV']),
    driveSystem: z.enum(['FF', 'FR', '4WD', 'MR', 'RR']),
    transmission: z.string().max(40).nullish(),
    seating: z.number().int().min(1).max(12),
    displacement: z.number().int().min(0).max(10_000).nullish(),
    weight: z.number().int().min(0).max(5_000).nullish(),
    wltcMode: z.number().min(0).max(100).nullish(),
    cruisingRange: z.number().int().min(0).max(2_000).nullish(),
    ecoCarTax: z.boolean().default(false),
    airbags: z.number().int().min(0).max(20).nullish(),
    ...featureFields,
  })
  .strip();

export type GradeInput = z.infer<typeof gradeInputSchema>;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- validation`
Expected: PASS 10 tests

- [ ] **Step 5: コミット**

```bash
git add lib/validation.ts tests/unit/validation.test.ts
git commit -m "$(cat <<'EOF'
feat: 単一の真実の源となるZodスキーマを追加

公開状態は入力スキーマに含めず、専用の Server Action でのみ変更する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: 認証と認可

**Files:**
- Create: `auth.ts`
- Create: `middleware.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `tests/integration/authz.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `auth()`、`requireAdmin(): Promise<Session>`

- [ ] **Step 1: 依存を追加する**

```bash
npm install next-auth@beta
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/integration/authz.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

describe('requireAdmin', () => {
  it('未認証なら例外を投げる', async () => {
    const { requireAdmin } = await import('@/auth-guard');
    await expect(requireAdmin()).rejects.toThrow('認証が必要です');
  });

  it('許可リスト外のGitHubユーザーを拒否する', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({ user: { githubId: '999999' } } as never);

    const { requireAdmin } = await import('@/auth-guard');
    await expect(requireAdmin()).rejects.toThrow('管理者権限がありません');
  });

  it('許可リストのGitHubユーザーを通す', async () => {
    process.env.ADMIN_GITHUB_IDS = '12345,67890';
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({ user: { githubId: '12345' } } as never);

    const { requireAdmin } = await import('@/auth-guard');
    await expect(requireAdmin()).resolves.toMatchObject({ user: { githubId: '12345' } });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test:integration -- authz`
Expected: FAIL — `Failed to resolve import "@/auth-guard"`

- [ ] **Step 4: Auth.js を設定する**

`auth.ts`:

```ts
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  callbacks: {
    async jwt({ token, profile }) {
      // GitHubの数値user IDを保持する。ログイン名は変更されうるため使わない
      if (profile?.id) token.githubId = String(profile.id);
      return token;
    },
    async session({ session, token }) {
      if (token.githubId) {
        (session.user as Record<string, unknown>).githubId = token.githubId;
      }
      return session;
    },
  },
});
```

`app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from '@/auth';
```

- [ ] **Step 5: 認可ガードを実装する**

`auth-guard.ts`:

```ts
import { auth } from '@/auth';

export class AuthorizationError extends Error {}

function allowedIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_GITHUB_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * Server Action の内部で必ず呼ぶ。
 * middleware だけに認可を依存させないための多層防御であり、
 * middleware があるからといって省略してはいけない。
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    throw new AuthorizationError('認証が必要です');
  }

  const githubId = (session.user as Record<string, unknown>).githubId;
  if (typeof githubId !== 'string' || !allowedIds().has(githubId)) {
    throw new AuthorizationError('管理者権限がありません');
  }

  return session;
}
```

- [ ] **Step 6: middleware を作る**

`middleware.ts`:

```ts
export { auth as middleware } from '@/auth';

export const config = {
  matcher: ['/admin/:path*'],
};
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npm run test:integration -- authz`
Expected: PASS 3 tests

- [ ] **Step 8: コミット**

```bash
git add auth.ts auth-guard.ts middleware.ts app/api/auth package.json package-lock.json tests/integration/authz.test.ts
git commit -m "$(cat <<'EOF'
feat: Auth.js v5 による管理者認証を追加

admin123 のハードコードと localStorage 認証フラグを置き換える。
照合はGitHubの数値user IDで行い、middleware と Server Action の
両方で検証する多層防御にする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Server Actions

**Files:**
- Create: `app/actions/cars.ts`
- Create: `db/admin-queries.ts`
- Delete: `app/api/cars/route.ts`, `app/api/cars/[id]/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`（Task 11）、`gradeInputSchema`（Task 10）、`db`（Task 6）
- Produces: `createGrade` / `updateGrade` / `deleteGrade` / `setPublicationStatus`

- [ ] **Step 1: 管理用クエリを作る**

`db/admin-queries.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

/** draft を含む全件。管理画面からのみ使う */
export async function listAllGrades() {
  return db
    .select({
      id: grades.id,
      name: grades.name,
      price: grades.price,
      publicationStatus: grades.publicationStatus,
      modelName: models.name,
      manufacturer: models.manufacturer,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .orderBy(asc(models.manufacturer), asc(models.name), asc(grades.price));
}

export async function findGradeById(id: string) {
  const [row] = await db.select().from(grades).where(eq(grades.id, id)).limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: Server Actions を実装する**

`app/actions/cars.ts`:

```ts
'use server';

import { revalidateTag } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades } from '@/db/schema';
import { requireAdmin } from '@/auth-guard';
import { gradeInputSchema } from '@/lib/validation';

export async function createGrade(input: unknown) {
  await requireAdmin();
  const data = gradeInputSchema.parse(input);

  const [created] = await db
    .insert(grades)
    .values({ ...data, wltcMode: data.wltcMode == null ? null : String(data.wltcMode) })
    .returning({ id: grades.id });

  revalidateTag('cars');
  return created;
}

export async function updateGrade(id: string, input: unknown) {
  await requireAdmin();
  const data = gradeInputSchema.parse(input);

  await db
    .update(grades)
    .set({
      ...data,
      wltcMode: data.wltcMode == null ? null : String(data.wltcMode),
      updatedAt: new Date(),
    })
    .where(eq(grades.id, id));

  revalidateTag('cars');
}

export async function deleteGrade(id: string) {
  await requireAdmin();
  await db.delete(grades).where(eq(grades.id, id));
  revalidateTag('cars');
}

/** 公開状態の変更は専用の口を通す。通常の編集では動かせない */
export async function setPublicationStatus(
  id: string,
  status: 'draft' | 'published' | 'archived',
) {
  const session = await requireAdmin();
  const githubId = (session.user as Record<string, unknown>).githubId as string;

  await db
    .update(grades)
    .set({
      publicationStatus: status,
      verifiedAt: status === 'published' ? new Date() : null,
      verifiedBy: status === 'published' ? githubId : null,
      updatedAt: new Date(),
    })
    .where(eq(grades.id, id));

  revalidateTag('cars');
}
```

- [ ] **Step 3: 旧APIを削除する**

```bash
git rm -r app/api/cars
```

- [ ] **Step 4: ビルドが通ることを確認**

Run: `npm run build`
Expected: 型エラーなし。`/api/cars` がルート一覧から消えている

- [ ] **Step 5: コミット**

```bash
git add app/actions/cars.ts db/admin-queries.ts app/api
git commit -m "$(cat <<'EOF'
feat: 書き込みを Server Actions に一本化し無認証APIを削除

公開状態の変更は専用アクションに分け、承認者と日時を記録する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: 公開ページの Server Component 化

**Files:**
- Modify: `app/page.tsx`, `app/search/page.tsx`
- Create: `app/cars/[manufacturer]/[model]/page.tsx`
- Delete: `app/cars/[id]/page.tsx`
- Create: `app/error.tsx`, `app/not-found.tsx`, `components/Pagination.tsx`
- Modify: `components/CarCard.tsx`, `components/FilterSidebar.tsx`, `components/Header.tsx`

**Interfaces:**
- Consumes: `getPublishedGrades` / `getPublishedModel` / `PAGE_SIZE` / `GradeListItem`（Task 8）、`parseSearchParams` / `buildSearchParams`（Task 9）
- Produces: `CarCard` の props が `{ car: Car }` から `{ grade: GradeListItem }` に変わる。Task 14 のお気に入りページも同じ形に合わせる

- [ ] **Step 0: Pagination コンポーネントを作る**

`components/Pagination.tsx`:

```tsx
import Link from 'next/link';

export default function Pagination({
  total,
  pageSize,
  currentPage,
  params,
}: {
  total: number;
  pageSize: number;
  currentPage: number;
  params: URLSearchParams;
}) {
  const lastPage = Math.ceil(total / pageSize);
  if (lastPage <= 1) return null;

  const href = (page: number) => {
    const next = new URLSearchParams(params);
    if (page <= 1) next.delete('page');
    else next.set('page', String(page));
    const query = next.toString();
    return query ? `/search?${query}` : '/search';
  };

  return (
    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="ページ送り">
      {currentPage > 1 && (
        <Link href={href(currentPage - 1)} className="px-4 py-2 border rounded hover:bg-gray-50">
          前へ
        </Link>
      )}
      <span className="text-sm text-gray-600">
        {currentPage} / {lastPage}
      </span>
      {currentPage < lastPage && (
        <Link href={href(currentPage + 1)} className="px-4 py-2 border rounded hover:bg-gray-50">
          次へ
        </Link>
      )}
    </nav>
  );
}
```

- [ ] **Step 1: 検索ページを Server Component にする**

`app/search/page.tsx` を全面的に書き換える。`'use client'` を外し、`searchParams` から条件を読む。

```tsx
import { getPublishedGrades, PAGE_SIZE } from '@/db/queries';
import { parseSearchParams } from '@/lib/search-params';
import CarCard from '@/components/CarCard';
import FilterSidebar from '@/components/FilterSidebar';
import Pagination from '@/components/Pagination';

export const metadata = { title: '車を探す | 日本車比較サイト' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    for (const v of Array.isArray(value) ? value : value ? [value] : []) {
      params.append(key, v);
    }
  }

  const filters = parseSearchParams(params);
  const { rows, total } = await getPublishedGrades(filters);

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold mb-2">車を探す</h1>
        <p className="text-gray-600 mb-6">{total}件の車両が見つかりました</p>

        <div className="flex gap-6">
          <aside className="hidden lg:block w-80 flex-shrink-0">
            <FilterSidebar params={params} />
          </aside>

          <main className="flex-1">
            {rows.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-12 text-center">
                <p className="text-gray-600 text-lg">条件に合う車両が見つかりませんでした</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {rows.map((grade) => (
                    <CarCard key={grade.id} grade={grade} />
                  ))}
                </div>
                <Pagination
                  total={total}
                  pageSize={PAGE_SIZE}
                  currentPage={filters.page ?? 1}
                  params={params}
                />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: FilterSidebar をURL駆動にする**

`useState` でフィルタ状態を持つのをやめ、`useRouter().push()` でURLを書き換える Client Component にする。**価格入力の単位バグ（万円と表示しながら円として渡していた）をここで直す。**

`components/FilterSidebar.tsx` の価格欄を次のようにする。

```tsx
// ラベルは「万円」、値は円に変換してURLへ入れる
<h3 className="font-semibold mb-3">価格帯（万円）</h3>
<input
  type="number"
  placeholder="下限"
  defaultValue={priceMin === undefined ? '' : priceMin / 10_000}
  onBlur={(e) => {
    const man = e.target.value;
    update('priceMin', man ? String(Number(man) * 10_000) : null);
  }}
/>
```

`update` はURLパラメータを1つ差し替えて `router.push` する関数として実装する。**キーワードなど他の条件は `params` をコピーして保持する**ため、サイドバー操作でキーワードが消える問題は起きない。

- [ ] **Step 3: 車種ページを作る**

`app/cars/[manufacturer]/[model]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedModel } from '@/db/queries';
import GradeSpecTable from '@/components/GradeSpecTable';
import PriceHistoryChart from '@/components/PriceHistoryChart';

type Params = { params: Promise<{ manufacturer: string; model: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { manufacturer, model } = await params;
  const detail = await getPublishedModel(manufacturer, model);
  if (!detail) return { title: '車両が見つかりません' };

  const title = `${detail.model.manufacturer} ${detail.model.name}`;
  return {
    title: `${title} | 日本車比較サイト`,
    description: detail.model.description ?? undefined,
    openGraph: { title, description: detail.model.description ?? undefined },
  };
}

export default async function ModelPage({ params }: Params) {
  const { manufacturer, model } = await params;
  const detail = await getPublishedModel(manufacturer, model);
  if (!detail) notFound();

  const cheapest = detail.grades[0];

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-primary-600 font-semibold">{detail.model.manufacturer}</p>
        <h1 className="text-4xl font-bold mb-2">{detail.model.name}</h1>
        <p className="text-gray-600 mb-8">{detail.model.description}</p>

        <section className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4">グレード（{detail.grades.length}件）</h2>
          <p className="text-sm text-gray-600 mb-4">
            最安グレードは {cheapest.name}（¥{cheapest.price.toLocaleString()}）です。
          </p>
          {/* 全グレードを横並びで比較する。装備が unknown の項目は「−」を出し、
              「装備なし」と誤読させない */}
          <GradeSpecTable grades={detail.grades} />
        </section>

        {detail.priceHistory.length > 0 && (
          <section className="bg-white rounded-lg shadow-md p-6 mb-8">
            <PriceHistoryChart
              history={detail.priceHistory.map((p) => ({ date: p.date, price: p.price }))}
              model={`${detail.model.manufacturer} ${detail.model.name}`}
            />
          </section>
        )}
      </div>
    </div>
  );
}
```

`components/GradeSpecTable.tsx` は既存 `components/ComparisonTable.tsx` の描画ロジックを土台に、
`grades` を列として並べる Server Component として新規に作る。装備セルの描画規則は次のとおり。

```tsx
const FEATURE_LABEL: Record<string, string> = {
  standard: '○',
  option: 'OP',
  none: '×',
  unknown: '−',
};
```

`unknown` を `×` と同じ表示にしてはいけない。フィクスチャは大半が `unknown` であり、
`×` にすると「装備が無い」という誤情報になる。

- [ ] **Step 4: 旧詳細ページを削除する**

```bash
git rm app/cars/[id]/page.tsx
```

- [ ] **Step 5: エラー境界を追加する**

`app/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">ページが見つかりません</h1>
        <Link href="/search" className="text-primary-600 underline">
          車を探す
        </Link>
      </div>
    </div>
  );
}
```

`app/error.tsx`:

```tsx
'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">問題が発生しました</h1>
        <p className="text-gray-600 mb-6">
          時間をおいて再度お試しください。
        </p>
        <button onClick={reset} className="bg-primary-600 text-white py-2 px-6 rounded">
          再読み込み
        </button>
      </div>
    </div>
  );
}
```

内部エラーの詳細は表示しない。

- [ ] **Step 6: モバイルメニューを直す**

`components/Header.tsx` のハンバーガーボタンに開閉状態を持たせ、`md` 未満でナビゲーションを表示できるようにする。

現行の `components/Header.tsx:72` は `onClick` を持たないため、`md` 未満でナビゲーションを開けない。

```tsx
const [isOpen, setIsOpen] = useState(false);

const links = [
  { href: '/', label: 'ホーム' },
  { href: '/search', label: '車を探す' },
  { href: '/compare', label: '比較する' },
  { href: '/favorites', label: 'お気に入り' },
  { href: '/dealers', label: 'ディーラー検索' },
];

// 既存のデスクトップ用 <nav> はそのまま残し、ボタンとモバイル用パネルを差し替える
<button
  className="md:hidden p-2"
  onClick={() => setIsOpen(!isOpen)}
  aria-expanded={isOpen}
  aria-controls="mobile-nav"
  aria-label="メニュー"
>
  {/* 既存のハンバーガーSVGをそのまま使う */}
</button>

{isOpen && (
  <nav id="mobile-nav" className="md:hidden border-t bg-white">
    {links.map((link) => (
      <Link
        key={link.href}
        href={link.href}
        onClick={() => setIsOpen(false)}
        className="block px-4 py-3 text-gray-700 hover:bg-gray-50"
      >
        {link.label}
      </Link>
    ))}
  </nav>
)}
```

デスクトップ用の既存 `<nav>` も同じ `links` 配列から描画するよう書き換え、リンク定義の二重管理をなくす。

- [ ] **Step 7: ビルドと動作を確認する**

Run: `npm run build && npm start`
Expected: **この時点ではビルドは完全には通らない。** `lib/carData.ts` が `@/data/cars.json`
を読んでおり、そのファイルは Task 7 が移設済み、`lib/carData.ts` 自体は Task 15 が削除する。
つまり計画の順序上、Task 13 でビルドを緑にすることはできない。

ここで確認するのは次の2点に限る。

1. webpack のコンパイル自体は成功していること
2. `app/dealers/page.tsx` が `tsc --noEmit` のエラー一覧から消えていること

ビルド全体が通ることは Task 15 の完了条件1で担保する。なお `CarCard` の props 変更により
`app/favorites/page.tsx` に型エラーが1件増えるが、これは Task 14 が解消する。

- [ ] **Step 8: クライアントバンドルに車両データが無いことを確認する**

Run: `grep -rl "プリウス" .next/static/chunks || echo "車両データはバンドルに含まれない"`
Expected: `車両データはバンドルに含まれない`

- [ ] **Step 9: コミット**

```bash
git add app components
git commit -m "$(cat <<'EOF'
feat: 公開ページを Server Component 化しURLを車種単位に変更

車両データがクライアントバンドルから消え、generateMetadata が使える。
あわせて価格フィルタの単位バグ、キーワード消失、モバイルメニュー、
404が200で返る問題を修正する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: 管理画面とお気に入り・比較の移行

**Files:**
- Modify: `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/edit/[id]/page.tsx`, `components/CarForm.tsx`
- Create: `lib/compare-store.ts`, `components/CompareFavoritesButton.tsx`
- Modify: `contexts/FavoritesContext.tsx`, `app/compare/page.tsx`, `app/favorites/page.tsx`
- Delete: `contexts/ReviewsContext.tsx`, `components/ReviewSection.tsx`, `types/review.ts`
- Test: `tests/unit/compare-store.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/compare-store.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- compare-store`
Expected: FAIL — `Failed to resolve import "@/lib/compare-store"`

- [ ] **Step 3: 実装する**

`lib/compare-store.ts`:

```ts
export const MAX_COMPARE = 3;
export const COMPARE_KEY = 'compareList';
export const FAVORITES_KEY = 'favorites';

/** `manufacturerSlug/modelSlug/gradeSlug` 形式の公開識別子 */
export type GradeRef = string;

/** 壊れた保存値でアプリ全体が落ちないようにする */
export function parseStored(raw: string | null): GradeRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function readCompare(): GradeRef[] {
  if (typeof window === 'undefined') return [];
  return parseStored(window.sessionStorage.getItem(COMPARE_KEY));
}

export function addToCompare(current: GradeRef[], ref: GradeRef): GradeRef[] {
  if (current.includes(ref)) return current;
  if (current.length >= MAX_COMPARE) return current;
  return [...current, ref];
}
```

- [ ] **Step 4: FavoritesContext を差し替える**

`contexts/FavoritesContext.tsx` の `JSON.parse` を `parseStored` に置き換え、保存する値をIDから `GradeRef` に変える。

- [ ] **Step 5: 比較リストを slug 配列にする**

`app/compare/page.tsx` は sessionStorage から `GradeRef[]` を読み、Server Component 側で実体を取得する構成にする。`Car` オブジェクトを丸ごと保存するのをやめる。

- [ ] **Step 6: お気に入りページの「比較」ボタンを機能させる**

現行は `/compare` へリンクするだけで、比較リストに何も入れていないため押しても何も起きない。お気に入りの先頭3件を比較リストに入れてから遷移する Client Component に置き換える。

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { COMPARE_KEY, MAX_COMPARE, type GradeRef } from '@/lib/compare-store';

export default function CompareFavoritesButton({ favorites }: { favorites: GradeRef[] }) {
  const router = useRouter();

  const handleClick = () => {
    const picked = favorites.slice(0, MAX_COMPARE);
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify(picked));
    router.push('/compare');
  };

  return (
    <button
      onClick={handleClick}
      disabled={favorites.length === 0}
      className="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-semibold"
    >
      お気に入りを比較（先頭{MAX_COMPARE}件）
    </button>
  );
}
```

- [ ] **Step 7: レビュー機能を削除する**

```bash
git rm contexts/ReviewsContext.tsx components/ReviewSection.tsx types/review.ts
```

`components/Providers.tsx` から `ReviewsProvider` を、`components/CarCard.tsx` から評価表示を外す。

- [ ] **Step 8: 管理画面を差し替える**

- `app/admin/layout.tsx`: パスワードフォームと `localStorage` 判定を削除し、`auth()` のセッション確認とサインイン/サインアウトに置き換える
- `app/admin/page.tsx`: `fetch('/api/cars')` をやめ、`listAllGrades()` を Server Component で呼ぶ。各行に**公開状態のバッジと切り替えボタン**を追加し、`setPublicationStatus` を呼ぶ
- `components/CarForm.tsx`: `fetch` をやめ、`createGrade` / `updateGrade` を直接呼ぶ

- [ ] **Step 9: テストとビルドを確認する**

Run: `npm test && npm run build`
Expected: すべて PASS、ビルド成功

- [ ] **Step 10: コミット**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: 管理画面をServer Actions化し比較・お気に入りをslug基準にする

公開状態の切り替えUIを追加。localStorage の JSON.parse を保護し、
比較リストは実体コピーをやめて参照だけを持つ。
成立していなかったレビュー機能は削除した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: クリーンアップと仕上げ

**Files:**
- Delete: `lib/carData.ts`, `scripts/generate-cars.js`, `scripts/generate-more-cars.js`, `scripts/merge-car-data.js`, `scripts/add-price-history.js`, `scripts/final-cars.js`, `scripts/add-final-10-cars.js`
- Modify: `next.config.js`, `README.md`
- Modify: `components/CarCard.tsx`, `components/ComparisonTable.tsx`（`next/image` 化）

- [ ] **Step 1: 旧データ層を削除する**

```bash
git rm lib/carData.ts
git rm scripts/generate-cars.js scripts/generate-more-cars.js scripts/merge-car-data.js
git rm scripts/add-price-history.js scripts/final-cars.js scripts/add-final-10-cars.js
```

- [ ] **Step 2: 参照が残っていないことを確認する**

Run: `grep -rn "carData\|cars.json" app components lib --include=*.ts --include=*.tsx`
Expected: 出力なし（`tests/` と `scripts/seed.ts` のみが `tests/fixtures/cars.json` を参照する）

- [ ] **Step 3: `<img>` を `next/image` に置き換える**

`components/CarCard.tsx` と `components/ComparisonTable.tsx` の `<img>` を `<Image>` にする。

```tsx
import Image from 'next/image';

<Image
  src={exteriorImage}
  alt={`${grade.manufacturer} ${grade.modelName}`}
  fill
  sizes="(max-width: 768px) 100vw, 33vw"
  className="object-cover"
/>
```

- [ ] **Step 4: next.config.js を絞る**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
  },
};

module.exports = nextConfig;
```

画像はすべてローカルの `public/images` を使うため、リモートホストの許可は不要。`hostname: '**'` の全許可を外す。

- [ ] **Step 5: ESLint警告0でビルドが通ることを確認する**

Run: `npm run build 2>&1 | grep -i warning || echo "警告なし"`
Expected: `警告なし`

- [ ] **Step 6: README を現状に合わせる**

- 「105車種のデータ」→ フィクスチャ103件・全件非公開である旨
- 「管理画面（パスワード: admin123）」→ GitHub OAuth
- 「ユーザーレビュー」の記述を削除
- 技術スタックに Neon Postgres / Drizzle / Auth.js / Vitest を追加
- セットアップ手順に環境変数と `npm run db:migrate && npm run db:seed` を追加

- [ ] **Step 7: 全テストとビルドを最終確認する**

Run:
```bash
npm test
npm run test:integration
npm run build
```
Expected: すべて成功、警告0

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: 旧データ層を削除しREADMEを実態に合わせる

架空データを生成していたスクリプト群と、JSONを直接読む carData.ts を削除。
next/image へ移行し remotePatterns の全許可を外す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件の対応表

設計書12章の完了条件と、それを満たすタスクの対応。

| # | 完了条件 | タスク |
|---|---|---|
| 1 | ESLint警告0でビルドが通る | Task 15 Step 5 |
| 2 | 全公開ページがServer Componentでバンドルに車両データが無い | Task 13 Step 8 |
| 3 | `6AT`/`10AT` を含む全件がenum違反なくシードできる | Task 7 Step 6 |
| 4 | 重複グレード2組でシードがエラー停止し一覧出力される | Task 7 Step 3 |
| 5 | 価格推移40点（10車両ぶん）が移行され描画される | Task 7 Step 5、Task 13 Step 3 |
| 6 | シード直後の公開サイトが0件表示になる | Task 7 Step 6、Task 13 Step 7 |
| 7 | `/admin/*` がGitHub OAuth（数値ID照合）で保護される | Task 11 |
| 8 | 検索のフィルタ状態がURLに反映され再現する | Task 9、Task 13 Step 2 |
| 9 | 既知バグがすべて修正されている | Task 13 Steps 2/5/6、Task 14 Steps 4/6 |
| 10 | Vitestと統合テストが通る | Task 15 Step 7 |
| 11 | 管理画面の公開操作が公開ページに反映される | Task 12、Task 14 Step 8 |
