# The downloaded certificate PDF (#134)

## The defect

The certificate a student earns is rasterised out of the modal and dropped onto
a PDF page. The whole of it was four lines:

```js
const downloadPdfDocument = (rootElementId) => {
   const input = document.getElementById(rootElementId);
   html2canvas(input).then((canvas) => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF();
      pdf.addImage(imgData, 'JPEG', -35, 10);
      pdf.save('download-certificate.pdf');
   });
};
```

`new jsPDF()` is portrait A4 **in millimetres** — a 210 x 297 mm page. The
`addImage` call passes an x and a y and no width or height, so jsPDF falls back
to the bitmap's own pixel dimensions and uses those numbers as millimetres. The
certificate card renders around 700 px wide inside a `modal-90w`, so the image
was placed at roughly **700 mm x 400 mm on a 210 mm page**. Only the middle-left
fragment was on the paper, magnified, and the recipient's name and the course
title were usually not in it.

The `-35` is the tell. It is somebody trying to centre the overflow by hand,
which cannot work: an image 3.3x too wide is off the page by a factor, not by
an offset, and shifting it left only trades the right edge for the left one.

Three further problems sat in the same four lines.

**The output depended on the monitor.** `html2canvas` defaults to
`scale: window.devicePixelRatio`. On a retina display the canvas came back at
2x, so the same certificate was placed at ~1400 mm and the result was twice as
badly cropped — worse on exactly the machines most likely to be used to claim
it. Two students with identical certificates got different PDFs.

**The format argument was a lie.** `toDataURL('image/png')` produces
`data:image/png;base64,…` and the call declared it `'JPEG'`. jsPDF sniffs the
real format out of the data URI, which is why this never threw and why it
survived.

**There was no failure path and no pending state.** The promise had no
`.catch`, so a failed rasterise was an unhandled rejection and a button that
silently did nothing. Rasterising takes a noticeable moment and nothing said
so, which invited a second click and a second render of the same node.

## The fix

The arithmetic moves into `frontend/src/lib/certificatePdf.js`, where it is
pure and testable, and the component keeps only the I/O.

`computeCertificateLayout` fits the canvas inside the page's printable area
preserving aspect ratio, then centres it:

```js
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
```

The binding constraint is whichever axis runs out first, so a wide certificate
is limited by the page width and a tall one by the page height, and neither can
leave the paper. It scales up as readily as down, so a small capture fills the
page rather than sitting in the middle of it.

A zero-width canvas — what `html2canvas` returns for a node that is not laid
out — returns `null` rather than putting `Infinity` into `addImage`.

`RENDER_SCALE` is pinned to 2 and passed to `html2canvas`, so the capture no
longer varies with `devicePixelRatio`. A 1x and a 2x capture of the same node
differ only in pixel count, and `computeCertificateLayout` is scale-invariant
by construction — there is a test asserting the two produce byte-identical
layouts.

`readImageFormat` reads the format off the data URI instead of asserting one.

The component now awaits the render behind a `downloading` flag, so the button
reads "Preparing…" and is disabled while it works, and a failure is caught and
reported through the existing `Toast` rather than vanishing into the console.
The file is saved as `learnhub-certificate.pdf`.

## What is covered

`frontend/src/lib/certificatePdf.test.js` — 12 tests:

- a realistic capture (1400 x 800, the modal at scale 2) lands inside the page,
  which is the regression the `-35` and the missing width produced;
- the aspect ratio is preserved;
- a wide capture is limited by the width and a tall one by the height;
- the result is centred on both axes;
- a small capture is scaled up;
- 1x and 2x captures of the same node produce the same layout;
- an unlaid-out node, a NaN dimension and a negative dimension all yield `null`;
- a page with no printable area yields `null`;
- the defaults are A4 portrait;
- the image format is read from the URI in either case.

## Not addressed here

The certificate is still a bitmap of a DOM node rather than drawn text, so it
does not scale losslessly and its text is not selectable or searchable in the
PDF. Rendering it as vector text is a larger change and a separate piece of
work; this one makes the existing approach produce a correct page.
