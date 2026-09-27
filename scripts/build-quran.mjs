/**
 * Verify Tanzil Uthmani + Saheeh International against the canonical mushaf
 * counts, then write the bundled JSON the reader loads.
 *
 * The Arabic is copied verbatim. This script does not compose or correct it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'reference/quran');

/** Well-known Hafs 'an 'Asim ayah counts. Sum must be 6236. */
const CANONICAL = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111,
  110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83,
  182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96,
  29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31,
  50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5,
  8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];

function parsePipe(text) {
  const verses = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const first = line.indexOf('|');
    const second = line.indexOf('|', first + 1);
    if (first < 0 || second < 0) continue;
    const s = Number(line.slice(0, first));
    const a = Number(line.slice(first + 1, second));
    const body = line.slice(second + 1);
    if (!Number.isInteger(s) || !Number.isInteger(a) || !body) {
      throw new Error(`Bad line: ${line.slice(0, 80)}`);
    }
    verses.set(`${s}:${a}`, body);
  }
  return verses;
}

function parseMeta(xml) {
  const surahs = [];
  const re =
    /<sura index="(\d+)" ayas="(\d+)" start="\d+" name="([^"]*)" tname="([^"]*)" ename="([^"]*)" type="(Meccan|Medinan)"/g;
  let m;
  while ((m = re.exec(xml))) {
    surahs.push({
      n: Number(m[1]),
      ayahs: Number(m[2]),
      name: m[3],
      tname: m[4],
      ename: m[5],
      type: m[6],
    });
  }
  return surahs;
}

const arabic = parsePipe(readFileSync(join(srcDir, 'quran-uthmani.txt'), 'utf8'));
const english = parsePipe(readFileSync(join(srcDir, 'en.sahih.txt'), 'utf8'));
const metadata = readFileSync(join(srcDir, 'quran-data.xml'), 'utf8');
const meta = parseMeta(metadata);
const pages = [...metadata.matchAll(/<page index="(\d+)" sura="(\d+)" aya="(\d+)"\s*\/>/g)].map((match) => ({
  index: Number(match[1]),
  surah: Number(match[2]),
  ayah: Number(match[3]),
}));

const errors = [];
if (CANONICAL.length !== 114) errors.push(`canonical list is ${CANONICAL.length}, not 114`);
if (CANONICAL.reduce((a, b) => a + b, 0) !== 6236) errors.push('canonical sum is not 6236');
if (meta.length !== 114) errors.push(`metadata has ${meta.length} surahs, not 114`);
if (pages.length !== 604) errors.push(`metadata has ${pages.length} pages, not 604`);
let previousPageStart = 0;
for (const [i, page] of pages.entries()) {
  const start = meta.slice(0, page.surah - 1).reduce((sum, surah) => sum + surah.ayahs, 0) + page.ayah;
  if (page.index !== i + 1 || start <= previousPageStart || !arabic.has(`${page.surah}:${page.ayah}`)) {
    errors.push(`invalid start for page ${i + 1}`);
  }
  previousPageStart = start;
}
if (pages[0]?.surah !== 1 || pages[0]?.ayah !== 1) errors.push('page one must start at 1:1');
if (arabic.size !== 6236) errors.push(`Arabic has ${arabic.size} ayahs, not 6236`);
if (english.size !== 6236) errors.push(`English has ${english.size} ayahs, not 6236`);

for (let i = 0; i < 114; i += 1) {
  const s = i + 1;
  const want = CANONICAL[i];
  const xml = meta[i];
  if (!xml || xml.n !== s) errors.push(`metadata surah ${s} missing or out of order`);
  else if (xml.ayahs !== want) errors.push(`metadata ${s} has ${xml.ayahs} ayahs, canonical ${want}`);
  for (let a = 1; a <= want; a += 1) {
    const key = `${s}:${a}`;
    if (!arabic.has(key)) errors.push(`Arabic missing ${key}`);
    if (!english.has(key)) errors.push(`English missing ${key}`);
  }
  if (arabic.has(`${s}:${want + 1}`)) errors.push(`Arabic extra ayah after ${s}:${want}`);
}

const fatiha = arabic.get('1:1') ?? '';
if (!fatiha.includes('ٱللَّهِ') || !fatiha.includes('ٱلرَّحِيمِ')) {
  errors.push('1:1 does not look like the Basmala');
}
const tawbah = arabic.get('9:1') ?? '';
if (tawbah.startsWith('بِسْمِ')) errors.push('9:1 must not open with the Basmala');
const ikhlas = arabic.get('112:1') ?? '';
if (!ikhlas.includes('هُوَ ٱللَّهُ أَحَدٌ')) errors.push('112:1 does not match Qul Huwa Allahu Ahad');

if (errors.length) {
  console.error(errors.slice(0, 30).join('\n'));
  if (errors.length > 30) console.error(`…and ${errors.length - 30} more`);
  process.exit(1);
}

const surahs = meta.map((s) => ({
  n: s.n,
  name: s.name,
  tname: s.tname,
  ename: s.ename,
  type: s.type,
  ar: Array.from({ length: s.ayahs }, (_, i) => arabic.get(`${s.n}:${i + 1}`)),
  en: Array.from({ length: s.ayahs }, (_, i) => english.get(`${s.n}:${i + 1}`)),
}));

const out = {
  source: 'Tanzil.net',
  arabic: 'Uthmani (Hafs)',
  translation: 'Saheeh International',
  license: 'CC BY 3.0 — Tanzil Project. Arabic text must not be changed. https://tanzil.net',
  pages,
  surahs,
};

const dest = join(root, 'src/data/quran.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`ok  114 surahs  6236 ayahs  → src/data/quran.json  (${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} kB)`);
