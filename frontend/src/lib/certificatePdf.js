// Placing the rasterised certificate on the PDF page.
//
// The download used to be four lines with the arithmetic left out:
//
//   html2canvas(input).then((canvas) => {
//      const imgData = canvas.toDataURL('image/png');
//      const pdf = new jsPDF();
//      pdf.addImage(imgData, 'JPEG', -35, 10);
//      pdf.save('download-certificate.pdf');
//   });
//
// `new jsPDF()` is portrait A4 in millimetres — a 210 x 297 mm page — and
// `addImage` with no width or height falls back to the bitmap's pixel
// dimensions and uses them as millimetres. The certificate card renders around
// 700 px wide, so it was placed roughly 700 mm across a 210 mm page and the
// x = -35 was somebody trying to centre the overflow by hand. It cannot be
// centred by hand: the overflow is a factor, not an offset.
//
// html2canvas also defaults to `scale: window.devicePixelRatio`, so the same
// certificate came out at 2x on a retina display and the PDF depended on the
// monitor it was downloaded on. The scale is pinned below and the placement is
// computed from the canvas rather than guessed (#134).

// A4 portrait, the jsPDF default, in millimetres.
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

// Printable margin on every side.
export const PAGE_MARGIN_MM = 12;

// Fixed so the output does not depend on the display. 2 is enough that the
// certificate's text is not visibly soft in print without making the file
// large.
export const RENDER_SCALE = 2;

export const CERTIFICATE_FILENAME = 'learnhub-certificate.pdf';

/**
 * Where the rasterised certificate goes on the page.
 *
 * Fits the bitmap inside the printable area preserving its aspect ratio, then
 * centres it. Scales down an oversized capture and equally scales up an
 * undersized one, so the certificate fills the page it is given either way.
 *
 * @param {{width: number, height: number}} canvas the html2canvas result
 * @param {object} [page]
 * @param {number} [page.width] page width in mm
 * @param {number} [page.height] page height in mm
 * @param {number} [page.margin] margin in mm
 * @returns {{x: number, y: number, width: number, height: number}|null}
 *   null when the canvas has no usable dimensions
 */
export function computeCertificateLayout(canvas, page = {}) {
  const {
    width: pageWidth = PAGE_WIDTH_MM,
    height: pageHeight = PAGE_HEIGHT_MM,
    margin = PAGE_MARGIN_MM,
  } = page;

  const sourceWidth = Number(canvas?.width);
  const sourceHeight = Number(canvas?.height);

  // A zero-width canvas is what html2canvas returns for a node that is not
  // laid out — a display:none modal, most likely. Dividing by it would put
  // Infinity into addImage.
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;

  if (availableWidth <= 0 || availableHeight <= 0) return null;

  // The binding constraint is whichever axis runs out first.
  const ratio = Math.min(
    availableWidth / sourceWidth,
    availableHeight / sourceHeight,
  );

  const width = sourceWidth * ratio;
  const height = sourceHeight * ratio;

  return {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

/**
 * The format argument for `addImage`, taken from the data URI rather than
 * asserted.
 *
 * The old call passed 'JPEG' for a `toDataURL('image/png')` result. jsPDF
 * reads the real format out of the URI so it did not throw, which is why the
 * mismatch survived — but the argument should not be a lie.
 *
 * @param {string} dataUrl
 * @returns {string} 'PNG' or 'JPEG'
 */
export function readImageFormat(dataUrl) {
  return /^data:image\/jpe?g/i.test(String(dataUrl ?? '')) ? 'JPEG' : 'PNG';
}
