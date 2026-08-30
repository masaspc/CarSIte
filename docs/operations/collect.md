# 収集パイプラインの運用手順

諸元表PDFの収集は「無人の検知」と「有人の取り込み」に役割が分かれている。
設計の背景は `docs/superpowers/specs/2026-08-14-collection-pipeline-design.md` の6章・7章、
実データで確定した制約は同7.4を参照。

| | 誰が | 何を | APIキー |
|---|---|---|---|
| 無人（週1回） | GitHub Actions（`.github/workflows/collect.yml`、毎週月曜05:00 JST） | PDFが変わったかを sha256 で検知し、原本を `storage/pdfs/<sha256>.pdf` に保存する | 不要 |
| 有人（変更時） | 対話セッションの Claude | 保存されたPDFを読んで諸元を起こし、承認キューに積む | 不要 |
| 先送り（未定） | 未定 | 全車種の装備確認（色の判定にLLMが要る） | 要る見込み |

週次ジョブ（`npm run collect`）は変更検知だけを行う。`change_requests` は作らない。
`spec_documents` に「どの車種のどの年月が変わったか」という事実を記録するところで止まる。

## 変更を検知したときの手順

週次ジョブのログ（GitHub Actions の実行結果）に `<車種名>: <年月> は前回と内容が違う` という
行が出たら、以下を行う。

1. **`spec_documents` を見て、どの車種のどの年月が変わったかを確認する**

   ```bash
   npx tsx -e "
   import './load-env';
   import { db } from './db';
   import { sql } from 'drizzle-orm';
   void (async () => {
     const { rows } = await db.execute(sql\`
       select sd.id, sd.document_month, sd.sha256, sd.stored_path, m.name, m.manufacturer
       from spec_documents sd
       join spec_sources ss on ss.id = sd.spec_source_id
       join models m on m.id = ss.model_id
       order by sd.fetched_at desc\`);
     console.log(rows);
   })();
   "
   ```

2. **`storage/pdfs/<sha256>.pdf` の原本を Claude Code に読ませる**

   ステップ1で確認した `sha256` から原本のパスが分かる。対話セッションでこのPDFを読み、
   諸元（型式・重量・寸法・燃費など）を書き起こす。装備一覧・価格は原本に載っていないため
   書き起こしの対象外（下記「装備の取り込みは未対応」「価格が取れない」を参照）。

3. **`tests/fixtures/<model-slug>.spec.json` を更新する**

   `ExtractedSpecSchema`（`pipeline/extraction-schema.ts`）の形に合わせて書く。
   既存ファイル `tests/fixtures/prius.spec.json` が実例になる。JSONはリポジトリにコミットし、
   何をどう読んだかを差分で追えるようにする。

4. **取り込む**

   ```bash
   npm run ingest-spec -- --model-slug <slug>
   ```

   `--file <path>` で既定のパス（`tests/fixtures/<slug>.spec.json`）以外を指定できる。
   既存グレードとの差分を計算し、`change_requests` に積む。同じ内容を二度積むことはない
   （`spec_document_id` + `kind` + `target_key` の一意制約）。

5. **`/admin/changes` で確認して承認する**

   承認・却下は諸元表（PDF）**単位**でまとめて行う。個々の変更を選んで承認することはできない
   （`app/actions/changes.ts` の `approveDocument` / `rejectDocument` は、その書類に紐づく
   `pending` の行をすべて同じ状態に変える）。

   **新しいグレード（`new_grade`）を含む書類は、そのままでは承認しないこと。**
   理由は次の「新規グレードは承認できない」を参照。

   > 承認は `change_requests.status` を `approved` にするところまでで、`grades` への実際の
   > 反映は `pipeline/apply.ts` の `applyChangeRequest` が行う設計になっている
   > （設計書6.0.2）。ただし本書執筆時点では、これを呼び出すスクリプト・cronは実装されて
   > おらず、テスト以外に呼び出し元がない。**承認しても `grades` は自動更新されず、
   > `change_requests.status` は `approved` のまま止まる（`stale` にはならない）。**
   > 将来 apply が配線された時点で、その行が実行されて初めて `stale`（または
   > 適用成功）になる。

   一方で、一意制約 `(spec_document_id, kind, target_key)` は `status` を見ない。
   承認・却下・保留のいずれであっても、同じ書類・種別・対象の行が既に存在すれば
   `ingest-spec` の `onConflictDoNothing` が静かに飛ばす。**再取り込みができないのは
   一意制約のせいであって、`stale` になるからではない。** 値を訂正したい場合は、
   該当する `change_requests` 行を削除してから再実行すること（`ingest-spec` の
   出力で `重複で飛ばした分` が0件より多いときはこの状態を疑う）。

## 新規グレードは承認できない（重要）

`grades.price` は `NOT NULL` だが、諸元表に車両本体価格は載っていない。原本にはこう
書かれている。

> 価格は販売店が独自に定めていますので、詳しくは各販売店にお尋ねください。

そのため `pipeline/apply.ts` の `buildNewGradeValues` は、価格の無い `new_grade` の作成を
拒む（`markStale` に倒す）。**諸元表からの取り込みは既存グレードの諸元を更新できるが、
新しいグレードは作れない。** 新規グレードの作成には価格の取得元（設計書7.4の案B）か、
管理画面での人手入力が要る。詳しくは設計書7.4を参照。

**現在の状態:** プリウス（2026-07版）の諸元表には `new_grade` が8件、`discontinued` が1件、
同じ書類として承認キューに `pending` のまま残っている。承認は書類単位でしか行えないため、
この書類を「まとめて承認」すると `discontinued` の1件と一緒に `new_grade` 8件も承認される。
`applyChangeRequest` を呼ぶコードは今のところ無いので、承認しても即座に `grades` が
壊れるわけではない（`approved` のまま止まる）。それでも**価格の取得元が決まるまでは、
この書類は承認も却下もしないこと。** 将来 apply が配線されたときに `new_grade` 8件が
一括で `stale` に倒れるのを避けるため、また意図と異なる承認状態を残さないためである。
これは異常ではなく、意図して保留している正常な状態である（却下すると `discontinued` の
判断も失われ、一意制約のため再送出もできなくなる）。

他の車種でも同様に、承認前に対象書類へ `new_grade` が含まれていないかを確認すること。
含まれる場合は、価格の問題が解決するまで承認・却下を保留する。

## 新しい車種を登録する手順

```bash
npm run register-source -- --model-slug <slug> --base-url <url>
```

`<url>` は諸元表PDFのベースパス。年月（`202607`）と `.pdf` を後ろに足してURLを組み立てるため、
末尾は必ず `_` にすること（例: `https://toyota.jp/pages/contents/prius/002_p_002/pdf/spec_`）。
`<slug>` は既存の `models.slug` と一致させる。

## EVを登録できない理由

`spec_sources` に登録できるのは、燃費（`wltc_mode`）が km/L 単位で表現される車種に限られる。
EVの電費は Wh/km（あるいは km/kWh）で、単位系そのものが異なるため、既存の
`wltc_mode` 列にそのまま入れることができない。EVを扱うには列の追加を含む設計変更が要る。

## 装備の取り込みは未対応

諸元表の主要諸元（型式・重量・寸法・燃費など）はテキストとして機械的に取得できるが、
装備一覧表は「緑＝標準装備／橙＝メーカーオプション／青＝販売店装着オプション」という
**色**で情報を表しており、テキスト抽出では色の情報が落ちる。判定にはPDFを画像として
読めるLLM（Vision）が要り、これには現状 `ANTHROPIC_API_KEY` などのAPIキーが要る見込み。

このサブプロジェクトの範囲では装備の取り込みは行わない。必要な車種について、
別のタイミング（先送り欄）で改めて対応する。`ingest-spec` に渡すJSONでも `features` は
任意項目であり、省略しても検証には通る（`computeChanges` の `compareFeatures: false` により、
装備を比較対象から外しているため、空振りの変更も立たない）。

## 価格が取れないこと

上記「新規グレードは承認できない」のとおり、諸元表に車両本体価格は載っていない。
`ingest-spec` は価格・装備の両方を比較対象から外して差分を計算する
（`comparePrice: false, compareFeatures: false`）。価格改定そのものの検知は、
別の取得元（価格表PDF・グレード比較ページ等）が用意されるまで、このパイプラインの
対象外になっている。詳細と対処案（A/B/C）は設計書7.4を参照。

## 現状の登録状況

`spec_sources` にはトヨタのプリウスとヤリスが登録済み。EVは前述の理由で登録できない。
