# データ基盤 設計書

- **作成日**: 2026-08-13
- **対象**: サブプロジェクト1「データ基盤」
- **ステータス**: 承認済み（実装計画待ち）

## 1. 背景

既存の日本車比較サイト（Next.js 15 + TypeScript + Tailwind、約4,100行）は、UI・型定義・比較UXの水準は実用に足るが、データ層に構造的な問題を抱えている。

- 表示側は `data/cars.json` をビルド時に静的インポートし、管理APIは `fs.writeFileSync` で同ファイルを書き換える。**管理画面の編集がサイトに反映されない**うえ、サーバーレス環境では書き込み自体が失敗する
- `/api/cars` の POST / PUT / DELETE に**認証が一切ない**。管理画面のログインはパスワードをクライアントJSにハードコードし、認証状態を `localStorage` に置いているだけで、実質的な防御になっていない
- 全ページが `'use client'` のため、190KBの車両データが全ページのクライアントバンドルに同梱される。SSR/SSGの利点を捨てており、詳細ページに `generateMetadata` もない
- 車両IDが2件重複しており（`toyota-alphard-2023-x`、`honda-stepwgn-2023-air`）、DELETE が2件まとめて消える
- テストが0件

これらは個別のバグではなく「JSONファイルを唯一のデータストアにした」ことの必然的な帰結であり、データ層の入れ替えなしには解消できない。

## 2. プロジェクト全体の分割と本書の位置

最終目標は「国産新車を全グレード網羅し、自動収集で鮮度を保つ比較サイト」である。目標として選ばれた4つの価値はすべて共通のデータ基盤に依存するため、順序はほぼ一意に決まる。

| # | サブプロジェクト | 中身 |
|---|---|---|
| **1** | **データ基盤（本書）** | Vercel + Postgres 移行、スキーマ再設計、認証、既存105件の投入 |
| 2 | 収集パイプライン | クロール → LLM構造化 → 2段階承認 → 全グレード網羅 |
| 3 | 比較体験のコア | 差分ハイライトUI + 装備×価格の最適グレード検索 |
| 4 | TCO試算 | 税・保険・燃料費・車検の5年試算 |

各サブプロジェクトは独立した 設計 → 計画 → 実装 のサイクルを持つ。本書はサブプロジェクト1のみを対象とする。

### 前提条件

- **位置づけ**: インターネットに公開するが、非商用・個人運営
- **データ範囲（最終形）**: 国産新車・全グレード網羅（数千レコード規模）
- **更新方式（最終形）**: 収集は自動、公開は承認制

### 本書のスコープ外

- クローラ、LLMによる構造化、承認キューUI（サブプロジェクト2）
- 差分ハイライト比較、装備×価格の最適グレード検索（サブプロジェクト3）
- TCO試算ロジック（サブプロジェクト4）
- E2Eテスト（比較UIが固まるサブプロジェクト3まで保留）
- 既存機能（レビュー・ディーラー検索・おすすめ診断・お気に入り）の機能拡張。移行とバグ修正のみ行う。個別の扱いは7章「既存機能の扱い」を参照

## 3. アーキテクチャ

```
[ブラウザ] ──> Vercel (Next.js 15 App Router)
                  │
                  ├─ 公開ページ = Server Component ──┐
                  ├─ 管理画面 = Server Actions ──────┤──> Drizzle ORM ──> Neon Postgres
                  └─ middleware.ts (認証ガード)      ┘
```

### 技術選定

| 項目 | 選定 | 理由 |
|---|---|---|
| ホスティング | Vercel | Next.js 15 App Router との統合。GitHub Pagesは静的配信のみで自動更新・管理画面を持てないため不採用 |
| DB | Neon Postgres | サーバーレス向け接続プーリングが標準。無料枠0.5GBに対し全グレード網羅でも数十MBで余裕。Supabaseも候補だが Auth/Storage を使わない本件では構成が過剰 |
| ORM | Drizzle | Prismaより軽量でコールドスタートに有利。生成SQLが読めるためマイグレーションを追跡しやすい |
| 認証 | Auth.js v5 + GitHub OAuth | 個人運営ならパスワード管理が不要になり、実装が最小で最も安全 |
| 検証 | Zod | Server Actions・シード・（将来の）LLM出力検証で同一スキーマを共有 |
| テスト | Vitest | DB非依存の純粋関数を高速に回す |

### 最重要の方針転換: Server Component 化

全ページ `'use client'` をやめ、Server Component から Drizzle 経由でDBを直接読む。

- 車両データがクライアントバンドルから完全に消える
- 詳細ページで `generateMetadata` が使えるようになり、title / description / OGP を車種ごとに出せる
- クライアント状態（お気に入り・比較リスト）を持つ部分のみ、小さな Client Component として切り出す

キャッシュは `unstable_cache` にタグを付与し、管理画面からの公開操作時に `revalidateTag` で無効化する。車両データは更新頻度が低いため、この方式で十分かつ最速。

## 4. データモデル

現行の「グレード単位のフラットな105件」を、車種とグレードの2階層に正規化する。

### 4.1 enum

```
body_type            : 軽自動車 | コンパクトカー | セダン | ハッチバック |
                       ステーションワゴン | SUV | ミニバン | スポーツカー | クーペ
engine_type          : ガソリン | ハイブリッド | EV | ディーゼル | PHEV
drive_system         : FF | FR | 4WD | MR | RR
transmission         : CVT | AT | MT | 電気式無段変速機 | DCT
feature_availability : standard | option | none | unknown
```

`feature_availability` が本設計の中核である。現行スキーマは装備を `true` / `false` で持つが、実際の諸元表は「標準装備 / メーカーオプション / 設定なし」の3値である。サブプロジェクト3の「装備×価格の最適グレード探し」では、「360度カメラが**標準で付く**最安グレード」と「**オプションで選べる**最安グレード」は全く異なる答えになるため、boolean のままではこの機能を原理的に実装できない。

`unknown` は必須である。既存105件の移行時と、サブプロジェクト2のクロール時に、判別できない装備が必ず発生する。これを `none` に丸めると誤情報になるため、明示的に「不明」を表現し、UI上も「−」として区別して表示する。

### 4.2 models（車種）

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| manufacturer | text | not null |
| manufacturer_slug | text | not null。URL用（例: `toyota`） |
| name | text | not null（例: `プリウス`） |
| slug | text | not null。URL用（例: `prius`） |
| body_type | body_type | not null |
| official_url | text | |
| description | text | |
| created_at / updated_at | timestamptz | |

制約: `unique(manufacturer, name)`、`unique(manufacturer_slug, slug)`

### 4.3 grades（グレード）

| カラム | 型 | 用途 |
|---|---|---|
| id | uuid | PK |
| model_id | uuid | → `models.id` ON DELETE CASCADE |
| name | text | not null（例: `Z`） |
| slug | text | not null |
| price | integer | **円単位**。not null |
| release_date | text | `YYYY-MM` |
| discontinued_at | text | `YYYY-MM`。販売終了。null = 現行 |
| engine_type | engine_type | 検索 |
| drive_system | drive_system | 検索 |
| transmission | transmission | |
| seating | smallint | 検索 |
| displacement | integer | 検索 / TCO（自動車税） |
| weight | integer | TCO（重量税） |
| wltc_mode | numeric(4,1) | 検索・ソート / TCO（燃料費） |
| cruising_range | integer | EV用 |
| eco_car_tax | boolean | TCO（減税） |
| dimensions | jsonb | 表示のみ（全長・全幅・全高・ホイールベース・最小回転半径・最低地上高） |
| performance | jsonb | 表示のみ（最高出力・最大トルク） |
| fuel_detail | jsonb | 表示のみ（市街地・郊外・高速モード） |
| images | jsonb | |
| extra_features | jsonb | コア装備以外の装備（`{ key: feature_availability }`） |
| source_url | text | 出典 |
| fetched_at | timestamptz | 取得日時 |
| verified_at | timestamptz | 人間が確認した日時 |
| created_at / updated_at | timestamptz | |

制約: `unique(model_id, name)`、`unique(model_id, slug)`
インデックス: `price`、`wltc_mode`、`engine_type`、`seating`、`model_id`

### 4.4 コア装備カラム

以下は `grades` の実カラム（型はすべて `feature_availability`、デフォルト `unknown`）として持ち、WHERE句で直接絞り込めるようにする。

**安全装備**: `collision_mitigation_brake`, `false_start_suppression`, `lane_departure_warning`, `lane_keeping_assist`, `adaptive_cruise_control`, `blind_spot_monitor`, `camera_360`, `parking_assist`

**快適装備**: `navigation`, `etc`, `back_camera`, `power_seat`, `seat_heater`, `steering_heater`, `auto_aircon`, `led_headlight`, `smart_key`, `power_back_door`, `hands_free_back_door`, `sunroof`

エアバッグ個数のみ `airbags smallint` として別に持つ（3値ではなく数量のため）。

上記に含まれない装備は `extra_features` (JSONB) に逃がす。全グレード網羅を進めると装備項目は必ず増えるが、その都度マイグレーションを打つのは現実的でないため、「検索対象になるコア装備は実カラム、それ以外はJSONB」という境界を設ける。JSONBに入れた装備が検索需要を持ったら、その時点で実カラムに昇格させる。

### 4.5 設計判断の根拠

**なぜ全部を正規化しないか** — 装備をすべて縦持ちテーブルにすると、複数条件のAND検索が `GROUP BY ... HAVING count(*)` になり、クエリが複雑化し遅くなる。数千行規模では横持ち＋インデックスが単純かつ速い。

**なぜ全部をJSONBにしないか** — インデックスが効かず、価格帯・燃費・装備での絞り込みが全走査になる。

**なぜ `source_url` / `fetched_at` / `verified_at` を最初から持つか** — サブプロジェクト2の収集パイプラインを、スキーマ変更なしに接続するため。またサイトの価値の一つが「鮮度」である以上、「いつ・どこから取得した情報か」は表示すべき一次情報である。

### 4.6 dealers（ディーラー）

既存の `data/dealers.json`（10件）をそのまま移す。拡充や機能追加は行わない。

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| manufacturer | text | not null |
| prefecture | text | not null |
| city | text | |
| address | text | |
| phone | text | |
| business_hours | text | |
| closed_days | text | |
| services | jsonb | 文字列配列 |

インデックス: `prefecture`、`manufacturer`

### 4.7 URL設計

```
/cars/[manufacturer_slug]/[model_slug]            車種ページ（グレード一覧・比較）
/cars/[manufacturer_slug]/[model_slug]?grade=xxx  グレード指定
```

現行の `/cars/[id]` から変更する。サブプロジェクト3の差分ハイライト比較で「同一車種のグレード間比較」を自然に扱うために必要。サイトは未公開のため、リンク切れの実害はない。

## 5. 認証・権限

現行の `admin123` ハードコードと `localStorage` フラグは完全に撤去する。

- **Auth.js v5 + GitHub OAuth**。環境変数の許可リストに載ったGitHubアカウントのみを管理者とする
- `middleware.ts` で `/admin/*` を保護する
- **加えて、各 Server Action の内部でも必ずセッションを再検証する**

3点目は冗長に見えるが意図的である。Next.js のmiddlewareには2025年3月に認可バイパスの脆弱性（CVE-2025-29927、15.2.3で修正）が報告された前例がある。現在インストールされている15.5.6は修正済みだが、**認可をmiddleware単独に依存させない**多層防御を原則とする。

書き込み口は Server Actions のみとし、公開向けの書き込みAPIは存在しない。

## 6. データフローと検証

### 読み取り

```
Server Component → unstable_cache(tag) → Drizzle → Neon
```

### 書き込み

```
管理画面 → Server Action → Zod検証 → Drizzle → Neon → revalidateTag
```

`/api/cars` および `/api/cars/[id]` は廃止する。Route Handler と異なり Server Actions は CSRF 保護が標準で、型をクライアントと共有できる。

**Zodスキーマを単一の真実の源とする。** 同一のスキーマを Server Actions の入口・シードスクリプト・（サブプロジェクト2の）LLM構造化結果の検証で共有し、現行の「APIが無検証で何でも書き込める」問題を構造的に潰す。

公開向けの読み取りAPIは作らない。Server Component から直接読むため不要（YAGNI）。

## 7. 移行手順

1. Neonプロジェクト作成、Drizzleスキーマ定義とマイグレーション
2. シードスクリプト作成（`data/cars.json` 105件 → models / grades）
   - 重複ID2件（アルファード、ステップワゴン）を解消
   - 車種名でグルーピングし models / grades に分解
   - 装備の boolean を `standard` / `none` にマップ。判別できないものは `unknown`
3. UIをServer Component化しつつ移植。**同時に既知バグを修正する**
   - `components/FilterSidebar.tsx:157` 価格フィルタの万円/円の単位バグ
   - `app/quiz/page.tsx` → `app/search/page.tsx` のパラメータ欠落（priceMax / fuelEfficiencyMin / seatingMin / 複数bodyType が無視される）
   - `app/search/page.tsx:38` フィルタ操作でキーワードが消える
   - `components/Header.tsx:72` モバイルのハンバーガーボタンが無反応
   - `app/favorites/page.tsx:69` 「お気に入りを比較」が何もしない
   - `contexts/FavoritesContext.tsx:22` `JSON.parse` の例外未処理
   - 存在しない車両でHTTP 200が返る → `notFound()`
4. 管理画面を Server Actions + Auth.js に置換
5. 旧 `app/api/cars`、`data/*.json`、`scripts/*.js` を削除
6. Vercelデプロイ、環境変数設定

バグ修正を独立フェーズにせず移植と同時に行うのは、どちらも同じファイルを触るためである。

### 既存機能の扱い

- **お気に入り**: 維持（localStorage、`JSON.parse` の例外処理を追加）
- **比較リスト**: 維持。ただし sessionStorage に保存する内容を「Carオブジェクト全体」から「IDの配列」に変更し、実体はサーバーから取得する（データ更新時の陳腐化を防ぐ）
- **おすすめ診断**: 維持し、パラメータ欠落バグを修正
- **ディーラー検索**: 現状10件のみ。データを `dealers` テーブルに移すが、拡充はしない
- **ユーザーレビュー**: **今回は移行せず、機能ごと一旦削除する。** localStorage 保存のため投稿者本人にしか見えず、機能として成立していない。サーバー保存にするとスパム対策の運用負荷が発生するが、個人運営の非商用サイトではその負荷に見合う価値が出るか疑わしい。4つのサブプロジェクト完了後に必要性を再評価する

## 8. エラー処理とテスト

現状テストは0件。本サブプロジェクトでテストの土台を作る。

**Vitest（DB非依存・高速）**
- フィルタ / ソートの純粋関数
- シードの変換ロジック（boolean → `feature_availability`、重複ID解消、車種グルーピング）
- Zodスキーマの境界値

**統合テスト**
- Drizzleクエリを Neon のブランチ機能で用意した実DBに対して実行

**エラー処理**
- `app/error.tsx` と `app/not-found.tsx` を追加
- 存在しない車種は `notFound()` で正しく404を返す
- DB接続失敗時は `error.tsx` にフォールバックし、内部エラー詳細をクライアントに出さない

## 9. 完了条件

1. `npm run build` が ESLint 警告0で通る。現在出ている `@next/next/no-img-element` 警告4件は、`<img>` を `next/image` に置き換えて解消する（`next.config.js` の `remotePatterns: '**'` も、実際に使うホストのみに絞る）
2. 全公開ページが Server Component としてDBから描画され、クライアントバンドルに車両データが含まれない
3. 既存105件が models / grades に移行され、重複IDが解消されている
4. `/admin/*` が GitHub OAuth で保護され、未認証の書き込みが Server Action レベルで拒否される
5. 移行手順3に挙げた既知バグがすべて修正されている
6. Vitest が通り、フィルタ / ソート / シード変換のテストが存在する
7. Vercelにデプロイされ、管理画面での編集が公開ページに反映される

## 10. リスクと未決事項

| 項目 | 内容 | 対応 |
|---|---|---|
| Neonのコールドスタート | 無料枠はアイドル時にサスペンドし、初回接続に数百ms〜数秒かかる | `unstable_cache` で大半のリクエストがDBに到達しないため実害は小さい。問題化したら有料枠を検討 |
| 装備データの `unknown` 混入 | 既存105件は3値の情報を持たないため、移行直後は `standard` / `none` / `unknown` が混在する | サブプロジェクト2のクロールで上書きされる前提。UI上で `unknown` を「−」と明示し、誤情報として表示しない |
| 全グレード網羅時の承認負荷 | 数千件を人間が承認するのは非現実的 | サブプロジェクト2で「新規車種は人間承認 / 既存車種の価格改定など軽微な差分は自動承認」の2段構えを設計する（本書のスコープ外） |
| メーカーのテーブル化 | 現状 `models.manufacturer` は text。ロゴや公式サイト情報を持つなら別テーブルが必要 | 現時点で需要がないため text で開始（YAGNI）。必要になった時点で追加 |
