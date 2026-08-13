# 日本車比較サイト

日本国内で販売されている自動車を、ボディタイプ、価格、機能などの様々な観点から比較検討できるWebサイトです。データは Neon (Postgres) に保存し、Drizzle ORM 経由で読み書きします。

## 特徴

- 📊 **詳細な検索機能**: 価格、燃費、ボディタイプなど、様々な条件で車を絞り込み（フィルタ状態はURLに反映され再現可能）
- 🔍 **簡単比較**: 最大3台まで同時に比較し、スペックを一目で確認
- 🔗 **比較リスト共有**: URLで他の人と比較リストを簡単に共有
- ❤️ **お気に入り機能**: 気になる車両をお気に入りに登録（ローカルストレージに保存）
- 📈 **価格推移グラフ**: 主要車種の価格変動をグラフで確認
- 🏪 **ディーラー検索**: 都道府県・メーカーでディーラーを検索
- 🎯 **おすすめ診断**: 簡単な質問に答えて最適な車を提案
- 🛠️ **管理画面**: 車両データの追加・編集・削除・公開状態の切り替え（GitHub OAuthによる管理者認証、数値ユーザーIDの許可リスト方式）
- 📱 **レスポンシブデザイン**: PC、タブレット、スマートフォンに対応

> ユーザーレビュー機能は過去のバージョンに存在しましたが、現在の実装には含まれていません。

## 技術スタック

- **フロントエンド**: Next.js 15 (App Router) + TypeScript + React Server Components
- **スタイリング**: Tailwind CSS
- **データベース**: Neon (Postgres) + Drizzle ORM
- **認証**: Auth.js (NextAuth v5) — GitHub OAuth、管理者は数値GitHubユーザーIDの許可リストで判定
- **テスト**: Vitest（ユニットテスト・統合テスト）
- **状態管理**: React Hooks + Context API + Local Storage + Session Storage
- **グラフ**: SVGベースのカスタムチャート

## データの現状（重要）

このリポジトリのフィクスチャ（`tests/fixtures/cars.json`）は **100車種 / 103グレード** のデータです。シードすると、価格推移データ40件（10車両ぶん）とディーラー10件も投入されます。

**シード直後は全グレードが `draft`（下書き）状態です。** 公開ページ（`/`, `/search`, `/cars/...` など）は `published` のグレードだけを表示するため、シードしただけでは一般公開ページに車が1台も表示されません。表示するには管理画面（`/admin`）にログインし、グレードごとに「公開する」操作を行う必要があります。

**グレードを公開するには、先に親の車種を検証済みにする必要があります。** 車種ページは車種名・説明・ボディタイプ・公式URLも描画し、説明は `generateMetadata` にも入ります。これらは未検証の取得元データなので、`/admin` の「車種の検証」で内容を確認して「検証済みにする」（`models.verified_at` / `verified_by` に誰がいつ検証したかを記録）まで、その車種のグレードは公開できません。

またフィクスチャの装備値やページなどには、過去のテンプレート生成に由来する機械的な値が含まれています（例: `scripts/generate-more-cars.js` は価格を `basePrice + index * 100000` のような式で機械的に生成していました。このスクリプト自体は Task 15 で削除済みです）。実運用データとしてそのまま信用せず、参考値として扱ってください。

## セットアップ

### 前提条件

- Node.js 18.x 以上
- npm または yarn
- Neon (Postgres) のデータベース（プールなし = unpooled の接続文字列が必要）
- GitHub OAuth App（管理画面のログイン用）

### インストール

1. リポジトリをクローン

```bash
git clone <repository-url>
cd CarSIte
```

2. 依存関係をインストール

```bash
npm install
```

3. 環境変数を設定

`.env.local` を作成し、以下を設定します。

```
# Neon の接続文字列。drizzle-kit やシードスクリプトから使うため、
# プールあり(-pooler)ではなく unpooled の接続文字列を指定すること。
DATABASE_URL=postgresql://...

# Auth.js (NextAuth v5) 用
AUTH_SECRET=...
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...

# 管理画面にアクセスできるGitHubアカウントの数値ユーザーID（カンマ区切り、複数可）
# ログイン名ではなく数値IDで照合する（ログイン名は変更されうるため）
ADMIN_GITHUB_IDS=12345678
```

4. マイグレーションを適用

```bash
npm run db:migrate
```

5. フィクスチャデータをシード

```bash
npm run db:seed
```

シード完了後、全グレードは `draft`、全車種は未検証（`verified_at` が `NULL`）です。
公開ページに車を表示するには `/admin` でまず車種を「検証済みにする」、そのうえでグレードを公開してください。

シードは4テーブルを全削除してから入れ直します。データが残っているデータベースに対しては拒否され、
上書きしてよい場合だけフラグで明示します。

```bash
npm run db:seed                                          # 空のDBのみ投入できる
npm run db:seed -- --force                               # 既存データ（全件 draft）を破棄して入れ直す
npm run db:seed -- --force --allow-destroying-published  # 公開済み・アーカイブ済みごと破棄する
```

6. 開発サーバーを起動

```bash
npm run dev
```

7. ブラウザで開く

```
http://localhost:3000
```

## ビルド

本番環境用にビルドする場合:

```bash
npm run build
npm start
```

`npm run build` はESLint警告0でビルドが通ることを完了条件としています。

## テスト

```bash
npm test              # ユニットテスト（Vitest）
npm run test:integration  # 統合テスト（実際のNeon DBに接続）
```

統合テストはデータベースの状態を変更する箇所がありますが、`beforeAll`/`afterAll` で必ず元の状態に戻します。

## プロジェクト構造

```
CarSIte/
├── app/                    # Next.js App Router
│   ├── page.tsx           # トップページ
│   ├── layout.tsx         # ルートレイアウト
│   ├── globals.css        # グローバルスタイル
│   ├── search/            # 検索ページ
│   ├── cars/[manufacturer]/[model]/  # 車両詳細ページ
│   ├── compare/            # 比較ページ
│   ├── favorites/          # お気に入りページ
│   ├── quiz/               # おすすめ診断ページ
│   ├── dealers/            # ディーラー検索ページ
│   ├── admin/               # 管理画面（GitHub OAuth保護）
│   ├── actions/             # Server Actions
│   └── api/                 # API Routes（Auth.jsハンドラ等）
├── components/              # Reactコンポーネント
│   ├── Header.tsx           # ヘッダー
│   ├── Footer.tsx           # フッター
│   ├── CarCard.tsx          # 車両カード
│   ├── FilterSidebar.tsx    # フィルタサイドバー
│   ├── ComparisonTable.tsx  # 比較テーブル
│   ├── GradeSpecTable.tsx   # 車両詳細のスペック表
│   ├── PriceHistoryChart.tsx # 価格推移グラフ
│   ├── CarForm.tsx          # 管理画面の車両編集フォーム
│   └── Providers.tsx        # Context Providers
├── contexts/                 # React Context
│   └── FavoritesContext.tsx  # お気に入り状態管理
├── db/                       # データベース関連
│   ├── schema.ts             # Drizzleスキーマ定義
│   ├── enums.ts              # DB enum の値定義（Client Componentからも読む単一の定義）
│   ├── index.ts               # DB接続
│   ├── queries.ts             # 公開ページ向けクエリ
│   └── admin-queries.ts       # 管理画面向けクエリ
├── drizzle/                   # マイグレーションファイル
├── auth.ts                    # Auth.js (NextAuth v5) 設定
├── auth-guard.ts               # 管理者許可リストの判定（middleware・Server Action共通）
├── middleware.ts                # /admin/* の保護
├── lib/                        # ユーティリティ関数
│   ├── compare-store.ts        # 比較リストの状態管理
│   ├── search-params.ts        # 検索フィルタのURLシリアライズ
│   ├── slug.ts                  # メーカー/車種/グレードのslug生成
│   ├── transmission.ts          # トランスミッション文字列の分類
│   ├── publication.ts           # グレード公開の可否判定（車種の検証チェック）
│   └── validation.ts            # 入力バリデーション（管理画面・シード共通のZodスキーマ）
├── types/                       # DBの行に対応しない表示用の型のみ
│   ├── car.ts                    # 価格推移グラフの点
│   └── dealer.ts                 # 都道府県の一覧
├── scripts/                      # シード関連スクリプト
│   ├── seed.ts                    # tests/fixtures からDBへ投入
│   ├── seed-guard.ts              # 既存データを破棄してよいかの判定
│   └── seed-transform.ts          # フィクスチャ→DB行への変換ロジック
├── tests/                         # テスト
│   ├── unit/                       # ユニットテスト
│   ├── integration/                 # 統合テスト（実DB接続）
│   └── fixtures/                     # cars.json / dealers.json（テスト・シード用データ）
└── public/                          # 静的ファイル
    └── images/                       # 画像ファイル
```

## 主な機能

### 1. トップページ
- ヒーローセクション
- キーワード検索
- おすすめ診断へのリンク
- ボディタイプ別カテゴリー
- 新着車種の表示

### 2. 検索ページ
- 詳細フィルタ機能
  - メーカー
  - ボディタイプ
  - エンジンタイプ
  - 価格帯
  - 燃費
  - 駆動方式
- 並び替え機能
  - 価格順
  - 燃費順
  - 発売日順
  - 車名順
- フィルタ状態はURLクエリに反映され、再読み込みや共有後も再現される

### 3. 車両詳細ページ
- 詳細なスペック情報
- サイズ情報
- エンジン・動力性能
- 燃費性能
- 安全装備
- 快適装備
- 価格推移グラフ（対象車種のみ）
- 類似車種のレコメンド

### 4. 比較ページ
- 最大3台までの同時比較
- スペック項目の横並び表示
- 装備の有無を一目で確認（`feature_availability` は `standard` / `option` / `none` / `unknown` の4値）
- 比較リストの共有機能（URL生成）

### 5. お気に入りページ
- お気に入りに登録した車両の一覧表示
- ローカルストレージに永続化
- お気に入りからの比較機能

### 6. おすすめ診断ページ
- 簡単な質問に答えて最適な車を提案
- 用途、予算、重視する点などから絞り込み
- 診断結果を基に検索ページへ遷移

### 7. 価格推移グラフ
- 主要車種の価格変動を可視化
- SVGベースの折れ線グラフ
- データテーブルで詳細確認

### 8. ディーラー検索
- 都道府県で絞り込み
- メーカーで絞り込み
- ディーラー情報（住所、電話、営業時間、サービス内容）

### 9. 管理画面
- GitHub OAuth（Auth.js）による認証。ログインできてもGitHubの数値ユーザーIDが `ADMIN_GITHUB_IDS` に含まれていなければ管理画面は利用不可
- 車両一覧表示・公開状態（下書き/公開中/アーカイブ）の切り替え
- 車種の検証（`verified_at` / `verified_by` の記録・取り消し）。未検証の車種のグレードは公開できない
- 車両データの追加
- 車両データの編集
- 車両データの削除
- 認可は middleware と Server Action の双方でチェックする多層防御

## データについて

車両データはPostgres（`models` / `grades` / `price_history` / `dealers` テーブル）に格納されています。開発・テスト用のシードデータは `tests/fixtures/cars.json` と `tests/fixtures/dealers.json` にあり、`npm run db:seed` で投入します。

金額はすべて円単位の整数（税込表示価格をそのまま `integer` で保持）です。装備の有無は真偽値ではなく `feature_availability`（`standard` / `option` / `none` / `unknown`）の4値で表現しており、「値が無い＝装備なし」と決めつけないようにしています。

```json
{
  "id": "toyota-prius-2023-e",
  "manufacturer": "トヨタ",
  "model": "プリウス",
  "grade": "E",
  "bodyType": "ハッチバック",
  "price": 2750000,
  "releaseDate": "2023-01",
  "dimensions": { ... },
  "capacity": { ... },
  "engine": { ... },
  "fuelEfficiency": { ... },
  "safety": { ... },
  "comfort": { ... },
  "images": { ... },
  "officialUrl": "https://toyota.jp/prius/",
  "description": "...",
  "priceHistory": [ ... ]  // オプション：価格推移データ
}
```

## スクリプト

- `npm run dev` - 開発サーバーを起動
- `npm run build` - 本番環境用にビルド（ESLint警告0が完了条件）
- `npm start` - 本番サーバーを起動
- `npm run lint` - ESLintでコードをチェック
- `npm test` - ユニットテスト（Vitest）
- `npm run test:integration` - 統合テスト（実DBに接続）
- `npm run db:generate` - Drizzleスキーマからマイグレーションファイルを生成
- `npm run db:migrate` - マイグレーションを適用
- `npm run db:seed` - `tests/fixtures` のデータをDBに投入（全件 `draft`）。既存データがあると拒否する（`--force` / `--allow-destroying-published` で上書き）

## カスタマイズ

### 車両データの追加

管理画面（`/admin`）から追加するか、`tests/fixtures/cars.json` を編集して `npm run db:seed -- --force` を再実行してください（再実行すると既存データは全削除の上で再投入されます）。

投入値の型と制約は `lib/validation.ts` の Zod スキーマが単一の真実の源です（管理画面からの入力もシードも同じスキーマを通ります）。フィクスチャの形は `scripts/seed-transform.ts` の `RawCar`、DBの列は `db/schema.ts`、列挙値は `db/enums.ts` を参照してください。

グレードの `slug` は作成後に変更できません（共有URLと訪問者のお気に入りが参照しているため）。

### ディーラーデータの追加

`tests/fixtures/dealers.json` に新しいディーラー情報を追加し、`npm run db:seed -- --force` を再実行してください。

### スタイルのカスタマイズ

`tailwind.config.ts` でカラースキームやその他のスタイル設定をカスタマイズできます。

## 主要ページURL

- トップページ: `/`
- 検索ページ: `/search`
- 比較ページ: `/compare`
- お気に入り: `/favorites`
- おすすめ診断: `/quiz`
- ディーラー検索: `/dealers`
- 管理画面: `/admin` （GitHub OAuthでのログイン＋許可リストへの登録が必要）

## 注意事項

- このサイトに掲載されている情報は参考値です
- 最新の情報は各メーカーの公式サイトをご確認ください
- 画像はプレースホルダーを使用しています（実際の運用時は適切な画像に差し替えてください）
- 管理画面はGitHub OAuth（Auth.js）＋数値IDの許可リストで認可されたアカウントのみ利用できます
- シード直後は全グレードが `draft` のため、公開ページには何も表示されません

## 既知の依存関係の脆弱性

`npm audit` で報告される脆弱性（moderate 4件、high 3件、2026年時点）は、いずれも Next.js または drizzle-kit のメジャーバージョンアップを伴う修正のみが提供されています。互換性への影響が大きいため、このリポジトリでは意図的に据え置いています。対応する場合は `npm audit` の内容を確認の上、影響範囲を検証してから個別に更新してください。

## ライセンス

このプロジェクトは教育目的で作成されています。

---

**バージョン**: 3.0（Neon Postgres + Drizzle ORM への移行後）
