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

/** 非ASCII文字を含むかチェック */
function hasNonAscii(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
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

  if (hasNonAscii(model)) {
    const ascii = asciiSlug(model);
    return ascii ? `${ascii}-${shortHash(model)}` : `model-${shortHash(model)}`;
  } else {
    const ascii = asciiSlug(model);
    return ascii || `model-${shortHash(model)}`;
  }
}

export function gradeSlug(grade: string): string {
  if (hasNonAscii(grade)) {
    const ascii = asciiSlug(grade);
    return ascii ? `${ascii}-${shortHash(grade)}` : `grade-${shortHash(grade)}`;
  } else {
    const ascii = asciiSlug(grade);
    return ascii || `grade-${shortHash(grade)}`;
  }
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
