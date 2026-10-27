import { PDFDocument } from "pdf-lib";
import {
  PROBLEMS,
  SIDE_SHORT,
  TURNO_LABEL,
  fichaLines,
  formatDateBR,
  nomesNaFicha,
  pad2,
  type FichaLine,
  type MachineId,
  type State,
} from "@/lib/perdas";

const W = 1800;
const H = 1180;
/** Mesmo quadro, mais pixels. 3× deixa o zoom nítido; 2× se o celular recusar o canvas. */
const SCALES = [3, 2];

export async function renderFichaPng(state: State, machine: MachineId): Promise<Blob> {
  await document.fonts.load("700 64px 'Barlow Condensed'");
  await document.fonts.load("600 20px 'Source Sans 3'");
  await document.fonts.ready;
  const surface = createSurface();
  if (!surface) throw new Error("Não foi possível gerar a ficha.");
  drawFicha(surface.ctx, state, machine, fichaLines(state, machine));
  return canvasToBlob(surface.canvas);
}

export async function renderFichasPdf(state: State, machines: MachineId[]): Promise<Blob> {
  const pdf = await PDFDocument.create();
  for (const machine of machines) {
    const png = await renderFichaPng(state, machine);
    const image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
    const page = pdf.addPage([841.89, 595.28]);
    const margin = 16;
    const maxW = page.getWidth() - margin * 2;
    const maxH = page.getHeight() - margin * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (page.getWidth() - width) / 2,
      y: (page.getHeight() - height) / 2,
      width,
      height,
    });
  }
  const bytes = await pdf.save();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function createSurface(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  for (const scale of SCALES) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      if (canvas.width < W * scale - 1 || canvas.height < H * scale - 1) continue;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) continue;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return { canvas, ctx };
    } catch {
      continue;
    }
  }
  return null;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível gerar a ficha."));
    }, "image/png");
  });
}

function drawFicha(
  ctx: CanvasRenderingContext2D,
  state: State,
  machine: MachineId,
  lines: FichaLine[],
) {
  const margin = 36;
  ctx.fillStyle = "#e7f2e4";
  ctx.fillRect(0, 0, W, H);

  const headerY = 28;
  const headerH = 118;
  ctx.fillStyle = "#8d3030";
  ctx.fillRect(margin, headerY, W - margin * 2, headerH);

  ctx.fillStyle = "#fffaf7";
  ctx.textBaseline = "middle";
  ctx.font = "700 58px 'Barlow Condensed', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ESTRATIFICAÇÃO DAS PERDAS", margin + 24, headerY + 46);

  ctx.font = "600 26px 'Source Sans 3', sans-serif";
  const assinatura = nomesNaFicha(state, machine);
  let meta = `${formatDateBR(state.date)}     ${TURNO_LABEL[state.turno]}`;
  if (assinatura) meta += `     ${assinatura}`;
  const maxMeta = W - margin * 2 - 250;
  if (ctx.measureText(meta).width > maxMeta) ctx.font = "600 22px 'Source Sans 3', sans-serif";
  while (ctx.measureText(meta).width > maxMeta && meta.length > 12) meta = `${meta.slice(0, -2)}…`;
  ctx.fillText(meta, margin + 24, headerY + 88);

  ctx.textAlign = "right";
  ctx.font = "600 22px 'Source Sans 3', sans-serif";
  ctx.fillText("MÁQUINA", W - margin - 24, headerY + 36);
  ctx.font = "700 46px 'Barlow Condensed', sans-serif";
  ctx.fillText(machine, W - margin - 24, headerY + 78);

  const tableX = margin;
  const tableY = headerY + headerH + 18;
  const tableW = W - margin * 2;
  const tableBottom = H - 28;
  const totalH = 58;
  const bodyBottom = tableBottom - totalH;
  const headH = 230;
  const rowH = (bodyBottom - tableY - headH) / lines.length;

  const estW = 108;
  const ladoW = 78;
  const numW = 118;
  const relW = 78;
  const fixed = estW + ladoW + numW + relW;
  const probW = (tableW - fixed) / PROBLEMS.length;

  ctx.fillStyle = "#f7fbf6";
  ctx.fillRect(tableX, tableY, tableW, tableBottom - tableY);
  ctx.fillStyle = "#f3e3dc";
  ctx.fillRect(tableX, tableY, tableW, headH);

  lines.forEach((line, index) => {
    if (Math.floor(index / 2) % 2 === 1) {
      ctx.fillStyle = "#dcecde";
      ctx.fillRect(tableX, tableY + headH + index * rowH, tableW, rowH);
    }
  });

  ctx.fillStyle = "#8d3030";
  ctx.fillRect(tableX, bodyBottom, tableW, totalH);

  ctx.strokeStyle = "#243028";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tableX, tableY, tableW, tableBottom - tableY);

  ctx.beginPath();
  ctx.moveTo(tableX, tableY + headH);
  ctx.lineTo(tableX + tableW, tableY + headH);
  ctx.moveTo(tableX, bodyBottom);
  ctx.lineTo(tableX + tableW, bodyBottom);
  for (let i = 1; i < lines.length; i++) {
    const y = tableY + headH + i * rowH;
    if (i % 2 === 0) {
      ctx.moveTo(tableX, y);
      ctx.lineTo(tableX + tableW, y);
      continue;
    }
    ctx.moveTo(tableX + estW, y);
    const above = lines[i - 1];
    const spanMatrix =
      Boolean(lines[i]?.shared || above?.shared) &&
      Boolean(above?.numero || above?.referencia || lines[i]?.numero || lines[i]?.referencia);
    if (!spanMatrix) {
      ctx.lineTo(tableX + tableW, y);
      continue;
    }
    ctx.lineTo(tableX + estW + ladoW, y);
    ctx.moveTo(tableX + fixed, y);
    ctx.lineTo(tableX + tableW, y);
  }
  let x = tableX;
  const widths = [estW, ladoW, numW, relW, ...PROBLEMS.map(() => probW)];
  widths.forEach((width, index) => {
    x += width;
    ctx.moveTo(x, tableY);
    ctx.lineTo(x, index < 3 ? bodyBottom : tableBottom);
  });
  ctx.stroke();

  ctx.fillStyle = "#243028";
  ctx.textAlign = "center";
  ctx.font = "700 22px 'Barlow Condensed', sans-serif";
  const headMid = tableY + headH / 2;
  ctx.fillText("EST.", tableX + estW / 2, headMid);
  ctx.fillText("LADO", tableX + estW + ladoW / 2, headMid);
  ctx.fillText("Nº", tableX + estW + ladoW + numW / 2, headMid);
  ctx.fillText("REF.", tableX + estW + ladoW + numW + relW / 2, headMid);

  PROBLEMS.forEach((problem, index) => {
    const colX = tableX + fixed + index * probW + probW / 2;
    const size = fitSize(ctx, problem.name, headH - 28, 18);
    ctx.save();
    ctx.translate(colX, tableY + headH - 14);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `600 ${size}px 'Source Sans 3', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#243028";
    ctx.fillText(problem.name, 0, 0);
    ctx.restore();
  });

  lines.forEach((line, index) => {
    const y = tableY + headH + index * rowH + rowH / 2;
    ctx.fillStyle = "#243028";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (index % 2 === 0 || line.outroId) {
      ctx.font = "700 28px 'Barlow Condensed', sans-serif";
      ctx.fillText(line.station >= 1 ? pad2(line.station) : "Troca", tableX + estW / 2, y + rowH / 2);
    }
    ctx.font = "600 20px 'Source Sans 3', sans-serif";
    ctx.fillText(SIDE_SHORT[line.side], tableX + estW + ladoW / 2, y);
    if (!(line.shared && index % 2 === 1)) {
      const matrixY = line.shared ? y + rowH / 2 : y;
      ctx.font = "600 20px 'Source Sans 3', sans-serif";
      ctx.fillText(line.numero, tableX + estW + ladoW + numW / 2, matrixY);
      ctx.fillText(line.referencia, tableX + estW + ladoW + numW + relW / 2, matrixY);
    }
    line.counts.forEach((count, problemIndex) => {
      if (!count) return;
      const colX = tableX + fixed + problemIndex * probW + probW / 2;
      ctx.font = "700 30px 'Barlow Condensed', sans-serif";
      ctx.fillText(String(count), colX, y);
    });
  });

  const sums = PROBLEMS.map((_, problemIndex) =>
    lines.reduce((sum, line) => sum + (line.counts[problemIndex] ?? 0), 0),
  );
  const grand = sums.reduce((sum, count) => sum + count, 0);
  const totalY = bodyBottom + totalH / 2;
  ctx.fillStyle = "#fffaf7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 30px 'Barlow Condensed', sans-serif";
  ctx.fillText(grand ? `TOTAL  ${grand}` : "TOTAL", tableX + fixed / 2, totalY);
  sums.forEach((sum, problemIndex) => {
    if (!sum) return;
    const colX = tableX + fixed + problemIndex * probW + probW / 2;
    ctx.fillText(String(sum), colX, totalY);
  });
}

function fitSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number) {
  let size = start;
  while (size > 11) {
    ctx.font = `600 ${size}px 'Source Sans 3', sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return size;
}
