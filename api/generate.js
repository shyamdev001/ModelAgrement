const crypto = require('crypto');
const { generateAgreementPdf } = require('../lib/generate');

const MAX_SIGNATURE_BYTES = 3 * 1024 * 1024;
// The agreement font covers English letters only; anything else would print as empty boxes.
const ALLOWED_TEXT = /^[A-Za-z0-9 .,'()\/&-]+$/;

function passwordMatches(given) {
  const expected = process.env.APP_PASSWORD;
  if (!expected || typeof given !== 'string') return false;
  const hash = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(given), hash(expected));
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function cleanText(value, label, max) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < 2) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} is too long (max ${max} characters).`);
  if (!ALLOWED_TEXT.test(text)) throw new Error(`${label}: please type in English letters only.`);
  return text;
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '');
  if (!match) throw new Error('Date is required.');
  const [, yyyy, mm, dd] = match;
  const real = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  if (real.getUTCMonth() !== +mm - 1 || real.getUTCDate() !== +dd) throw new Error('That date does not exist.');
  return { dd, mm, yyyy };
}

function parseSignature(value) {
  if (!value) return undefined;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error('The signature image could not be read. Please upload the photo again.');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > MAX_SIGNATURE_BYTES) throw new Error('The signature image is too large.');
  return buffer;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });
  if (!process.env.APP_PASSWORD) return send(res, 500, { message: 'APP_PASSWORD is not set on the server.' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (!passwordMatches(body.password)) {
    await new Promise((resolve) => setTimeout(resolve, 500)); // slows down password guessing
    return send(res, 401, { message: 'Wrong password.' });
  }
  if (body.checkOnly) return send(res, 200, { ok: true });

  let input;
  try {
    input = {
      name: cleanText(body.name, 'Name', 60),
      address: cleanText(body.address, 'Address', 60),
      date: parseDate(body.date),
      signaturePng: parseSignature(body.signature),
    };
  } catch (err) {
    return send(res, 400, { message: err.message });
  }

  try {
    const pdf = await generateAgreementPdf(input);
    const fileName = `Model_Agreement_${input.name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(pdf));
  } catch (err) {
    console.error('[generate] failed:', err.message);
    send(res, 422, { message: err.message || 'Could not create the agreement.' });
  }
};
