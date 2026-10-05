import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { dataPath } from '../utils/dataPath';
import type { Stamp } from '../utils/timezone';
import type { Location } from './locationService';
import { renderMapSvg } from './mapRenderer';

// Text is drawn as outlines from bundled fonts, so the strip looks the same on every server
// (a Linux host usually has none of the fonts a Windows PC has).
const FONT_DIR = dataPath('fonts');
const loadFont = (file: string) => {
  const bytes = fs.readFileSync(path.join(FONT_DIR, file));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const regular = loadFont('Carlito-Regular.ttf');
const bold = loadFont('Carlito-Bold.ttf');

export const STRIP_BACKGROUND = '#15181d';
const TEXT = '#e9edf2';
const MUTED = '#98a2b0';
const CAPTION = 'Location of village/town · map is illustrative';

/** Height of the strip for a photo this wide: about 14% of the width, never too small to read. */
export function stripHeightFor(photoWidth: number): number {
  return Math.max(96, Math.round((photoWidth * 0.14) / 2) * 2);
}

/** SVG path text for a glyph outline. (opentype's own toPathData() occasionally writes "NaN", which cuts the text short.) */
function pathData(outline: opentype.Path): string {
  const f = (value: number | undefined) => (value ?? 0).toFixed(2);
  return outline.commands
    .map((c) => {
      if (c.type === 'M' || c.type === 'L') return `${c.type}${f(c.x)} ${f(c.y)}`;
      if (c.type === 'Q') return `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
      if (c.type === 'C') return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
      return 'Z';
    })
    .join('');
}

interface StripInput {
  width: number;
  location: Location;
  plusCode: string;
  stamp: Stamp;
}

export function renderStripSvg({ width, location, plusCode, stamp }: StripInput): { svg: string; height: number } {
  const height = stripHeightFor(width);
  const pad = height * 0.09;
  const mapWidth = Math.min(width * 0.27, height * 2.2);
  const mapHeight = height - pad * 2;
  const textX = pad + mapWidth + height * 0.13;
  const maxTextWidth = width - textX - pad;

  const draw = (font: opentype.Font, text: string, x: number, baseline: number, size: number, fill: string) =>
    `<path d="${pathData(font.getPath(text, x, baseline, size))}" fill="${fill}"/>`;
  /** Largest size up to `wanted` at which the text fits in `room`. */
  const fit = (font: opentype.Font, text: string, wanted: number, room: number) =>
    Math.min(wanted, (wanted * room) / Math.max(1, font.getAdvanceWidth(text, wanted)));

  const lineSize = height * 0.112;
  const flagHeight = height * 0.1;
  const flagWidth = flagHeight * 1.5;
  const title = [location.name, location.state, location.country].filter(Boolean).join(', ');
  const titleSize = fit(bold, title, height * 0.155, maxTextWidth - flagWidth - height * 0.06);

  const firstBaseline = pad + height * 0.155 * 0.8;
  const lastBaseline = height - pad - lineSize * 0.12;
  const step = (lastBaseline - firstBaseline) / 5;
  const lines = [
    `Plus Code: ${plusCode}`,
    `Lat: ${location.latitude.toFixed(6)}`,
    `Long: ${location.longitude.toFixed(6)}`,
    `${stamp.date} • ${stamp.time}`,
    stamp.timezone,
  ];

  const parts: string[] = [draw(bold, title, textX, firstBaseline, titleSize, '#ffffff')];

  // Indian flag, drawn as shapes (emoji flags do not render on most servers).
  const fx = textX + bold.getAdvanceWidth(title, titleSize) + height * 0.05;
  const fy = firstBaseline - flagHeight * 0.95;
  const band = flagHeight / 3;
  parts.push(
    `<rect x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="${flagWidth.toFixed(1)}" height="${band.toFixed(1)}" fill="#ff9933"/>`,
    `<rect x="${fx.toFixed(1)}" y="${(fy + band).toFixed(1)}" width="${flagWidth.toFixed(1)}" height="${band.toFixed(1)}" fill="#ffffff"/>`,
    `<rect x="${fx.toFixed(1)}" y="${(fy + band * 2).toFixed(1)}" width="${flagWidth.toFixed(1)}" height="${band.toFixed(1)}" fill="#138808"/>`,
    `<circle cx="${(fx + flagWidth / 2).toFixed(1)}" cy="${(fy + flagHeight / 2).toFixed(1)}" r="${(band * 0.38).toFixed(1)}" fill="none" stroke="#000080" stroke-width="${Math.max(0.6, band * 0.12).toFixed(1)}"/>`,
  );

  lines.forEach((line, i) => {
    const size = fit(regular, line, lineSize, maxTextWidth);
    parts.push(draw(regular, line, textX, firstBaseline + step * (i + 1), size, TEXT));
  });

  // Small print on the last row, right-aligned: says plainly what the coordinates and the map are.
  const lastLineWidth = regular.getAdvanceWidth(lines[4], lineSize);
  const captionRoom = maxTextWidth - lastLineWidth - height * 0.12;
  const captionSize = fit(regular, CAPTION, lineSize * 0.62, captionRoom);
  if (captionSize >= 6) {
    const captionWidth = regular.getAdvanceWidth(CAPTION, captionSize);
    parts.push(draw(regular, CAPTION, width - pad - captionWidth, lastBaseline, captionSize, MUTED));
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${STRIP_BACKGROUND}"/>
${renderMapSvg(location.latitude, location.longitude, pad, pad, mapWidth, mapHeight)}
${parts.join('\n')}
</svg>`;
  return { svg, height };
}
