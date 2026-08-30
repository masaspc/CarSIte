import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_LEGEND,
  classify,
  findColumns,
  labelsNear,
  parseBbox,
  parsePpm,
  sampleCell,
  scanBands,
  toFeatureAvailability,
  type Band,
  type Column,
  type Word,
} from '@/pipeline/equipment-grid';

/**
 * 諸元表の装備一覧表を読む。
 *
 *   npm run read-equipment -- --pdf storage/pdfs/<sha256>.pdf --pages 3,4,5
 *
 * ページを画像に書き出してセルの背景色を判定し、行の帯ごとに結果を出す。
 * 外部APIは使わない。poppler（pdftoppm / pdftotext）と qpdf に依存する。
 *
 * **出力をそのまま信じてはいけない。** どの帯がどの装備の行かは人が確かめる。
 * ラベルの上端は行の上端より3〜5pt上に出ることがあり、機械的に対応づけると
 * 1行ずれる。「候補」として出しているのはそのためである。
 * 詳しくは docs/operations/collect.md の「装備の読み取り方」。
 */

const DPI = 300;
/** 列見出しより下だけを走査する。表頭と凡例を拾わないため */
const SCAN_FROM = 68;
/** 左端のこれより左にある語を行ラベルとみなす（pt） */
const LABEL_RIGHT_OF = 240;

class ReadEquipmentError extends Error {}

async function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) =>
      reject(
        new ReadEquipmentError(
          `${command} を実行できません（${error.message}）。` +
            'poppler と qpdf が要る: brew install poppler qpdf',
        ),
      ),
    );
    child.on('close', (code) => {
      // pdftoppm は「Invalid Font Weight」などの警告で 0 以外を返すことがある。
      // 出力が取れていれば警告として扱う
      if (code !== 0 && out.length === 0) {
        reject(
          new ReadEquipmentError(
            `${command} が失敗しました（終了コード ${code}）: ${Buffer.concat(err).toString().slice(0, 300)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(out));
    });
  });
}

/** 諸元表は編集制限のために暗号化されている。pdftoppm に渡す前に外す */
async function decrypted(pdfPath: string, directory: string): Promise<string> {
  const output = path.join(directory, 'decrypted.pdf');
  const bytes = await run('qpdf', ['--decrypt', pdfPath, '-']);
  if (bytes.length === 0) {
    throw new ReadEquipmentError(`${pdfPath} の復号に失敗しました`);
  }
  await writeFile(output, bytes);
  return output;
}

interface PageReading {
  page: number;
  columns: Column[];
  bands: Band[];
  words: Word[];
}

async function readPage(pdf: string, page: number): Promise<PageReading> {
  const bboxXml = (
    await run('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), pdf, '-'])
  ).toString('utf8');
  const words = parseBbox(bboxXml);

  const columns = findColumns(words);
  if (columns.length === 0) {
    throw new ReadEquipmentError(
      `${page}ページに列見出し（Z / G / X などの1文字）が見つかりません。` +
        '装備一覧表のページ番号を確認してください',
    );
  }

  const bitmap = parsePpm(await run('pdftoppm', ['-r', String(DPI), '-f', String(page), '-l', String(page), pdf]));
  const scale = DPI / 72;
  // 列の間隔の4割を半幅にする。罫線と隣の列に触れない範囲で広く取る
  const halfWidth = columns.length > 1 ? (columns[1].center - columns[0].center) * 0.4 : 20;

  const sample = (y: number) =>
    columns.map((column) => {
      const color = sampleCell(bitmap, scale, column.center, y, halfWidth, 0.7);
      return color ? classify(color, DEFAULT_LEGEND) : null;
    });

  const bands = scanBands(sample, { from: SCAN_FROM, to: bitmap.height / scale - 4 });
  return { page, columns, bands, words };
}

function report(reading: PageReading): void {
  const { page, columns, bands, words } = reading;
  console.log(`\n=== ${page}ページ  列: ${columns.map((c) => c.label).join(' / ')}`);
  console.log(
    `${'帯 (pt)'.padEnd(15)} ${columns.map((c) => c.label.padEnd(9)).join('')} 行ラベルの候補`,
  );

  for (const band of bands) {
    // 章見出し（「安全装備」「内装」など）の帯は全列が濃い灰色で塗られており、
    // 明るい画素が1つも取れない。装備の行ではないので判定できなくて正しい
    const sectionHeader = band.values.every((value) => value === null);
    const cells = sectionHeader
      ? '（章見出し）'
      : band.values
          .map((value) => (value === null ? '???' : toFeatureAvailability(value)).padEnd(9))
          .join('');
    const labels = labelsNear(words, band, LABEL_RIGHT_OF).join(' / ').slice(0, 60);
    const range = `${band.top.toFixed(1)}-${band.bottom.toFixed(1)}`;
    console.log(`${range.padEnd(15)} ${cells} ${labels}`);
  }

  const unsure = bands.filter(
    (band) => band.values.some((v) => v === null) && !band.values.every((v) => v === null),
  );
  if (unsure.length > 0) {
    console.log(
      `\n【要確認】色を判定できないセルが ${unsure.length} 帯にある。` +
        '凡例の色が既定と違う可能性がある（DEFAULT_LEGEND を確認すること）',
    );
  }
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
  const pdf = args.pdf;
  const pages = (args.pages ?? '').split(',').filter(Boolean).map(Number);

  if (!pdf || pages.length === 0 || pages.some((p) => !Number.isInteger(p) || p < 1)) {
    throw new ReadEquipmentError(
      '使い方: npm run read-equipment -- --pdf <path> --pages 3,4,5\n' +
        '  --pdf   諸元表PDF（storage/pdfs/<sha256>.pdf）\n' +
        '  --pages 装備一覧表のあるページ番号（カンマ区切り）',
    );
  }

  await readFile(pdf); // 早く分かりやすく失敗させる
  const directory = await mkdtemp(path.join(tmpdir(), 'read-equipment-'));
  try {
    const source = await decrypted(pdf, directory);
    for (const page of pages) {
      report(await readPage(source, page));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  console.log(
    '\n【必ず読むこと】どの帯がどの装備の行かは、この出力だけでは決まらない。\n' +
      'ラベルの上端は行の上端より3〜5pt上に出ることがあり、候補には隣の行のラベルも混ざる。\n' +
      '画像を見て対応を確かめてから tests/fixtures/<slug>.spec.json に書くこと。',
  );
}

if (process.argv[1]?.includes('read-equipment')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
