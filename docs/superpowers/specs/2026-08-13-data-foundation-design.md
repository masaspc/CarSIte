# データ基盤 設計書

- **作成日**: 2026-08-13
- **対象**: サブプロジェクト1「データ基盤」
- **ステータス**: 改訂版（Codexレビュー反映済み・実装計画待ち）

## 0. 改訂履歴

| 版 | 内容 |
|---|---|
| 初版 | 承認済み設計 |
| 改訂版 | 第三者レビュー（Codex）の致命的3件・重大5件を反映。あわせて**既存105件の59%が機械生成の架空データである**ことが判明したため、既存データの位置づけを「移行対象の資産」から「開発用フィクスチャ」に変更した |

初版に含まれていた「重複2組は全フィールドが完全一致する」という記述は**誤りだった**。実際は8フィールド・9フィールドで値が食い違う（詳細は3章）。

## 1. 背景

既存の日本車比較サイト（Next.js 15 + TypeScript + Tailwind、約4,100行）は、UI・型定義・比較UXの水準は実用に足るが、データ層に構造的な問題を抱えている。

- 表示側は `data/cars.json` をビルド時に静的インポートし、管理APIは `fs.writeFileSync` で同ファイルを書き換える。**管理画面の編集がサイトに反映されない**うえ、サーバーレス環境では書き込み自体が失敗する
- `/api/cars` の POST / PUT / DELETE に**認証が一切ない**。管理画面のログインはパスワードをクライアントJSにハードコードし、認証状態を `localStorage` に置いているだけで、実質的な防御になっていない
- 全ページが `'use client'` のため、190KBの車両データが全ページのクライアントバンドルに同梱される。SSR/SSGの利点を捨てており、詳細ページに `generateMetadata` もない
- 車両IDが2件重複しており、DELETE が2件まとめて消える
- テストが0件

これらは個別のバグではなく「JSONファイルを唯一のデータストアにした」ことの必然的な帰結であり、データ層の入れ替えなしには解消できない。

## 2. プロジェクト全体の分割と本書の位置

最終目標は「国産新車を全グレード網羅し、自動収集で鮮度を保つ比較サイト」である。目標として選ばれた4つの価値はすべて共通のデータ基盤に依存するため、順序はほぼ一意に決まる。

| # | サブプロジェクト | 中身 |
|---|---|---|
| **1** | **データ基盤（本書）** | Vercel + Postgres 移行、スキーマ再設計、公開制御、認証 |
| 2 | 収集パイプライン | クロール → LLM構造化 → 2段階承認 → 全グレード網羅（**実データはここで入る**） |
| 3 | 比較体験のコア | 差分ハイライトUI + 装備×価格の最適グレード検索 |
| 4 | TCO試算 | 税・保険・燃料費・車検の5年試算 |

各サブプロジェクトは独立した 設計 → 計画 → 実装 のサイクルを持つ。本書はサブプロジェクト1のみを対象とする。

### 前提条件

- **位置づけ**: インターネットに公開するが、非商用・個人運営
- **データ範囲（最終形）**: 国産新車・全グレード網羅（数千レコード規模）
- **更新方式（最終形）**: 収集は自動、公開は承認制

### 本書のスコープ外

- クローラ、LLMによる構造化、承認キューUI、版管理・承認履歴（サブプロジェクト2）
- グレードの識別単位（世代・年次改良・パワートレイン違いをどう別レコードにするか）の確定（サブプロジェクト2。理由は3章）
- 差分ハイライト比較、装備×価格の最適グレード検索（サブプロジェクト3）
- TCO試算ロジック（サブプロジェクト4）
- E2Eテスト（比較UIが固まるサブプロジェクト3まで保留）
- 既存機能（レビュー・ディーラー検索・おすすめ診断・お気に入り）の機能拡張。移行とバグ修正のみ行う

## 3. 既存データの信頼性と扱い

**本サブプロジェクトの前提を決める最も重要な事実である。**

`data/cars.json` の105件は一次情報に基づいていない。`scripts/generate-more-cars.js` は諸元を機械的に捏造している。

```js
const price = basePrice + (index * 100000);   // 価格 = 基準額 + 配列の順番 × 10万円
"weight": isKei ? 900 : 1500,                  // 重量は軽900kg / それ以外は一律1500kg
"wltcMode": isKei ? 24.0 : 20.0,               // 燃費も一律
```

この署名に一致するレコードは **105件中62件（59%）**。結果として、日産フェアレディZが「1500kg・燃費20.0km/L・310万円」、スカイラインが「250万円」として登録されている。グレード名は72件が一律 `X`、発売日も大半が `2023-01` である。

### 帰結

1. **既存105件は「移行対象の資産」ではなく「開発用フィクスチャ」である。** スキーマの妥当性・UIの描画・クエリ性能を検証するための足場として使い、正しいデータはサブプロジェクト2のクロールで投入する
2. **重複2組を一次情報で解決する必要はない。** 「トヨタ アルファード X」は8フィールド、「ホンダ ステップワゴン AIR」は9フィールドで値が食い違い（後者は `CVT` / `電気式無段変速機` の差があり、ガソリン車と e:HEV が同一グレード名で並んでいることを示唆する）、単純な重複ではない。しかしどちらの値も信頼できないため、正解を調べる作業に意味がない。シードは**エラーで停止**させ、フィクスチャとしては片方を任意に採用する
3. **グレードの識別単位を今は確定できない。** 実在のグレード体系（世代・年次改良・2WD/4WD・ガソリン/HEV）は、クロールして初めて分かる。架空データを前に「バリアント識別子」を設計しても外れる。サブプロジェクト2で実データを見てから決める
4. **このデータを公開してはいけない。** 非商用であっても、誤った車両情報を公開するサイトは有害である。よって**公開制御をサブプロジェクト1の必須要件とする**（6章）

### 初版からの方針変更

初版は「`source_url` / `fetched_at` / `verified_at` を持たせればサブプロジェクト2をスキーマ変更なしに接続できる」と主張していたが、これは**誤りだった**。公開状態・承認者・承認日時を持たない限り、未検証データを公開クエリから確実に除外できない。本改訂で公開制御を導入する（承認履歴と版管理はサブプロジェクト2に残す）。

## 4. アーキテクチャ

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
- クライアント状態（お気に入り・比較リストのUI操作）を持つ部分のみ、小さな Client Component として切り出す

キャッシュは `unstable_cache` にタグを付与し、公開操作時に `revalidateTag` で無効化する。タグ粒度は「全車両」「車種単位」の2階層とし、グレード更新時は車種タグ、一括操作時は全体タグを落とす。

## 5. データモデル

現行の「グレード単位のフラットな105件」を、車種とグレードの2階層に正規化する。

### 5.1 enum

```
body_type            : 軽自動車 | コンパクトカー | セダン | ハッチバック |
                       ステーションワゴン | SUV | ミニバン | スポーツカー | クーペ
engine_type          : ガソリン | ハイブリッド | EV | ディーゼル | PHEV
drive_system         : FF | FR | 4WD | MR | RR
transmission_type    : CVT | AT | MT | DCT | 電気式無段変速機 | other
feature_availability : standard | option | none | unknown
publication_status   : draft | published | archived
```

**トランスミッションを enum 単体で持たない理由** — 既存の `types/car.ts` は `Transmission` を5値のenumとして定義しているが、実データには `6AT`・`10AT` が含まれており、**既に型定義に違反している**（`as Car[]` のキャストで型チェックを迂回しているため検出されていない）。そのままPostgresのenumにするとシードが失敗する。

全グレードを網羅すれば `7DCT`・`6MT`・`e-CVT` のような表記はさらに増えるため、**原文表記と検索用の分類を分ける**。

- `transmission` (text) — 諸元表の原文をそのまま保持（例: `6AT`）。表示用
- `transmission_type` (enum) — 検索用に正規化した分類（例: `AT`）
- `gear_count` (smallint, null可) — 段数（例: `6`）

分類できない表記は `other` に落とし、原文は必ず残す。情報を失わずに検索可能性を確保するための分離である。

**`feature_availability` が本設計の中核である。** 現行スキーマは装備を `true` / `false` で持つが、実際の諸元表は「標準装備 / メーカーオプション / 設定なし」の3値である。サブプロジェクト3の「装備×価格の最適グレード探し」では、「360度カメラが**標準で付く**最安グレード」と「**オプションで選べる**最安グレード」は全く異なる答えになるため、boolean のままではこの機能を原理的に実装できない。

`unknown` は必須である。これを `none` に丸めると誤情報になるため、明示的に「不明」を表現し、UI上も「−」として区別して表示する。

### 5.2 models（車種）

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK（内部用） |
| manufacturer | text | not null |
| manufacturer_slug | text | not null。**公開識別子**（例: `toyota`） |
| name | text | not null（例: `プリウス`） |
| slug | text | not null。**公開識別子**（例: `prius`） |
| body_type | body_type | not null |
| official_url | text | |
| description | text | |
| created_at / updated_at | timestamptz | |

制約: `unique(manufacturer, name)`、`unique(manufacturer_slug, slug)`
インデックス: `body_type`

### 5.3 grades（グレード）

| カラム | 型 | 用途 |
|---|---|---|
| id | uuid | PK（内部用） |
| model_id | uuid | → `models.id` ON DELETE CASCADE |
| name | text | not null（例: `Z`） |
| slug | text | not null。**公開識別子** |
| **publication_status** | publication_status | not null default `draft`。**公開制御** |
| price | integer | **円単位**。not null |
| release_date | text | `YYYY-MM`。CHECK制約で形式を強制 |
| discontinued_at | text | `YYYY-MM`。販売終了。null = 現行 |
| engine_type | engine_type | 検索 |
| drive_system | drive_system | 検索 |
| transmission | text | 諸元表の原文（例: `6AT`）。表示用 |
| transmission_type | transmission_type | 検索用の正規化分類 |
| gear_count | smallint | 段数。null可 |
| seating | smallint | 検索 |
| displacement | integer | 検索 / TCO（自動車税） |
| weight | integer | TCO（重量税） |
| wltc_mode | numeric(4,1) | 検索・ソート / TCO（燃料費） |
| cruising_range | integer | EV用 |
| eco_car_tax | boolean | TCO（減税） |
| airbags | smallint | 数量のため3値化しない |
| dimensions | jsonb | 表示のみ |
| performance | jsonb | 表示のみ（最高出力・最大トルク） |
| fuel_detail | jsonb | 表示のみ（市街地・郊外・高速モード） |
| images | jsonb | |
| extra_features | jsonb | コア装備以外（`{ key: feature_availability }`） |
| source_url | text | 出典 |
| fetched_at | timestamptz | 取得日時 |
| verified_at | timestamptz | 人間が内容を確認した日時 |
| verified_by | text | 確認者（GitHubログイン名） |
| created_at / updated_at | timestamptz | |

制約: `unique(model_id, name)`、`unique(model_id, slug)`

**この一意制約は暫定である。** 実在のグレード体系では同名グレードが駆動方式やパワートレイン違いで複数存在しうる（3章の帰結3）。サブプロジェクト2で実データを見てから、識別単位を確定して制約を張り直す。

### 5.4 コア装備カラム

以下は `grades` の実カラム（型はすべて `feature_availability`、デフォルト `unknown`）として持ち、WHERE句で直接絞り込めるようにする。

**安全装備**: `collision_mitigation_brake`, `false_start_suppression`, `lane_departure_warning`, `lane_keeping_assist`, `adaptive_cruise_control`, `blind_spot_monitor`, `camera_360`, `parking_assist`

**快適装備**: `navigation`, `etc`, `back_camera`, `power_seat`, `seat_heater`, `steering_heater`, `auto_aircon`, `led_headlight`, `smart_key`, `power_back_door`, `hands_free_back_door`, `sunroof`

上記に含まれない装備は `extra_features` (JSONB) に逃がす。全グレード網羅を進めると装備項目は必ず増えるが、その都度マイグレーションを打つのは現実的でないため、「検索対象になるコア装備は実カラム、それ以外はJSONB」という境界を設ける。JSONBに入れた装備が検索需要を持ったら、その時点で実カラムに昇格させる。

### 5.5 設計判断の根拠

**なぜ装備を縦持ちテーブルにしないか** — 複数条件のAND検索が `GROUP BY ... HAVING count(*)` になり、クエリが複雑化する。数千行規模では横持ち＋インデックスの方が単純で速い。

**なぜ全部をJSONBにしないか** — Postgresの JSONB は GIN や式インデックスを使えるため「インデックスが効かない」わけではない。横持ちを選ぶ理由は、**型安全性（enumで値域を強制できる）・クエリの単純さ・スキーマが自己文書化されること**であって、インデックスの可否ではない。

**なぜ公開識別子をUUIDにしないか** — 5.7参照。

### 5.6 price_history（価格推移）

現行 `data/cars.json` の11件が `priceHistory` を持ち、`components/PriceHistoryChart.tsx` で描画されている。グレードを別テーブルに分離する以上、価格推移も独立テーブルにする。

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| grade_id | uuid | → `grades.id` ON DELETE CASCADE |
| date | text | `YYYY-MM`。CHECK制約で形式を強制 |
| price | integer | 円 |
| source_url | text | 出典 |
| recorded_at | timestamptz | 記録日時 |

制約: `unique(grade_id, date)`
インデックス: `grade_id`

**サブプロジェクト2との接続** — 2で「既存車種の価格改定は自動承認」とする方針である以上、価格改定を検出した時点で本テーブルに1行追加する運用が自然に成立する。価格推移が収集パイプラインの副産物として全グレードで自動的に蓄積されていくため、本テーブルは既存機能の維持ではなく、鮮度という価値を裏付ける資産になる。

### 5.7 公開識別子とURL設計

**PKはUUIDだが、外部に出す識別子はslugとする。**

```
/cars/[manufacturer_slug]/[model_slug]            車種ページ（グレード一覧・比較）
/cars/[manufacturer_slug]/[model_slug]?grade=xxx  グレード指定
```

UUIDを公開識別子にすると、再シードで値が変わったときに共有URLとお気に入りが全滅し、URLも読めない。slugなら再シードに耐え、人間が読める。

- **お気に入り・比較リストはグレード単位**で `manufacturer_slug/model_slug/grade_slug` の複合文字列を localStorage / sessionStorage に保存する。価格も装備もグレードで変わるため、車種単位では比較の意味をなさない
- 保存されたslugが解決できない場合（グレード廃止・改名）は、UIで「掲載終了」と表示して比較対象から除外する。黙って消さない
- 現行の `/cars/[id]` から変更する。サイトは未公開のためリンク切れの実害はない

## 6. 公開制御と承認モデル

3章の帰結4により、**未検証データが公開されない仕組みを本サブプロジェクトで作る**。

- `grades.publication_status` は `draft` / `published` / `archived` の3値、デフォルトは `draft`
- **公開ページのクエリは必ず `publication_status = 'published'` で絞る。** この条件は Drizzle のクエリヘルパに封じ込め、公開側から素のテーブルを直接引かせない
- 管理画面のみ `draft` を閲覧・編集できる
- `published` に遷移させる Server Action は、`verified_at` と `verified_by` を同時に記録する
- 既存105件のシードは**全件 `draft`** で投入する。したがって移行直後の公開サイトは0件になる。これは正しい状態である

**本サブプロジェクトに含めないもの**（サブプロジェクト2に送る）: 承認前後の差分保持、版管理とロールバック、自動承認と人間承認の区別、承認履歴テーブル、クロール結果と公開レコードの分離。

## 7. 検索の設計

現行の検索は全件をクライアントに読み込んで純粋関数で絞り込んでいる。数千件を扱う以上これは成立しないため、設計を差し替える。

### フィルタ状態はURL検索パラメータを単一の真実の源とする

現行はフィルタ状態を `useState` に持ち、URLパラメータと二重管理になっている。これが「サイドバーを触るとキーワードが消える」バグの原因であり、状態をURLに一本化することが**根治策**になる。同時に、診断ページから渡されるパラメータが無視される問題も、受け側が全パラメータをURLから読む構造にすることで解消する。

### クエリ

- 検索ページは Server Component が `searchParams` を読み、Drizzle クエリを組み立てる
- ページネーションは offset / limit、1ページ24件。総件数は別カウントクエリ
- `body_type` は `models` 側にあるため join する。`models` は数百行、`grades` は数千行であり、この規模の join は問題にならない。実測で問題が出たら `grades` への非正規化コピーを検討する
- **複合インデックス**: `(publication_status, price)`、`(publication_status, wltc_mode)`。公開フィルタが全クエリに付くため、先頭に置く

### NULL と unknown の扱い

- 「燃費が良い順」のソートで `wltc_mode` が null（EV等）のレコードは **NULLS LAST**
- 装備での絞り込みは `standard` のみをヒットとし、`unknown` は**ヒットさせない**。「不明」を「装備あり」として扱うと誤情報になるため
- 検索結果の件数表示は、この方針で除外されたものを含めない

## 8. 認証・権限

現行の `admin123` ハードコードと `localStorage` フラグは完全に撤去する。

- **Auth.js v5 + GitHub OAuth**。環境変数の許可リストに載ったアカウントのみを管理者とする。照合は**GitHubの数値user ID**で行う（ログイン名は変更可能で、別人が取得しうるため）
- `middleware.ts` で `/admin/*` を保護する
- **加えて、各 Server Action の内部でも必ずセッションを再検証する**

3点目は冗長に見えるが意図的である。Next.js のmiddlewareには2025年3月に認可バイパスの脆弱性（CVE-2025-29927、15.2.3で修正）が報告された前例がある。現在インストールされている15.5.6は修正済みだが、**認可をmiddleware単独に依存させない**多層防御を原則とする。

書き込み口は Server Actions のみとし、公開向けの書き込みAPIは存在しない。

## 9. データフローと検証

```
読み取り: Server Component → unstable_cache(tag) → Drizzle(published限定) → Neon
書き込み: 管理画面 → Server Action → 認証確認 → Zod検証 → Drizzle → Neon → revalidateTag
```

`/api/cars` および `/api/cars/[id]` は廃止する。Route Handler と異なり Server Actions は CSRF 保護が標準で、型をクライアントと共有できる。

**Zodスキーマを単一の真実の源とする。** 同一のスキーマを Server Actions の入口・シードスクリプト・（サブプロジェクト2の）LLM構造化結果の検証で共有し、現行の「APIが無検証で何でも書き込める」問題を構造的に潰す。

公開向けの読み取りAPIは作らない。Server Component から直接読むため不要（YAGNI）。

## 10. 移行手順

1. Neonプロジェクト作成、Drizzleスキーマ定義とマイグレーション
2. シードスクリプト作成（`data/cars.json` → models / grades / price_history、**全件 `draft`**）
   - 車種名でグルーピングし models / grades に分解
   - **重複グレード**: `(manufacturer, model, grade)` で検出し、**エラーで停止**して一覧を出力する。フィクスチャとしては片方を任意採用する（3章の帰結2）
   - **装備のマッピング**: `true` → `standard`、**`false` → `unknown`**。既存の `false` は機械生成された既定値であり「設定なし」の根拠がないため、`none` に丸めない
   - `transmission` の原文を保持しつつ `transmission_type` / `gear_count` を導出（`6AT` → `AT` + `6`）。分類できない表記は `other` とし、シードログに一覧を出力する
   - `priceHistory` を持つ11件を `price_history` に展開
3. UIをServer Component化しつつ移植。**同時に既知バグを修正する**
   - `components/FilterSidebar.tsx:157` 価格フィルタの万円/円の単位バグ
   - `app/quiz/page.tsx` → `app/search/page.tsx` のパラメータ欠落（7章のURL一本化で根治）
   - `app/search/page.tsx:38` フィルタ操作でキーワードが消える（同上）
   - `components/Header.tsx:72` モバイルのハンバーガーボタンが無反応
   - `app/favorites/page.tsx:69` 「お気に入りを比較」が何もしない
   - `contexts/FavoritesContext.tsx:22` `JSON.parse` の例外未処理
   - 存在しない車種でHTTP 200が返る → `notFound()`
4. 管理画面を Server Actions + Auth.js に置換し、公開状態の切り替えUIを追加
5. 旧 `app/api/cars`、`data/*.json`、`scripts/*.js` を削除（`data/cars.json` はテストフィクスチャとして `tests/fixtures/` へ移動）
6. Vercelデプロイ、環境変数設定

バグ修正を独立フェーズにせず移植と同時に行うのは、どちらも同じファイルを触るためである。

### 既存機能の扱い

- **お気に入り**: 維持。localStorage、`JSON.parse` の例外処理を追加、保存形式をslug複合文字列に変更
- **比較リスト**: 維持。sessionStorage の保存内容を「Carオブジェクト全体」からslug配列に変更し、実体はサーバーから取得する
- **おすすめ診断**: 維持し、パラメータ欠落バグを修正
- **ディーラー検索**: 現状10件のみ。`dealers` テーブル（既存JSONと同項目）に移すが拡充はしない
- **ユーザーレビュー**: **今回は移行せず、機能ごと一旦削除する。** localStorage 保存のため投稿者本人にしか見えず、機能として成立していない。サーバー保存にするとスパム対策の運用負荷が発生するが、個人運営の非商用サイトではその負荷に見合う価値が出るか疑わしい。4つのサブプロジェクト完了後に再評価する

## 11. エラー処理とテスト

現状テストは0件。本サブプロジェクトでテストの土台を作る。

**Vitest（DB非依存・高速）**
- 検索パラメータ → クエリ条件への変換
- シードの変換ロジック（装備マッピング、車種グルーピング、`priceHistory` の展開）
- 重複グレードの検出（エラーで停止することを検証する）
- `transmission` の分類導出（`6AT` → `AT` + `6`、未知表記 → `other` かつ原文保持）
- Zodスキーマの境界値

**統合テスト（Neonのブランチ機能で用意した実DBに対して）**
- **未認証の Server Action がすべて拒否される**
- **許可リスト外のGitHubアカウントが拒否される**
- **公開クエリが `draft` を1件も返さない**
- 作成・更新・削除の後にキャッシュが無効化される
- 一意制約違反・外部キー違反でトランザクションがロールバックする

認可と書き込み経路は本サブプロジェクトで最もリスクが高い箇所であり（現行が無防備であるため）、E2Eを後回しにしてもここは統合テストで担保する。

**エラー処理**
- `app/error.tsx` と `app/not-found.tsx` を追加
- 存在しない車種は `notFound()` で正しく404を返す
- DB接続失敗時は `error.tsx` にフォールバックし、内部エラー詳細をクライアントに出さない

## 12. 完了条件

1. `npm run build` が ESLint 警告0で通る。現在の `@next/next/no-img-element` 警告4件は `<img>` を `next/image` に置き換えて解消し、`next.config.js` の `remotePatterns: '**'` も実際に使うホストのみに絞る
2. 全公開ページが Server Component としてDBから描画され、クライアントバンドルに車両データが含まれない
3. `6AT` / `10AT` を含む全105件がフィクスチャとして enum 制約違反なくシードでき、原文が `transmission` に保持されている
4. 重複グレード2組でシードがエラー停止し、該当レコードが一覧出力される
5. `priceHistory` を持つ11件が `price_history` に移行され、価格推移グラフが描画される
6. **シード直後の公開サイトが0件表示になる**（全件 `draft` のため）。管理画面で `published` にしたグレードのみが公開ページに現れる
7. `/admin/*` が GitHub OAuth（数値user IDで照合）で保護され、未認証の書き込みが Server Action レベルで拒否される
8. 検索のフィルタ状態がURLに反映され、リロードと共有で再現する
9. 移行手順3に挙げた既知バグがすべて修正されている
10. Vitest と統合テストが通り、11章に挙げたテストが存在する
11. Vercelにデプロイされ、管理画面での公開操作が公開ページに反映される

## 13. リスクと未決事項

### 本サブプロジェクトで対応する

| 項目 | 内容 | 対応 |
|---|---|---|
| Neonのコールドスタート | 無料枠はアイドル時にサスペンドし、初回接続に数百ms〜数秒かかる | `unstable_cache` で大半のリクエストがDBに到達しないため実害は小さい。問題化したら有料枠を検討 |
| 装備の `unknown` 大量発生 | 既存 `false` を `unknown` に寄せるため、フィクスチャは大半が `unknown` になる | 意図した挙動。UIで「−」と表示し、装備検索でヒットさせない |
| 公開0件からの立ち上げ | シード直後は公開データが存在しない | サブプロジェクト2完了までサイトを一般公開しない。それまでは管理画面で動作確認する |

### 意図的に先送りする（レビュー指摘のうち本書に取り込まなかったもの）

| 項目 | 送り先 | 理由 |
|---|---|---|
| グレードの識別単位（世代・年次改良・パワートレイン違い） | サブプロジェクト2 | 実在のグレード体系はクロールして初めて分かる。架空データを前に設計しても外れる |
| 承認履歴・版管理・ロールバック・自動承認の記録 | サブプロジェクト2 | 承認フローの設計と一体で決めるべき。本書は「未検証を公開しない」ゲートのみ持つ |
| JSONB内部キーの命名規約・feature catalog | サブプロジェクト2 | `extra_features` に何が入るかはクロール結果に依存する |
| 環境分離・バックアップ/復元手順・監査ログ | 実装計画 | 設計事項ではなく運用手順。writing-plans で具体化する |
| `eco_car_tax` が制度変更に追随できるか | サブプロジェクト4 | TCO試算の設計時に、時点と制度をどうモデル化するか併せて決める |
| EVの電費を `wltc_mode` と共用するか | サブプロジェクト2 | 実データの単位表記を見てから決める |
