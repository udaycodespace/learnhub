import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CERTIFICATE_FILENAME,
  PAGE_HEIGHT_MM,
  PAGE_MARGIN_MM,
  PAGE_WIDTH_MM,
  RENDER_SCALE,
  computeCertificateLayout,
  readImageFormat,
} from './certificatePdf.js';

// #134. The certificate was placed with `addImage(imgData, 'JPEG', -35, 10)`:
// no width, no height, so jsPDF used the bitmap's pixel count as millimetres
// and put a ~700 mm image on a 210 mm page. These tests are the arithmetic
// that was missing.

const A4 = {
  width: PAGE_WIDTH_MM,
  height: PAGE_HEIGHT_MM,
  margin: PAGE_MARGIN_MM,
};

const PRINTABLE_WIDTH = PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2;
const PRINTABLE_HEIGHT = PAGE_HEIGHT_MM - PAGE_MARGIN_MM * 2;

const fitsOnPage = (layout) =>
  layout.x >= 0 &&
  layout.y >= 0 &&
  layout.x + layout.width <= PAGE_WIDTH_MM + 1e-9 &&
  layout.y + layout.height <= PAGE_HEIGHT_MM + 1e-9;

test('a realistic certificate capture lands inside the page', () => {
  // What the modal actually produces: ~700 CSS px at scale 2.
  const layout = computeCertificateLayout({ width: 1400, height: 800 }, A4);

  assert.ok(fitsOnPage(layout), `off the page: ${JSON.stringify(layout)}`);
  // The old call placed this at x = -35 with width 1400.
  assert.ok(layout.x >= PAGE_MARGIN_MM - 1e-9);
  assert.ok(layout.width <= PRINTABLE_WIDTH + 1e-9);
});

test('the aspect ratio is preserved', () => {
  const layout = computeCertificateLayout({ width: 1400, height: 800 }, A4);

  assert.ok(Math.abs(layout.width / layout.height - 1400 / 800) < 1e-9);
});

test('a wide capture is limited by the page width', () => {
  const layout = computeCertificateLayout({ width: 4000, height: 500 }, A4);

  assert.ok(Math.abs(layout.width - PRINTABLE_WIDTH) < 1e-9);
  assert.ok(layout.height < PRINTABLE_HEIGHT);
  assert.ok(fitsOnPage(layout));
});

test('a tall capture is limited by the page height', () => {
  const layout = computeCertificateLayout({ width: 500, height: 4000 }, A4);

  assert.ok(Math.abs(layout.height - PRINTABLE_HEIGHT) < 1e-9);
  assert.ok(layout.width < PRINTABLE_WIDTH);
  assert.ok(fitsOnPage(layout));
});

test('the result is centred on both axes', () => {
  const layout = computeCertificateLayout({ width: 1400, height: 800 }, A4);

  const leftGap = layout.x;
  const rightGap = PAGE_WIDTH_MM - (layout.x + layout.width);
  const topGap = layout.y;
  const bottomGap = PAGE_HEIGHT_MM - (layout.y + layout.height);

  assert.ok(Math.abs(leftGap - rightGap) < 1e-9);
  assert.ok(Math.abs(topGap - bottomGap) < 1e-9);
});

test('a small capture is scaled up rather than left tiny', () => {
  const layout = computeCertificateLayout({ width: 140, height: 80 }, A4);

  assert.ok(Math.abs(layout.width - PRINTABLE_WIDTH) < 1e-9);
  assert.ok(fitsOnPage(layout));
});

test('the display scale does not change the placement', () => {
  // The whole point of pinning RENDER_SCALE: a 1x and a 2x capture of the same
  // node differ only in pixel count, and must produce the same PDF.
  const at1x = computeCertificateLayout({ width: 700, height: 400 }, A4);
  const at2x = computeCertificateLayout({ width: 1400, height: 800 }, A4);

  assert.deepEqual(at1x, at2x);
});

test('an unlaid-out node yields no layout rather than Infinity', () => {
  // html2canvas returns a zero-width canvas for a node that is not displayed.
  assert.equal(computeCertificateLayout({ width: 0, height: 500 }, A4), null);
  assert.equal(computeCertificateLayout({ width: 500, height: 0 }, A4), null);
  assert.equal(computeCertificateLayout(null, A4), null);
  assert.equal(computeCertificateLayout({}, A4), null);
  assert.equal(
    computeCertificateLayout({ width: Number.NaN, height: 10 }, A4),
    null,
  );
  assert.equal(
    computeCertificateLayout({ width: -10, height: 10 }, A4),
    null,
  );
});

test('a page with no printable area yields no layout', () => {
  assert.equal(
    computeCertificateLayout(
      { width: 100, height: 100 },
      { width: 20, height: 297, margin: 12 },
    ),
    null,
  );
});

test('the page defaults are A4 portrait', () => {
  const explicit = computeCertificateLayout({ width: 1400, height: 800 }, A4);
  const defaulted = computeCertificateLayout({ width: 1400, height: 800 });

  assert.deepEqual(defaulted, explicit);
});

test('the image format is read from the data URI, not asserted', () => {
  // The old call said 'JPEG' for a toDataURL('image/png') result.
  assert.equal(readImageFormat('data:image/png;base64,AAAA'), 'PNG');
  assert.equal(readImageFormat('data:image/jpeg;base64,AAAA'), 'JPEG');
  assert.equal(readImageFormat('data:image/jpg;base64,AAAA'), 'JPEG');
  assert.equal(readImageFormat('data:image/PNG;base64,AAAA'), 'PNG');
  assert.equal(readImageFormat(''), 'PNG');
  assert.equal(readImageFormat(null), 'PNG');
});

test('the render scale is pinned and the filename names the product', () => {
  assert.equal(RENDER_SCALE, 2);
  assert.match(CERTIFICATE_FILENAME, /\.pdf$/);
  assert.match(CERTIFICATE_FILENAME, /learnhub/i);
});
