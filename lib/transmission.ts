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
  // Handle non-string inputs gracefully
  if (typeof input !== 'string') {
    return { raw: '', type: 'other', gearCount: null };
  }

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
