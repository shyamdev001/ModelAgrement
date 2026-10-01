# Model Agreement Generator

Type a customer's name, address (village) and date, upload a photo of their signature, and
download the 4-page PM Surya Ghar Model Agreement as a PDF. One shared password protects it.
Nothing is stored: no database, no saved agreements.

## Run it on your PC

```bash
npm install
npm start
```

Open http://localhost:3000. The password is the `APP_PASSWORD` value in the `.env` file
(copy `.env.example` to `.env` and choose one if the file does not exist).

## Put it online (Vercel, free)

1. Create a free account at vercel.com and install the tool: `npm install -g vercel`
2. In this folder run `vercel` and accept the defaults. It prints a preview link.
3. Set the password: `vercel env add APP_PASSWORD production` and type the password you want.
4. Publish: `vercel --prod`. The link it prints is the one to share.

Vercel serves `public/` and runs `api/generate.js`; `server.js` is only for running on a PC
or on a host such as Render (start command `npm start`, set `APP_PASSWORD` there too).

## How it works

- `assets/base.pdf` is the agreement already laid out, with the customer's name, address and
  dates blanked out. The vendor's stamp and signature are part of it.
- `assets/layout.json` records where each blank is.
- `lib/generate.js` writes the typed values into those blanks and places the signature
  (pdf-lib, Carlito font). About a tenth of a second per agreement; no LibreOffice needed.
- The browser cuts the signature out of the uploaded photo (removes the paper background)
  and shows a preview before anything is sent.

## Changing the agreement wording

The server cannot rebuild the layout. On a PC with LibreOffice and Python (`pip install pymupdf`):

1. Edit `tools/template.docx`, keeping the `{{...}}` placeholders.
2. Run `python tools/build-base.py "C:\path\to\soffice.exe"`.
3. Check a generated PDF, then publish again.

## Limits

- English letters only in the name and address (the agreement font has no Gujarati).
- Name and address up to 60 characters each; very long ones are shrunk slightly to fit two lines.
- The signature photo should be on plain white paper in good light.

Fonts: Carlito (SIL Open Font License).
