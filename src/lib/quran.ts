export interface Surah {
  n: number;
  name: string;
  tname: string;
  ename: string;
  type: 'Meccan' | 'Medinan';
  ar: string[];
  en: string[];
}

export interface QuranBundle {
  source: string;
  arabic: string;
  translation: string;
  license: string;
  pages: { index: number; surah: number; ayah: number }[];
  surahs: Surah[];
}

export type QuranBookmark = { surah: number; ayah: number };

/** 1-based index across the whole mushaf (1…6236). */
export function globalAyahNumber(data: QuranBundle, surah: number, ayah: number): number {
  let n = 0;
  for (let i = 0; i < surah - 1; i += 1) n += data.surahs[i].ar.length;
  return n + ayah;
}

export const RECITERS = [
  { id: 'ar.alafasy', name: 'Mishary Alafasy', ar: 'مشاري العفاسي', folder: 'Alafasy_128kbps' },
  { id: 'ar.abdulbasitmurattal', name: 'Abdul Basit', ar: 'عبد الباسط', folder: 'Abdul_Basit_Murattal_192kbps' },
  { id: 'ar.husary', name: 'Al-Husary', ar: 'الحصري', folder: 'Husary_128kbps' },
  { id: 'ar.minshawi', name: 'Al-Minshawi', ar: 'المنشاوي', folder: 'Minshawy_Murattal_128kbps' },
  { id: 'ar.mahermuaiqly', name: 'Maher Al Muaiqly', ar: 'ماهر المعيقلي', folder: 'MaherAlMuaiqly128kbps' },
  { id: 'ar.abdurrahmaansudais', name: 'As-Sudais', ar: 'السديس', folder: 'Abdurrahmaan_As-Sudais_192kbps' },
] as const;

export type ReciterId = (typeof RECITERS)[number]['id'];

export function reciterById(id: string) {
  return RECITERS.find((r) => r.id === id) ?? RECITERS[0];
}

export function ayahAudioUrl(reciter: ReciterId, surah: number, ayah: number): string {
  const r = reciterById(reciter);
  const file = `${String(surah).padStart(3, '0')}${String(ayah).padStart(3, '0')}.mp3`;
  return `https://everyayah.com/data/${r.folder}/${file}`;
}

let bundle: Promise<QuranBundle> | null = null;

/** Loaded on demand so the prayer pages do not pay for 2 MB of text. */
export function loadQuran(): Promise<QuranBundle> {
  bundle ??= import('../data/quran.json').then((mod) => mod.default as QuranBundle);
  return bundle;
}

