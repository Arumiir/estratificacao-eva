import {
  PROBLEMS,
  SIDE_SHORT,
  STATIONS,
  TURNO_LABEL,
  fichaLines,
  formatDateBR,
  pad2,
  type FichaLine,
  type MachineId,
  type Side,
  type State,
  type Turno,
} from "@/lib/perdas";

const W = 1800;
const H = 1180;
/** Mesmo quadro, mais pixels. 3× deixa o zoom nítido; 2× se o celular recusar o canvas. */
const SCALES = [3, 2];

/** Só a faixa muda: 1º preto, 2º azul, 3º vermelho. O restante fica branco. */
const BRANCO = "#ffffff";
const FICHA_TURNO: Record<Turno, { papel: string; faixa: string; tabela: string; cabeca: string; zebra: string; tinta: string }> = {
  "1": { papel: BRANCO, faixa: "#2a2a2a", tabela: BRANCO, cabeca: BRANCO, zebra: "#f4f4f4", tinta: "#1c1c1c" },
  "2": { papel: BRANCO, faixa: "#1f5f99", tabela: BRANCO, cabeca: BRANCO, zebra: "#f4f4f4", tinta: "#1c1c1c" },
  "3": { papel: BRANCO, faixa: "#9b2c2c", tabela: BRANCO, cabeca: BRANCO, zebra: "#f4f4f4", tinta: "#1c1c1c" },
};

export async function renderFichasDaMaquina(
  state: State,
  machine: MachineId,
): Promise<{ nome: string; blob: Blob }[]> {
  await document.fonts.load("700 64px 'Barlow Condensed'");
  await document.fonts.load("700 22px 'Barlow Condensed'");
  await document.fonts.load("600 26px 'Source Sans 3'");
  await document.fonts.ready;
  const grupos = gruposFicha(fichaLines(state, machine));
  const arquivos: { nome: string; blob: Blob }[] = [];
  for (const grupo of grupos) {
    const surface = createSurfaceSized(SECRETA_LARGURA, alturaSecreta(blocosDaFicha(grupo.lines).length), [2, 1]);
    if (!surface) throw new Error("Não foi possível gerar a ficha.");
    drawFichaSecreta(surface.ctx, state, machine, grupo.lines, grupo.nome);
    arquivos.push({ nome: grupo.nome, blob: await canvasToBlob(surface.canvas) });
  }
  return arquivos;
}

function gruposFicha(lines: FichaLine[]) {
  const nomes = [...new Set(lines.map((line) => line.cor).filter(Boolean))];
  if (nomes.length === 0) return [{ nome: "", lines }];
  return nomes.map((nome, index) => ({
    nome,
    lines: lines.filter((line) => line.cor === nome || (index === 0 && !line.cor && line.outroId)),
  }));
}

export async function renderFichaPng(state: State, machine: MachineId): Promise<Blob> {
  const grupos = await renderFichasDaMaquina(state, machine);
  return grupos[0]?.blob ?? new Blob();
}

export async function renderFichasPdf(state: State, machines: MachineId[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const machine of machines) {
    const grupos = await renderFichasDaMaquina(state, machine);
    for (const grupo of grupos) {
      const image = await pdf.embedPng(new Uint8Array(await grupo.blob.arrayBuffer()));
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

/** No celular abre o menu de enviar (WhatsApp etc.) e não grava na galeria. No computador baixa. */
export async function entregarArquivos(arquivos: { name: string; blob: Blob }[]): Promise<"compartilhou" | "baixou" | "cancelou"> {
  const files = arquivos.map((item) => new File([item.blob], item.name, { type: item.blob.type || "image/png" }));
  const pode =
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files });
  if (pode) {
    try {
      await navigator.share({ files, title: arquivos.length === 1 ? arquivos[0].name : "Imagens" });
      return "compartilhou";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelou";
    }
  }
  arquivos.forEach((arquivo, index) => {
    window.setTimeout(() => downloadBlob(arquivo.name, arquivo.blob), index * 400);
  });
  return "baixou";
}

export type RankingImagem = {
  data: string;
  periodo: string;
  faixa: string;
  maquinas: {
    nome: string;
    total: number;
    linhas: { rotulo: string; pares: number; percentual: string; cor: string }[];
    motivos: string;
  }[];
};

const RANKING_MARGEM = 28;
const RANKING_COL = 340;
const RANKING_GAP = 14;
const RANKING_COLS = 3;

function alturaRanking(linhas: number) {
  return 34 + 30 + Math.max(1, linhas) * 26 + 12 + 86;
}

export async function renderRankingPng(ficha: RankingImagem): Promise<Blob> {
  await document.fonts.load("700 64px 'Barlow Condensed'");
  await document.fonts.load("600 20px 'Source Sans 3'");
  await document.fonts.ready;
  const n = Math.max(1, ficha.maquinas.length);
  const cols = Math.min(RANKING_COLS, n);
  const fileiras = Math.ceil(n / cols);
  const width = RANKING_MARGEM * 2 + cols * RANKING_COL + (cols - 1) * RANKING_GAP;
  let blocos = 0;
  for (let fileira = 0; fileira < fileiras; fileira += 1) {
    const fatia = ficha.maquinas.slice(fileira * cols, fileira * cols + cols);
    blocos += fatia.length === 0 ? alturaRanking(1) : Math.max(...fatia.map((item) => alturaRanking(item.linhas.length)));
  }
  const alturaFaixa = 118;
  const height = 24 + alturaFaixa + 18 + blocos + Math.max(0, fileiras - 1) * RANKING_GAP + 24;
  const surface = createSurfaceSized(width, height, [3, 2, 1]);
  if (!surface) throw new Error("Não foi possível gerar a ficha.");
  drawRanking(surface.ctx, ficha, width, height);
  return canvasToBlob(surface.canvas);
}

function drawRanking(ctx: CanvasRenderingContext2D, ficha: RankingImagem, width: number, height: number) {
  const margin = RANKING_MARGEM;
  const colW = RANKING_COL;
  const gap = RANKING_GAP;
  const cols = Math.min(RANKING_COLS, Math.max(1, ficha.maquinas.length));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ficha.faixa;
  ctx.fillRect(margin, 24, width - margin * 2, 118);
  ctx.fillStyle = "#fffaf7";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "700 42px 'Barlow Condensed', sans-serif";
  ctx.fillText("RANKING DAS PERDAS", margin + 20, 52);
  ctx.font = "600 20px 'Source Sans 3', sans-serif";
  ctx.fillText(`${ficha.data}     ${ficha.periodo}`, margin + 20, 84);
  const legenda = [
    ["#8fe3b0", "Até 5%"],
    ["#ffe08a", "5% a 10%"],
    ["#ffb4b4", "Acima de 10%"],
  ] as const;
  let legendaX = margin + 20;
  ctx.font = "600 16px 'Source Sans 3', sans-serif";
  for (const [cor, texto] of legenda) {
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(legendaX + 6, 112, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fffaf7";
    ctx.fillText(texto, legendaX + 16, 112);
    legendaX += ctx.measureText(texto).width + 36;
  }

  let yBase = 24 + 118 + 18;
  for (let inicio = 0; inicio < ficha.maquinas.length; inicio += cols) {
    const fatia = ficha.maquinas.slice(inicio, inicio + cols);
    fatia.forEach((item, index) => {
      const x = margin + index * (colW + gap);
      let y = yBase;
      ctx.fillStyle = "#f4f7fb";
      ctx.fillRect(x, y, colW, 34);
      ctx.fillStyle = "#1e3a5f";
      ctx.font = "700 22px 'Barlow Condensed', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.nome, x + 10, y + 17);
      ctx.textAlign = "right";
      ctx.font = "600 16px 'Source Sans 3', sans-serif";
      ctx.fillText(`${item.total} pares`, x + colW - 10, y + 17);
      y += 34;
      ctx.fillStyle = "#1e3a5f";
      ctx.font = "700 13px 'Source Sans 3', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("NÚMERO", x + 18, y + 15);
      ctx.textAlign = "right";
      ctx.fillText("PARES", x + colW - 62, y + 15);
      ctx.fillText("%", x + colW - 10, y + 15);
      y += 30;
      item.linhas.forEach((linha, linhaIndex) => {
        if (linhaIndex % 2 === 1) {
          ctx.fillStyle = "#f7f9fc";
          ctx.fillRect(x, y - 12, colW, 26);
        }
        ctx.fillStyle = linha.cor || "#9aa8b5";
        ctx.beginPath();
        ctx.arc(x + 10, y + 1, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1c1c1c";
        ctx.textAlign = "left";
        ctx.font = "600 15px 'Source Sans 3', sans-serif";
        let rotulo = linha.rotulo;
        while (ctx.measureText(rotulo).width > colW - 120 && rotulo.length > 4) rotulo = `${rotulo.slice(0, -2)}…`;
        ctx.fillText(rotulo, x + 20, y + 1);
        ctx.textAlign = "right";
        ctx.font = "600 15px 'Source Sans 3', sans-serif";
        ctx.fillText(String(linha.pares), x + colW - 62, y + 1);
        ctx.fillStyle = linha.cor || "#3d4a5c";
        ctx.fillText(linha.percentual, x + colW - 10, y + 1);
        y += 26;
      });
      y += 8;
      ctx.fillStyle = "#1e3a5f";
      ctx.textAlign = "left";
      ctx.font = "700 12px 'Source Sans 3', sans-serif";
      ctx.fillText("PRINCIPAIS MOTIVOS", x + 10, y + 8);
      ctx.fillStyle = "#1c1c1c";
      ctx.font = "600 14px 'Source Sans 3', sans-serif";
      const linhasMotivo = quebrarTexto(ctx, item.motivos || "Sem motivo.", colW - 20);
      linhasMotivo.slice(0, 3).forEach((texto, motivoIndex) => {
        ctx.fillText(texto, x + 10, y + 28 + motivoIndex * 18);
      });
    });
    yBase += Math.max(...fatia.map((item) => alturaRanking(item.linhas.length))) + gap;
  }
}

function quebrarTexto(ctx: CanvasRenderingContext2D, texto: string, maxW: number): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (ctx.measureText(teste).width > maxW && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function createSurface(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  return createSurfaceSized(W, H);
}

function createSurfaceSized(
  width: number,
  height: number,
  scales: number[] = SCALES,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  for (const scale of scales) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      if (canvas.width < width * scale - 1 || canvas.height < height * scale - 1) continue;
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

function carregarImagem(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a ficha."));
    };
    image.src = url;
  });
}

/** Escreve o fechamento embaixo da ficha. O WhatsApp não tem legenda diferente por foto. */
export async function anexarLegenda(blob: Blob, linhas: string[]): Promise<Blob> {
  await document.fonts.load("600 28px 'Source Sans 3'");
  const image = await carregarImagem(blob);
  const escala = image.width / W;
  const medida = document.createElement("canvas").getContext("2d");
  if (!medida || escala <= 0) return blob;
  medida.font = "600 28px 'Source Sans 3', sans-serif";
  const quebradas = linhas.flatMap((linha) => {
    const partes = quebrarTexto(medida, linha, W - 72);
    return partes.length > 0 ? partes : [linha];
  });
  const faixa = 36 + quebradas.length * 38;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height + Math.round(faixa * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.fillStyle = "#f4f6f8";
  ctx.fillRect(36, H, W - 72, faixa - 16);
  ctx.fillStyle = "#1c1c1c";
  ctx.textBaseline = "top";
  ctx.font = "600 28px 'Source Sans 3', sans-serif";
  quebradas.forEach((linha, index) => {
    ctx.fillText(linha, 56, H + 16 + index * 38);
  });
  return canvasToBlob(canvas);
}

function drawFicha(
  ctx: CanvasRenderingContext2D,
  state: State,
  machine: MachineId,
  lines: FichaLine[],
  corNome = "",
) {
  const margin = 36;
  const cor = FICHA_TURNO[state.turno];
  ctx.fillStyle = cor.papel;
  ctx.fillRect(0, 0, W, H);

  const headerY = 28;
  const headerH = 118;
  ctx.fillStyle = cor.faixa;
  ctx.fillRect(margin, headerY, W - margin * 2, headerH);

  ctx.fillStyle = "#fffaf7";
  ctx.textBaseline = "middle";
  ctx.font = "700 58px 'Barlow Condensed', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ESTRATIFICAÇÃO DAS PERDAS", margin + 24, headerY + 46);

  ctx.font = "600 26px 'Source Sans 3', sans-serif";
  let meta = `${formatDateBR(state.date)}     ${TURNO_LABEL[state.turno]}`;
  const maxMeta = W - margin * 2 - 250;
  if (ctx.measureText(meta).width > maxMeta) ctx.font = "600 22px 'Source Sans 3', sans-serif";
  while (ctx.measureText(meta).width > maxMeta && meta.length > 12) meta = `${meta.slice(0, -2)}…`;
  ctx.fillText(meta, margin + 24, headerY + 88);

  ctx.textAlign = "right";
  ctx.font = "600 22px 'Source Sans 3', sans-serif";
  ctx.fillText("MÁQUINA", W - margin - 24, headerY + 36);
  ctx.font = "700 46px 'Barlow Condensed', sans-serif";
  ctx.fillText(machine, W - margin - 24, headerY + 78);
  if (corNome) {
    ctx.font = "600 22px 'Source Sans 3', sans-serif";
    ctx.fillText(corNome, W - margin - 24, headerY + 108);
  }

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

  ctx.fillStyle = cor.tabela;
  ctx.fillRect(tableX, tableY, tableW, tableBottom - tableY);
  ctx.fillStyle = cor.cabeca;
  ctx.fillRect(tableX, tableY, tableW, headH);

  lines.forEach((line, index) => {
    if (Math.floor(index / 2) % 2 === 1) {
      ctx.fillStyle = cor.zebra;
      ctx.fillRect(tableX, tableY + headH + index * rowH, tableW, rowH);
    }
  });

  ctx.fillStyle = cor.faixa;
  ctx.fillRect(tableX, bodyBottom, tableW, totalH);

  ctx.strokeStyle = cor.tinta;
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

  ctx.fillStyle = cor.tinta;
  ctx.textAlign = "center";
  ctx.font = "700 22px 'Barlow Condensed', sans-serif";
  const headMid = tableY + headH / 2;
  ctx.fillText("EST.", tableX + estW / 2, headMid);
  ctx.fillText("LADO", tableX + estW + ladoW / 2, headMid);
  ctx.fillText("Nº", tableX + estW + ladoW + numW / 2, headMid);
  ctx.fillText("REF.", tableX + estW + ladoW + numW + relW / 2, headMid);

  PROBLEMS.forEach((problem, index) => {
    const colX = tableX + fixed + index * probW + probW / 2;
    ctx.save();
    ctx.translate(colX, tableY + headH - 8);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "600 12px 'Source Sans 3', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = cor.tinta;
    const linhas = quebrarTexto(ctx, problem.name, headH - 28);
    const linhaH = 13;
    const topo = -((linhas.length - 1) * linhaH) / 2;
    linhas.forEach((linha, linhaIndex) => {
      ctx.fillText(linha, 0, topo + linhaIndex * linhaH);
    });
    ctx.restore();
  });

  lines.forEach((line, index) => {
    const y = tableY + headH + index * rowH + rowH / 2;
    ctx.fillStyle = cor.tinta;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (line.unica || line.outroId || index % 2 === 0) {
      ctx.font = "700 28px 'Barlow Condensed', sans-serif";
      const meio = line.unica || line.outroId ? y : y + rowH / 2;
      ctx.fillText(line.station >= 1 ? pad2(line.station) : "Troca", tableX + estW / 2, meio);
    }
    if (!line.unica) {
      ctx.font = "600 20px 'Source Sans 3', sans-serif";
      ctx.fillText(SIDE_SHORT[line.side], tableX + estW + ladoW / 2, y);
    }
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

const SECRETA_MARGEM = 36;
const SECRETA_EST = 108;
const SECRETA_LADO = 78;
const SECRETA_NUM = 118;
const SECRETA_REL = 78;
const SECRETA_FIXO = SECRETA_EST + SECRETA_LADO + SECRETA_NUM + SECRETA_REL;
const SECRETA_PROB = 112;
const SECRETA_LARGURA = SECRETA_MARGEM * 2 + SECRETA_FIXO + SECRETA_PROB * PROBLEMS.length;
const SECRETA_CABECA = 156;
const SECRETA_LINHA = 38;
const SECRETA_TOTAL = 46;

function alturaSecreta(estacoes: number) {
  return 28 + 118 + 18 + SECRETA_CABECA + SECRETA_LINHA * 2 * Math.max(1, estacoes) + SECRETA_TOTAL * 2 + 24;
}

/** Fichas do fechamento, uma embaixo da outra. Não é a ficha do acompanhamento. */
export async function renderFichaJunta(state: State, machines: MachineId[]): Promise<Blob> {
  await document.fonts.load("700 64px 'Barlow Condensed'");
  await document.fonts.load("700 22px 'Barlow Condensed'");
  await document.fonts.load("600 26px 'Source Sans 3'");
  await document.fonts.ready;
  const paginas: HTMLCanvasElement[] = [];
  for (const machine of machines) {
    for (const grupo of gruposFicha(fichaLines(state, machine))) {
      if (grupo.lines.length === 0) continue;
      const surface = createSurfaceSized(SECRETA_LARGURA, alturaSecreta(blocosDaFicha(grupo.lines).length), [2, 1]);
      if (!surface) throw new Error("Não foi possível gerar a ficha.");
      drawFichaSecreta(surface.ctx, state, machine, grupo.lines, grupo.nome);
      paginas.push(surface.canvas);
    }
  }
  if (paginas.length === 0) throw new Error("Nenhuma ficha neste turno.");
  if (paginas.length === 1) return canvasToBlob(paginas[0]!);
  const gap = 48;
  const width = Math.max(...paginas.map((canvas) => canvas.width));
  const height = paginas.reduce((soma, canvas) => soma + canvas.height, 0) + gap * (paginas.length - 1);
  const junto = document.createElement("canvas");
  junto.width = width;
  junto.height = height;
  const ctx = junto.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Não foi possível gerar a ficha.");
  ctx.fillStyle = BRANCO;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const pagina of paginas) {
    ctx.drawImage(pagina, 0, y);
    y += pagina.height + gap;
  }
  return canvasToBlob(junto);
}

function linhaVazia(station: number, side: Side, outroId = ""): FichaLine {
  return {
    machine: "SIE01",
    station,
    side,
    numero: "",
    referencia: "",
    shared: false,
    unica: false,
    counts: PROBLEMS.map(() => 0),
    outroId,
    cor: "",
  };
}

function blocosDaFicha(lines: FichaLine[]) {
  const grade = STATIONS.map((station) => {
    const doPosto = lines.filter((line) => line.station === station && !line.outroId);
    if (doPosto.some((line) => line.unica)) return { station, unica: true, linhas: [doPosto[0]!] };
    const esq = doPosto.find((line) => line.side === "esq") ?? linhaVazia(station, "esq");
    const dir = doPosto.find((line) => line.side === "dir") ?? linhaVazia(station, "dir");
    return { station, unica: false, linhas: [esq, dir] };
  });
  const outros = [...new Set(lines.map((line) => line.outroId).filter(Boolean))].map((id) => {
    const doItem = lines.filter((line) => line.outroId === id);
    const station = doItem[0]?.station ?? 0;
    if (doItem.some((line) => line.unica)) return { station, unica: true, linhas: [doItem[0]!] };
    const esq = doItem.find((line) => line.side === "esq") ?? linhaVazia(station, "esq", id);
    const dir = doItem.find((line) => line.side === "dir") ?? linhaVazia(station, "dir", id);
    return { station, unica: false, linhas: [esq, dir] };
  });
  return [...grade, ...outros];
}

function nomeDeitado(ctx: CanvasRenderingContext2D, texto: string, maxW: number) {
  let tamanho = 15;
  let linhas = [texto];
  while (tamanho >= 11) {
    ctx.font = `700 ${tamanho}px 'Barlow Condensed', sans-serif`;
    linhas = quebrarTexto(ctx, texto, maxW);
    if (linhas.every((linha) => ctx.measureText(linha).width <= maxW)) return { tamanho, linhas };
    tamanho -= 1;
  }
  return { tamanho, linhas };
}

function drawFichaSecreta(
  ctx: CanvasRenderingContext2D,
  state: State,
  machine: MachineId,
  lines: FichaLine[],
  corNome = "",
) {
  const margin = SECRETA_MARGEM;
  const width = SECRETA_LARGURA;
  const height = alturaSecreta(blocosDaFicha(lines).length);
  const cor = FICHA_TURNO[state.turno];
  ctx.fillStyle = cor.papel;
  ctx.fillRect(0, 0, width, height);

  const headerY = 28;
  const headerH = 118;
  ctx.fillStyle = cor.faixa;
  ctx.fillRect(margin, headerY, width - margin * 2, headerH);
  ctx.fillStyle = "#fffaf7";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "700 58px 'Barlow Condensed', sans-serif";
  ctx.fillText("ESTRATIFICAÇÃO DAS PERDAS", margin + 24, headerY + 46);
  ctx.font = "600 26px 'Source Sans 3', sans-serif";
  ctx.fillText(`${formatDateBR(state.date)}     ${TURNO_LABEL[state.turno]}`, margin + 24, headerY + 88);
  ctx.textAlign = "right";
  ctx.font = "600 22px 'Source Sans 3', sans-serif";
  ctx.fillText("MÁQUINA", width - margin - 24, headerY + 36);
  ctx.font = "700 46px 'Barlow Condensed', sans-serif";
  ctx.fillText(machine, width - margin - 24, headerY + 78);
  if (corNome) {
    ctx.font = "600 22px 'Source Sans 3', sans-serif";
    ctx.fillText(corNome, width - margin - 24, headerY + 108);
  }

  const tableX = margin;
  const tableY = headerY + headerH + 18;
  const tableW = width - margin * 2;
  const tableBottom = height - 20;
  const bodyBottom = tableBottom - SECRETA_TOTAL * 2;
  const estW = SECRETA_EST;
  const ladoW = SECRETA_LADO;
  const numW = SECRETA_NUM;
  const relW = SECRETA_REL;
  const fixed = SECRETA_FIXO;
  const probW = SECRETA_PROB;
  const headH = SECRETA_CABECA;
  const rowH = SECRETA_LINHA;
  const blocos = blocosDaFicha(lines);

  ctx.fillStyle = "#f6f6f6";
  ctx.fillRect(tableX, tableY, tableW, headH);
  ctx.fillStyle = cor.faixa;
  ctx.fillRect(tableX, bodyBottom, tableW, SECRETA_TOTAL * 2);
  blocos.forEach((bloco, blocoIndex) => {
    if (blocoIndex % 2 !== 1) return;
    const y = tableY + headH + blocoIndex * rowH * 2;
    ctx.fillStyle = cor.zebra;
    ctx.fillRect(tableX, y, tableW, rowH * 2);
  });

  ctx.strokeStyle = cor.tinta;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tableX, tableY, tableW, tableBottom - tableY);
  ctx.beginPath();
  ctx.moveTo(tableX, tableY + headH);
  ctx.lineTo(tableX + tableW, tableY + headH);
  ctx.moveTo(tableX, bodyBottom);
  ctx.lineTo(tableX + tableW, bodyBottom);
  ctx.moveTo(tableX, bodyBottom + SECRETA_TOTAL);
  ctx.lineTo(tableX + tableW, bodyBottom + SECRETA_TOTAL);
  blocos.forEach((bloco, blocoIndex) => {
    const y = tableY + headH + blocoIndex * rowH * 2;
    if (blocoIndex > 0) {
      ctx.moveTo(tableX, y);
      ctx.lineTo(tableX + tableW, y);
    }
    if (!bloco.unica) {
      ctx.moveTo(tableX, y + rowH);
      ctx.lineTo(tableX + tableW, y + rowH);
    }
  });
  let x = tableX;
  [estW, ladoW, numW, relW, ...PROBLEMS.map(() => probW)].forEach((coluna, index) => {
    x += coluna;
    ctx.moveTo(x, tableY);
    ctx.lineTo(x, index < 3 ? bodyBottom : tableBottom);
  });
  ctx.stroke();

  ctx.fillStyle = cor.tinta;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 20px 'Barlow Condensed', sans-serif";
  const meioCabeca = tableY + headH / 2;
  ctx.fillText("EST.", tableX + estW / 2, meioCabeca);
  ctx.fillText("LADO", tableX + estW + ladoW / 2, meioCabeca);
  ctx.fillText("Nº", tableX + estW + ladoW + numW / 2, meioCabeca);
  ctx.fillText("REF.", tableX + fixed - relW / 2, meioCabeca);

  PROBLEMS.forEach((problem, index) => {
    const colX = tableX + fixed + index * probW;
    const nome = nomeDeitado(ctx, problem.name, probW - 10);
    ctx.save();
    ctx.beginPath();
    ctx.rect(colX + 2, tableY + 4, probW - 4, headH - 8);
    ctx.clip();
    ctx.font = `700 ${nome.tamanho}px 'Barlow Condensed', sans-serif`;
    ctx.fillStyle = cor.tinta;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const linhaH = nome.tamanho + 3;
    const topo = tableY + (headH - nome.linhas.length * linhaH) / 2 + linhaH / 2;
    nome.linhas.forEach((linha, linhaIndex) => {
      ctx.fillText(linha, colX + probW / 2, topo + linhaIndex * linhaH);
    });
    ctx.restore();
  });

  blocos.forEach((bloco, blocoIndex) => {
    const topo = tableY + headH + blocoIndex * rowH * 2;
    const meio = topo + rowH;
    const primeira = bloco.linhas[0];
    if (!primeira) return;
    ctx.fillStyle = cor.tinta;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 24px 'Barlow Condensed', sans-serif";
    ctx.fillText(primeira.station >= 1 ? pad2(primeira.station) : "Troca", tableX + estW / 2, meio);
    if (!bloco.unica) {
      bloco.linhas.forEach((line, index) => {
        const y = topo + index * rowH + rowH / 2;
        ctx.font = "600 15px 'Source Sans 3', sans-serif";
        ctx.fillText(SIDE_SHORT[line.side], tableX + estW + ladoW / 2, y);
      });
    }
    const compartilhado = !bloco.unica && bloco.linhas.length === 2 && bloco.linhas.every((line) => line.shared);
    bloco.linhas.forEach((line, index) => {
      const y = topo + index * rowH + rowH / 2;
      const noMeio = bloco.unica || compartilhado;
      if (noMeio && index > 0) return;
      const matrixY = noMeio ? meio : y;
      ctx.font = "600 16px 'Source Sans 3', sans-serif";
      ctx.fillText(line.numero, tableX + estW + ladoW + numW / 2, matrixY);
      ctx.fillText(line.referencia, tableX + fixed - relW / 2, matrixY);
    });
    PROBLEMS.forEach((_, problemIndex) => {
      const colX = tableX + fixed + problemIndex * probW + probW / 2;
      if (bloco.unica) {
        const count = primeira.counts[problemIndex] ?? 0;
        if (!count) return;
        ctx.font = "700 24px 'Barlow Condensed', sans-serif";
        ctx.fillText(String(count), colX, meio);
        return;
      }
      bloco.linhas.forEach((line, index) => {
        const count = line.counts[problemIndex] ?? 0;
        if (!count) return;
        ctx.font = "700 22px 'Barlow Condensed', sans-serif";
        ctx.fillText(String(count), colX, topo + index * rowH + rowH / 2);
      });
    });
  });

  const sums = PROBLEMS.map((_, problemIndex) =>
    blocos.reduce((sum, bloco) => sum + bloco.linhas.reduce((parcial, line) => parcial + (line.counts[problemIndex] ?? 0), 0), 0),
  );
  const grand = sums.reduce((sum, count) => sum + count, 0);
  ctx.fillStyle = "#fffaf7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 22px 'Barlow Condensed', sans-serif";
  ctx.fillText("TOTAL", tableX + fixed / 2, bodyBottom + SECRETA_TOTAL / 2);
  sums.forEach((sum, problemIndex) => {
    ctx.fillText(String(sum), tableX + fixed + problemIndex * probW + probW / 2, bodyBottom + SECRETA_TOTAL / 2);
  });
  ctx.font = "700 24px 'Barlow Condensed', sans-serif";
  ctx.fillText(`TOTAL GERAL  ${grand}`, tableX + fixed / 2, bodyBottom + SECRETA_TOTAL + SECRETA_TOTAL / 2);
}
