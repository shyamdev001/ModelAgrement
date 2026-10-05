/**
 * Draws the small map picture for the strip. It is an ILLUSTRATION: the roads, river and parks are
 * made up from a random seed and do not show real streets. The same coordinates always give the
 * same picture, so a place looks consistent from photo to photo.
 */

/** Small seeded random generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (value: number) => value.toFixed(1);

export function renderMapSvg(latitude: number, longitude: number, x: number, y: number, width: number, height: number, id = 'map'): string {
  const random = seeded(Math.round(latitude * 1e4) * 73856093 + Math.round(longitude * 1e4) * 19349663);
  const between = (min: number, max: number) => min + random() * (max - min);
  const unit = height; // every stroke width is relative to the map's height
  const cx = width / 2, cy = height / 2;
  const reach = Math.hypot(width, height);
  const parts: string[] = [];

  // Green patches and a pond.
  for (let i = 0; i < 4; i++) {
    const px = between(0, width), py = between(0, height), r = between(0.18, 0.4) * unit;
    const points = Array.from({ length: 7 }, (_, k) => {
      const angle = (k / 7) * Math.PI * 2;
      const radius = r * between(0.6, 1.1);
      return `${n(px + Math.cos(angle) * radius * 1.4)},${n(py + Math.sin(angle) * radius)}`;
    });
    parts.push(`<polygon points="${points.join(' ')}" fill="${i === 3 ? '#a9d3de' : '#cfe5c0'}"/>`);
  }

  // A river crossing the whole map, kept away from the centre.
  const riverSide = random() < 0.5 ? -1 : 1;
  const riverY = cy + riverSide * between(0.26, 0.4) * height;
  parts.push(`<path d="M${n(-10)},${n(riverY + between(-0.1, 0.1) * unit)} C${n(width * 0.3)},${n(riverY + between(-0.22, 0.22) * unit)} ${n(width * 0.65)},${n(riverY + between(-0.22, 0.22) * unit)} ${n(width + 10)},${n(riverY + between(-0.1, 0.1) * unit)}" fill="none" stroke="#a9d3de" stroke-width="${n(unit * between(0.06, 0.1))}" stroke-linecap="round"/>`);

  // Side streets: two families of roughly parallel lines at a random tilt.
  const tilt = between(-0.5, 0.5);
  const streets: string[] = [];
  for (const angle of [tilt, tilt + Math.PI / 2 + between(-0.12, 0.12)]) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    for (let offset = -reach / 2; offset < reach / 2; offset += unit * between(0.16, 0.3)) {
      if (random() < 0.15) continue;
      const ox = cx - dy * offset, oy = cy + dx * offset;
      const start = -reach * between(0.25, 0.7), end = reach * between(0.25, 0.7);
      streets.push(`M${n(ox + dx * start)},${n(oy + dy * start)} L${n(ox + dx * end)},${n(oy + dy * end)}`);
    }
  }
  parts.push(`<path d="${streets.join(' ')}" fill="none" stroke="#d6d0c4" stroke-width="${n(unit * 0.034)}" stroke-linecap="round"/>`);
  parts.push(`<path d="${streets.join(' ')}" fill="none" stroke="#ffffff" stroke-width="${n(unit * 0.022)}" stroke-linecap="round"/>`);

  // Two main roads curving past the centre.
  const mains = [0, 1].map((i) => {
    const angle = tilt + (i ? Math.PI / 2 : 0) + between(-0.3, 0.3);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const bend = between(-0.18, 0.18) * unit, shift = between(-0.08, 0.08) * unit;
    const mx = cx - dy * shift, my = cy + dx * shift;
    return `M${n(mx - dx * reach)},${n(my - dy * reach)} Q${n(mx - dy * bend)},${n(my + dx * bend)} ${n(mx + dx * reach)},${n(my + dy * reach)}`;
  });
  parts.push(`<path d="${mains.join(' ')}" fill="none" stroke="#e3b455" stroke-width="${n(unit * 0.075)}"/>`);
  parts.push(`<path d="${mains[0]}" fill="none" stroke="#fbe3a1" stroke-width="${n(unit * 0.052)}"/>`);
  parts.push(`<path d="${mains[1]}" fill="none" stroke="#fdf6e0" stroke-width="${n(unit * 0.052)}"/>`);

  // The pin: its tip sits on the centre of the map.
  const pin = unit * 0.36;
  parts.push(`<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(pin * 0.2)}" ry="${n(pin * 0.07)}" fill="#000000" opacity="0.28"/>`);
  parts.push(`<path d="M${n(cx)},${n(cy)} C${n(cx - pin * 0.1)},${n(cy - pin * 0.3)} ${n(cx - pin * 0.34)},${n(cy - pin * 0.45)} ${n(cx - pin * 0.34)},${n(cy - pin * 0.68)} A${n(pin * 0.34)},${n(pin * 0.34)} 0 1 1 ${n(cx + pin * 0.34)},${n(cy - pin * 0.68)} C${n(cx + pin * 0.34)},${n(cy - pin * 0.45)} ${n(cx + pin * 0.1)},${n(cy - pin * 0.3)} ${n(cx)},${n(cy)} Z" fill="#e53935" stroke="#9c1c1a" stroke-width="${n(unit * 0.01)}"/>`);
  parts.push(`<circle cx="${n(cx)}" cy="${n(cy - pin * 0.68)}" r="${n(pin * 0.13)}" fill="#ffffff"/>`);

  const radius = n(unit * 0.07);
  return `<defs><clipPath id="${id}-clip"><rect width="${n(width)}" height="${n(height)}" rx="${radius}"/></clipPath></defs>
<g transform="translate(${n(x)},${n(y)})"><g clip-path="url(#${id}-clip)">
<rect width="${n(width)}" height="${n(height)}" fill="#f1eee6"/>
${parts.join('\n')}
</g><rect width="${n(width)}" height="${n(height)}" rx="${radius}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${n(Math.max(1, unit * 0.012))}"/></g>`;
}
