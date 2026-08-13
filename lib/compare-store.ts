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
