/** One page: its size in points, and a JPEG picture that fills it. */
export interface PdfPage {
  width: number;
  height: number;
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

const text = (s: string) => new TextEncoder().encode(s);
const num = (n: number) => String(Math.round(n * 100) / 100);

/** A small PDF with one picture per page. No fonts or packages needed. */
export function makePdf(pages: PdfPage[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    length += b.length;
  };
  const object = (n: number, body: Uint8Array[]) => {
    offsets[n] = length;
    push(text(`${n} 0 obj\n`));
    for (const b of body) push(b);
    push(text("\nendobj\n"));
  };

  // 1 catalog, 2 page list, then three objects per page: page, picture, drawing
  const pageRef = (i: number) => 3 + i * 3;
  push(text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  object(1, [text("<< /Type /Catalog /Pages 2 0 R >>")]);
  const kids = pages.map((_, i) => `${pageRef(i)} 0 R`).join(" ");
  object(2, [text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)]);
  pages.forEach((p, i) => {
    const n = pageRef(i);
    const w = num(p.width);
    const h = num(p.height);
    object(n, [
      text(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`,
      ),
    ]);
    object(n + 1, [
      text(
        `<< /Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      ),
      p.jpeg,
      text("\nendstream"),
    ]);
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(n + 2, [text(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)]);
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(text(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
