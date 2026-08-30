import '../load-env';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests } from '@/db/schema';
import { applyChangeRequest, type ApplyResult } from '@/pipeline/apply';

/**
 * 承認キューを処理する。管理画面の「まとめて承認」「適用」と同じ2操作を CLI から行う。
 *
 *   npm run decide -- --model-slug yaris                    # 何が動くかを見るだけ
 *   npm run decide -- --model-slug yaris --approve --apply --by masa
 *
 * 画面から1件ずつ押す運用は車種が増えると成立しない。認可（requireAdmin）は
 * 通らないので、誰の判断かは --by で必ず記録させる。
 *
 * 承認と適用を別の引数にしてあるのは設計どおりで、適用できないものを承認で
 * 壊さないためである（app/actions/changes.ts のコメント参照）。
 */

export class DecideError extends Error {}

export interface DecideOptions {
  modelSlug: string;
  approve: boolean;
  apply: boolean;
  decidedBy: string;
}

export interface DecideSummary {
  pending: Record<string, number>;
  approved: number;
  applied: Record<ApplyResult, number>;
}

interface Row {
  id: string;
  kind: string;
  status: string;
  targetKey: string;
  documentId: string;
}

async function queue(modelSlug: string): Promise<Row[]> {
  const { rows } = await db.execute(sql`
    select cr.id::text as id,
           cr.kind::text as kind,
           cr.status::text as status,
           cr.target_key as "targetKey",
           cr.spec_document_id::text as "documentId"
    from change_requests cr
    join spec_documents sd on sd.id = cr.spec_document_id
    join spec_sources ss on ss.id = sd.spec_source_id
    join models m on m.id = ss.model_id
    where m.slug = ${modelSlug}
    order by cr.kind, cr.target_key
  `);
  return rows as unknown as Row[];
}

export async function decide(options: DecideOptions): Promise<DecideSummary> {
  const rows = await queue(options.modelSlug);
  if (rows.length === 0) {
    throw new DecideError(
      `slug "${options.modelSlug}" の車種に変更要求がありません。` +
        '先に npm run ingest-spec を実行してください',
    );
  }

  const pending: Record<string, number> = {};
  for (const row of rows.filter((r) => r.status === 'pending')) {
    pending[row.kind] = (pending[row.kind] ?? 0) + 1;
  }

  let approved = 0;
  if (options.approve) {
    const documents = [...new Set(rows.map((r) => r.documentId))];
    for (const documentId of documents) {
      const changed = await db
        .update(changeRequests)
        .set({ status: 'approved', decidedBy: options.decidedBy, decidedAt: new Date() })
        .where(
          and(
            eq(changeRequests.specDocumentId, documentId),
            eq(changeRequests.status, 'pending'),
          ),
        )
        .returning({ id: changeRequests.id });
      approved += changed.length;
    }
  }

  const applied = {} as Record<ApplyResult, number>;
  if (options.apply) {
    const documents = [...new Set(rows.map((r) => r.documentId))];
    for (const documentId of documents) {
      // approved と blocked の両方を対象にする。blocked は値が揃えば再適用してよい
      const targets = await db
        .select({ id: changeRequests.id, targetKey: changeRequests.targetKey })
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.specDocumentId, documentId),
            inArray(changeRequests.status, ['approved', 'blocked']),
          ),
        );

      // neon-http にトランザクションが無いため1件ずつ。途中で失敗しても他は進む。
      // applyChangeRequest は条件付き UPDATE で冪等なので二度押しても二重に当たらない
      for (const target of targets) {
        const result = await applyChangeRequest(target.id, options.decidedBy);
        applied[result] = (applied[result] ?? 0) + 1;
        if (result !== 'applied' && result !== 'noop') {
          console.log(`  ${result.padEnd(13)} ${target.targetKey}`);
        }
      }
    }
  }

  return { pending, approved, applied };
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelSlug = args['model-slug'];
  const approve = args.approve === 'true';
  const apply = args.apply === 'true';
  const decidedBy = args.by ?? '';

  if (!modelSlug) {
    throw new DecideError(
      '使い方: npm run decide -- --model-slug <slug> [--approve] [--apply] [--by <名前>]\n' +
        '  引数なしで実行すると、承認待ちの件数を表示するだけで何も変えない',
    );
  }
  if ((approve || apply) && !decidedBy) {
    throw new DecideError(
      '--approve / --apply には --by <名前> が要る。誰の判断かを change_requests に記録するため',
    );
  }

  if (!approve && !apply) {
    const rows = await queue(modelSlug);
    console.log(`${modelSlug} の変更要求 ${rows.length} 件:`);
    const tally: Record<string, number> = {};
    for (const row of rows) {
      const key = `${row.kind} / ${row.status}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(tally).sort()) {
      console.log(`  ${key.padEnd(28)} ${count}`);
    }
    console.log('\n動かすには --approve --apply --by <名前> を付ける');
    return;
  }

  const summary = await decide({ modelSlug, approve, apply, decidedBy });

  if (approve) {
    const detail = Object.entries(summary.pending)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(' / ');
    console.log(`承認: ${summary.approved} 件${detail ? `（${detail}）` : ''}`);
    if (summary.pending.discontinued) {
      console.log(
        '【要確認】廃止 (discontinued) が含まれる。承認は書類単位なので個別に外せない。' +
          '対象がシードの架空データでないかを確かめること',
      );
    }
  }
  if (apply) {
    console.log(
      `適用: ${Object.entries(summary.applied)
        .map(([result, n]) => `${result} ${n}`)
        .join(' / ')}`,
    );
    if (summary.applied.blocked) {
      console.log('  blocked は値が欠けている。値を入れて再実行すれば反映される');
    }
    if (summary.applied.stale) {
      console.log('  stale は対象データが動いていた。差分を見直すこと');
    }
  }
}

if (process.argv[1]?.includes('decide-changes')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
