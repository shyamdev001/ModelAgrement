/** Words that say "which state/country" rather than "which place"; dropped from what the user typed. */
const REGION_WORDS = new Set(['gujarat', 'gujrat', 'gj', 'india', 'bharat', 'in']);
const QUALIFIER_NOISE = new Set(['district', 'dist', 'taluka', 'taluko', 'tal', 'ta', 'di', 'village', 'gam', 'city', 'town', 'at', 'post']);

/** Lowercase, no accents, no punctuation, single spaces. "Nadiād,  Gujarat" -> "nadiad gujarat". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A looser key that survives the usual ways one Gujarati name gets spelled in English:
 * Vidyanagar / Vidhyanagar, Mehsana / Mahesana, Dohad / Dahod, Anklesvar / Ankleshwar.
 */
export function looseKey(normalized: string): string {
  return normalized
    .replace(/\s+/g, '')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/ph/g, 'f')
    .replace(/([bcdgjkpst])h/g, '$1')
    .replace(/[aeiou]+/g, (vowels) => (vowels.length > 1 ? vowels[0] : vowels))
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
}

export interface ParsedQuery {
  /** Cleaned copy of everything the user typed, used as the cache key. */
  normalizedQuery: string;
  /** Possible readings, most literal first: a place name plus optional district/taluka words. */
  readings: { name: string; qualifiers: string[] }[];
}

function dropNoise(words: string[]): string[] {
  return words.filter((word) => !QUALIFIER_NOISE.has(word));
}

/**
 * Turns "Nadiad, Kheda, Gujarat, India" into the name "nadiad" with the qualifier "kheda".
 * Without commas the split is unknown, so every split is offered ("vallabh vidyanagar anand"
 * could be one name, or "vallabh vidyanagar" in "anand").
 */
export function parseLocationQuery(input: string): ParsedQuery {
  const parts = input
    .split(/[,;|\n]+/)
    .map(normalizeText)
    .filter((part) => part && !part.split(' ').every((word) => REGION_WORDS.has(word)));

  // "nadiad gujarat" -> "nadiad": region words at the end of a part are not part of the name.
  const trimmed = parts
    .map((part) => {
      const words = part.split(' ');
      while (words.length > 1 && REGION_WORDS.has(words[words.length - 1])) words.pop();
      return words.join(' ');
    })
    .filter(Boolean);

  const normalizedQuery = trimmed.join(', ');
  if (trimmed.length === 0) return { normalizedQuery, readings: [] };

  const [first, ...rest] = trimmed;
  const qualifiers = rest.map((part) => dropNoise(part.split(' ')).join(' ')).filter(Boolean);
  const readings = [{ name: first, qualifiers }];

  const words = first.split(' ');
  for (let cut = words.length - 1; cut >= 1; cut--) {
    const tail = dropNoise(words.slice(cut)).join(' ');
    if (tail) readings.push({ name: words.slice(0, cut).join(' '), qualifiers: [tail, ...qualifiers] });
  }
  return { normalizedQuery, readings };
}
