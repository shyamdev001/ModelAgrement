const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const ASSETS = path.join(process.cwd(), 'assets');
const read = (name) => fs.readFileSync(path.join(ASSETS, name));

// Loaded once per server instance, reused for every agreement.
let cache;
function assets() {
  if (!cache) {
    cache = {
      base: read('base.pdf'),
      regular: read('Carlito-Regular.ttf'),
      bold: read('Carlito-Bold.ttf'),
      layout: JSON.parse(read('layout.json').toString('utf8')),
    };
  }
  return cache;
}

const BLACK = rgb(0, 0, 0);
const MIN_PARTY_SIZE = 8;

/** Splits styled text into words, remembering how many spaces came before each one. */
function toWords(segments) {
  const words = [];
  let pendingSpaces = 0;
  for (const { text, bold } of segments) {
    for (const piece of text.split(/( +)/)) {
      if (piece === '') continue;
      if (piece.trim() === '') pendingSpaces += piece.length;
      else {
        words.push({ text: piece, bold, spaces: pendingSpaces });
        pendingSpaces = 0;
      }
    }
  }
  return words;
}

/** Greedy word wrap. A word glued to the previous one (no space between) never starts a new line. */
function wrap(words, fonts, size, maxWidth) {
  const spaceWidth = fonts.regular.widthOfTextAtSize(' ', size);
  const lines = [[]];
  let x = 0;
  for (const word of words) {
    const width = (word.bold ? fonts.bold : fonts.regular).widthOfTextAtSize(word.text, size);
    const gap = x === 0 ? 0 : word.spaces * spaceWidth;
    if (x > 0 && word.spaces > 0 && x + gap + width > maxWidth) {
      lines.push([]);
      x = 0;
    }
    const line = lines[lines.length - 1];
    const offset = line.length === 0 ? 0 : x + word.spaces * spaceWidth;
    line.push({ ...word, x: offset });
    x = offset + width;
  }
  return lines;
}

/**
 * Builds the agreement PDF by writing the variable fields onto the pre-rendered base PDF.
 * @param {{name: string, address: string, date: {dd: string, mm: string, yyyy: string}, signaturePng?: Buffer}} input
 * @returns {Promise<Uint8Array>}
 */
async function generateAgreementPdf({ name, address, date, signaturePng }) {
  const { base, regular, bold, layout } = assets();
  const pdf = await PDFDocument.load(base);
  pdf.registerFontkit(fontkit);
  const fonts = {
    regular: await pdf.embedFont(regular, { subset: true }),
    bold: await pdf.embedFont(bold, { subset: true }),
  };
  const pages = pdf.getPages();
  const page1 = pages[0];
  const page4 = pages[3];
  const flip = (y) => layout.pageHeight - y; // layout uses a top-left origin, PDF a bottom-left one

  const text = (page, value, at, font = fonts.regular, size = at.size) =>
    page.drawText(value, { x: at.x, y: flip(at.y), size, font, color: BLACK });

  // Page 1: date digits, one per slot.
  const digits = `${date.dd}${date.mm}${date.yyyy}`;
  layout.p1DateDigits.forEach((slot, i) => text(page1, digits[i], { ...slot, size: layout.p1DateSize }));

  // Page 1: the "Between" paragraph, re-wrapped for this name (shrunk slightly if it would need a third line).
  const party = layout.p1Party;
  const words = toWords([
    { text: name, bold: true },
    { text: '  having  address  ', bold: false },
    { text: `${address},`, bold: true },
    { text: ' (here in after  referre to as  first  Party i.e./consumer/consumer/purchaser/owner of system).', bold: false },
  ]);
  let size = party.size;
  let lines = wrap(words, fonts, size, party.maxWidth);
  while (lines.length > party.lineYs.length && size > MIN_PARTY_SIZE) {
    size -= 0.5;
    lines = wrap(words, fonts, size, party.maxWidth);
  }
  if (lines.length > party.lineYs.length) throw new Error('The name and address are too long to fit on the agreement.');
  lines.forEach((line, i) => {
    for (const word of line) {
      page1.drawText(word.text, {
        x: party.x + word.x,
        y: flip(party.lineYs[i]),
        size,
        font: word.bold ? fonts.bold : fonts.regular,
        color: BLACK,
      });
    }
  });

  // Page 4: First Party block and both dates.
  const shortDate = `${date.dd}/${date.mm}/${date.yyyy}`;
  text(page4, name, layout.p4Name, fonts.bold);
  text(page4, address, layout.p4Village, fonts.bold);
  text(page4, shortDate, layout.p4CustomerDate);
  text(page4, shortDate, layout.p4VendorDate);

  if (signaturePng) {
    const image = await pdf.embedPng(signaturePng);
    const box = layout.p4Sign;
    const scale = Math.min(box.maxWidth / image.width, box.maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    // Sits on the Sign line, rising above it like a handwritten signature would.
    page4.drawImage(image, { x: box.x, y: flip(box.baseline) - height * 0.33, width, height });
  }

  return pdf.save();
}

module.exports = { generateAgreementPdf };
