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
  const grupos = gruposFicha(fichaLines(state, machine))
    .map((grupo) => ({ ...grupo, lines: linhasComConteudo(grupo.lines) }))
    .filter((grupo) => grupo.lines.length > 0);
  const arquivos: { nome: string; blob: Blob }[] = [];
  const medida = document.createElement("canvas").getContext("2d");
  if (!medida) throw new Error("Não foi possível gerar a ficha.");
  for (const grupo of grupos) {
    const layout = medirFicha(medida, grupo.lines);
    const surface = createSurfaceSized(layout.largura, layout.altura, escalasDaFicha(layout.largura, layout.altura));
    if (!surface) throw new Error("Não foi possível gerar a ficha.");
    drawFichaSecreta(surface.ctx, state, machine, grupo.nome, layout);
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
export async function entregarArquivos(
  arquivos: { name: string; blob: Blob }[],
  texto = "",
): Promise<"compartilhou" | "baixou" | "cancelou"> {
  const files = arquivos.map((item) => new File([item.blob], item.name, { type: item.blob.type || "image/png" }));
  const pode =
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files });
  if (pode) {
    const title = arquivos.length === 1 ? arquivos[0].name : "Imagens";
    try {
      await navigator.share(texto ? { files, text: texto, title } : { files, title });
      return "compartilhou";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelou";
      if (texto) {
        try {
          await navigator.share({ files, title });
          return "compartilhou";
        } catch (deNovo) {
          if (deNovo instanceof DOMException && deNovo.name === "AbortError") return "cancelou";
        }
      }
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

function escalasDaFicha(largura: number, altura: number) {
  const maior = Math.max(largura, altura, 1);
  const ideal = Math.min(8, Math.max(2, Math.ceil(7680 / maior)));
  return [...new Set([ideal, 4, 3, 2])];
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

/** Escreve o fechamento embaixo da ficha. O WhatsApp descarta a legenda quando vai arquivo. */
export async function anexarLegenda(blob: Blob, linhas: string[]): Promise<Blob> {
  const uteis = linhas.filter((linha) => linha.trim());
  if (uteis.length === 0) return blob;
  await document.fonts.load("600 32px 'Source Sans 3'");
  const image = await carregarImagem(blob);
  const largura = image.width;
  const fonte = Math.max(32, Math.round(largura / 78));
  const medida = document.createElement("canvas").getContext("2d");
  if (!medida) return blob;
  medida.font = `600 ${fonte}px 'Source Sans 3', sans-serif`;
  const margem = Math.round(largura * 0.03);
  const quebradas = linhas.flatMap((linha) => {
    if (!linha.trim()) return [""];
    const partes = quebrarTexto(medida, linha, largura - margem * 2);
    return partes.length > 0 ? partes : [linha];
  });
  const linhaH = Math.round(fonte * 1.4);
  const faixa = linhaH * quebradas.length + margem * 2;
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = image.height + faixa;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = `600 ${fonte}px 'Source Sans 3', sans-serif`;
  ctx.textBaseline = "top";
  quebradas.forEach((linha, index) => {
    if (!linha) return;
    ctx.fillText(linha, margem, image.height + margem + index * linhaH);
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

const PROBLEMS_FICHA = PROBLEMS.filter((problem) => problem.id !== "contaminacao");
const MARGEM = 32;
const ROW_H = 46;
const TOTAL_H = 50;
const HEADER_H = 118;
const NOME_FONTE = 17;
const NOME_LH = 20;

type BlocoVisivel = { station: number; unica: boolean; linhas: FichaLine[] };
type ColunaFicha = { chave: "est" | "lado" | "num" | "ref"; w: number; titulo: string };
type LayoutFicha = {
  largura: number;
  altura: number;
  blocos: BlocoVisivel[];
  problemas: typeof PROBLEMS_FICHA;
  colunas: ColunaFicha[];
  probW: number;
  headH: number;
  nomes: string[][];
  grand: number;
  somas: number[];
};

function caixa(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const raio = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.arcTo(x + w, y, x + w, y + h, raio);
  ctx.arcTo(x + w, y + h, x, y + h, raio);
  ctx.arcTo(x, y + h, x, y, raio);
  ctx.arcTo(x, y, x + w, y, raio);
  ctx.closePath();
}

function linhasComConteudo(lines: FichaLine[]) {
  return lines.filter((line) => line.numero.trim() || line.referencia.trim() || line.counts.some((count) => count > 0));
}

function blocosComConteudo(lines: FichaLine[]): BlocoVisivel[] {
  const vivos = linhasComConteudo(lines);
  const grade = STATIONS.flatMap((station) => {
    const doPosto = vivos.filter((line) => line.station === station && !line.outroId);
    if (doPosto.length === 0) return [];
    if (doPosto.some((line) => line.unica)) return [{ station, unica: true, linhas: [doPosto[0]!] }];
    const linhas = (["esq", "dir"] as const)
      .map((side) => doPosto.find((line) => line.side === side))
      .filter((line): line is FichaLine => Boolean(line));
    return linhas.length > 0 ? [{ station, unica: false, linhas }] : [];
  });
  const outros = [...new Set(vivos.map((line) => line.outroId).filter(Boolean))].flatMap((id) => {
    const doItem = vivos.filter((line) => line.outroId === id);
    const station = doItem[0]?.station ?? 0;
    if (doItem.some((line) => line.unica)) return [{ station, unica: true, linhas: [doItem[0]!] }];
    const linhas = (["esq", "dir"] as const)
      .map((side) => doItem.find((line) => line.side === side))
      .filter((line): line is FichaLine => Boolean(line));
    return linhas.length > 0 ? [{ station, unica: false, linhas }] : [];
  });
  return [...grade, ...outros];
}

function medirFicha(ctx: CanvasRenderingContext2D, lines: FichaLine[]): LayoutFicha {
  const blocos = blocosComConteudo(lines);
  const problemas = PROBLEMS_FICHA.filter((problem) => {
    const index = PROBLEMS.findIndex((item) => item.id === problem.id);
    return blocos.some((bloco) => bloco.linhas.some((line) => (line.counts[index] ?? 0) > 0));
  });
  const somas = problemas.map((problem) => {
    const index = PROBLEMS.findIndex((item) => item.id === problem.id);
    return blocos.reduce((sum, bloco) => sum + bloco.linhas.reduce((parcial, line) => parcial + (line.counts[index] ?? 0), 0), 0);
  });
  const grand = somas.reduce((sum, count) => sum + count, 0);
  const temLado = blocos.some((bloco) => !bloco.unica);
  const temNumero = blocos.some((bloco) => bloco.linhas.some((line) => line.numero.trim()));
  const temRef = blocos.some((bloco) => bloco.linhas.some((line) => line.referencia.trim()));
  const colunas: ColunaFicha[] = [{ chave: "est", w: 88, titulo: "EST." }];
  if (temLado) colunas.push({ chave: "lado", w: 78, titulo: "LADO" });
  if (temNumero) colunas.push({ chave: "num", w: 128, titulo: "Nº" });
  if (temRef) colunas.push({ chave: "ref", w: 72, titulo: "REF." });
  const fixo = colunas.reduce((sum, coluna) => sum + coluna.w, 0);
  ctx.font = `700 ${NOME_FONTE}px 'Barlow Condensed', sans-serif`;
  let probW = problemas.length > 0 ? 168 : 0;
  let nomes = problemas.map((problem) => quebrarTexto(ctx, problem.name, Math.max(20, probW - 18)));
  if (problemas.length > 0 && nomes.some((item) => item.length > 5)) {
    probW = 210;
    nomes = problemas.map((problem) => quebrarTexto(ctx, problem.name, probW - 18));
  }
  const maxLinhas = Math.max(1, ...nomes.map((item) => item.length), 1);
  const headH = problemas.length > 0 ? Math.max(72, maxLinhas * NOME_LH + 28) : 52;
  const linhas = blocos.reduce((sum, bloco) => sum + bloco.linhas.length, 0);
  const tabela = fixo + probW * problemas.length;
  const largura = Math.max(680, MARGEM * 2 + tabela);
  const faixaTotal = grand > 0 ? TOTAL_H : 0;
  const altura = MARGEM + HEADER_H + 18 + headH + ROW_H * Math.max(1, linhas) + faixaTotal + (grand > 0 ? 14 + TOTAL_H : 0) + MARGEM;
  return { largura, altura, blocos, problemas, colunas, probW, headH, nomes, grand, somas };
}

function xDaColuna(layout: LayoutFicha, chave: ColunaFicha["chave"]) {
  let x = MARGEM;
  for (const coluna of layout.colunas) {
    if (coluna.chave === chave) return x;
    x += coluna.w;
  }
  return x;
}

function drawFichaSecreta(
  ctx: CanvasRenderingContext2D,
  state: State,
  machine: MachineId,
  corNome: string,
  layout: LayoutFicha,
) {
  const cor = FICHA_TURNO[state.turno];
  const { largura, altura, blocos, problemas, colunas, probW, headH, nomes, grand, somas } = layout;
  const fixo = colunas.reduce((sum, coluna) => sum + coluna.w, 0);
  const tabela = fixo + probW * problemas.length;
  ctx.fillStyle = "#e8eef5";
  ctx.fillRect(0, 0, largura, altura);

  const cardX = 16;
  const cardY = 16;
  const cardW = largura - 32;
  const cardH = altura - 32;
  ctx.fillStyle = BRANCO;
  caixa(ctx, cardX, cardY, cardW, cardH, 18);
  ctx.fill();

  const headerY = MARGEM;
  ctx.fillStyle = cor.faixa;
  caixa(ctx, MARGEM, headerY, largura - MARGEM * 2, HEADER_H, 16);
  ctx.fill();
  ctx.fillRect(MARGEM, headerY + HEADER_H - 18, largura - MARGEM * 2, 18);

  ctx.fillStyle = "#fffaf7";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "600 16px 'Source Sans 3', sans-serif";
  ctx.fillText("ESTRATIFICAÇÃO DAS PERDAS", MARGEM + 22, headerY + 28);
  ctx.font = "700 42px 'Barlow Condensed', sans-serif";
  ctx.fillText(machine, MARGEM + 22, headerY + 64);
  ctx.font = "600 18px 'Source Sans 3', sans-serif";
  const meta = [formatDateBR(state.date), TURNO_LABEL[state.turno], corNome].filter(Boolean).join("   ·   ");
  ctx.fillText(meta, MARGEM + 22, headerY + 96);

  const tableX = MARGEM;
  const tableY = headerY + HEADER_H + 18;
  const tableW = tabela;
  let cursorY = tableY + headH;
  const faixas = blocos.map((bloco) => {
    const topo = cursorY;
    cursorY += bloco.linhas.length * ROW_H;
    return { bloco, topo, altura: bloco.linhas.length * ROW_H };
  });
  const bodyBottom = cursorY;

  ctx.fillStyle = "#f4f7fb";
  ctx.fillRect(tableX, tableY, tableW, headH);
  faixas.forEach((faixa, index) => {
    if (index % 2 !== 1) return;
    ctx.fillStyle = "#f7f9fc";
    ctx.fillRect(tableX, faixa.topo, tableW, faixa.altura);
  });
  if (grand > 0) {
    ctx.fillStyle = cor.faixa;
    ctx.fillRect(tableX, bodyBottom, tableW, TOTAL_H);
  }

  ctx.strokeStyle = "#d5dee8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.strokeRect(tableX, tableY, tableW, bodyBottom - tableY + (grand > 0 ? TOTAL_H : 0));
  ctx.moveTo(tableX, tableY + headH);
  ctx.lineTo(tableX + tableW, tableY + headH);
  if (grand > 0) {
    ctx.moveTo(tableX, bodyBottom);
    ctx.lineTo(tableX + tableW, bodyBottom);
  }
  faixas.forEach((faixa, index) => {
    if (index > 0) {
      ctx.moveTo(tableX, faixa.topo);
      ctx.lineTo(tableX + tableW, faixa.topo);
    }
    if (faixa.bloco.linhas.length < 2) return;
    const compartilhado = faixa.bloco.linhas.every((line) => line.shared);
    const corte = faixa.topo + ROW_H;
    const estW = colunas.find((coluna) => coluna.chave === "est")?.w ?? 0;
    const ladoW = colunas.find((coluna) => coluna.chave === "lado")?.w ?? 0;
    if (!compartilhado) {
      ctx.moveTo(tableX + estW, corte);
      ctx.lineTo(tableX + tableW, corte);
      return;
    }
    ctx.moveTo(tableX + estW, corte);
    ctx.lineTo(tableX + estW + ladoW, corte);
    ctx.moveTo(tableX + fixo, corte);
    ctx.lineTo(tableX + tableW, corte);
  });
  let x = tableX;
  colunas.forEach((coluna) => {
    x += coluna.w;
    ctx.moveTo(x, tableY);
    ctx.lineTo(x, bodyBottom);
  });
  problemas.forEach((_, index) => {
    x = tableX + fixo + index * probW;
    if (index === 0 && colunas.length > 0) {
      ctx.moveTo(x, tableY);
      ctx.lineTo(x, bodyBottom + (grand > 0 ? TOTAL_H : 0));
    }
    if (index > 0) {
      ctx.moveTo(x, tableY);
      ctx.lineTo(x, bodyBottom + (grand > 0 ? TOTAL_H : 0));
    }
  });
  ctx.stroke();

  ctx.fillStyle = "#3d4d61";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 15px 'Barlow Condensed', sans-serif";
  colunas.forEach((coluna) => {
    const esquerda = xDaColuna(layout, coluna.chave);
    ctx.fillText(coluna.titulo, esquerda + coluna.w / 2, tableY + headH / 2);
  });

  ctx.font = `700 ${NOME_FONTE}px 'Barlow Condensed', sans-serif`;
  ctx.fillStyle = "#1d2a3a";
  nomes.forEach((linhas, index) => {
    const colX = tableX + fixo + index * probW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(colX + 6, tableY + 8, probW - 12, headH - 16);
    ctx.clip();
    const topo = tableY + (headH - linhas.length * NOME_LH) / 2 + NOME_LH / 2;
    linhas.forEach((linha, linhaIndex) => {
      ctx.fillText(linha, colX + probW / 2, topo + linhaIndex * NOME_LH);
    });
    ctx.restore();
  });

  ctx.fillStyle = "#1d2a3a";
  faixas.forEach((faixa) => {
    const meio = faixa.topo + faixa.altura / 2;
    const est = colunas.find((coluna) => coluna.chave === "est");
    if (est) {
      ctx.font = "700 26px 'Barlow Condensed', sans-serif";
      ctx.fillText(faixa.bloco.station >= 1 ? pad2(faixa.bloco.station) : "Troca", xDaColuna(layout, "est") + est.w / 2, meio);
    }
    const lado = colunas.find((coluna) => coluna.chave === "lado");
    faixa.bloco.linhas.forEach((line, index) => {
      const y = faixa.topo + index * ROW_H + ROW_H / 2;
      if (lado && !faixa.bloco.unica) {
        ctx.font = "600 16px 'Source Sans 3', sans-serif";
        ctx.fillText(SIDE_SHORT[line.side], xDaColuna(layout, "lado") + lado.w / 2, y);
      }
      if (lado && faixa.bloco.unica && index === 0) {
        ctx.font = "600 16px 'Source Sans 3', sans-serif";
        ctx.fillText("Ambos", xDaColuna(layout, "lado") + lado.w / 2, meio);
      }
    });
    const compartilhado = !faixa.bloco.unica && faixa.bloco.linhas.length > 1 && faixa.bloco.linhas.every((line) => line.shared);
    faixa.bloco.linhas.forEach((line, index) => {
      if (compartilhado && index > 0) return;
      const y = compartilhado || faixa.bloco.unica ? meio : faixa.topo + index * ROW_H + ROW_H / 2;
      ctx.font = "600 18px 'Source Sans 3', sans-serif";
      const num = colunas.find((coluna) => coluna.chave === "num");
      const ref = colunas.find((coluna) => coluna.chave === "ref");
      if (num && line.numero.trim()) ctx.fillText(line.numero, xDaColuna(layout, "num") + num.w / 2, y);
      if (ref && line.referencia.trim()) ctx.fillText(line.referencia, xDaColuna(layout, "ref") + ref.w / 2, y);
    });
    problemas.forEach((problem, problemPos) => {
      const problemIndex = PROBLEMS.findIndex((item) => item.id === problem.id);
      const colX = tableX + fixo + problemPos * probW + probW / 2;
      if (faixa.bloco.unica) {
        const count = faixa.bloco.linhas[0]?.counts[problemIndex] ?? 0;
        if (!count) return;
        ctx.font = "700 26px 'Barlow Condensed', sans-serif";
        ctx.fillText(String(count), colX, meio);
        return;
      }
      faixa.bloco.linhas.forEach((line, index) => {
        const count = line.counts[problemIndex] ?? 0;
        if (!count) return;
        ctx.font = "700 24px 'Barlow Condensed', sans-serif";
        ctx.fillText(String(count), colX, faixa.topo + index * ROW_H + ROW_H / 2);
      });
    });
  });

  if (grand > 0) {
    ctx.fillStyle = "#fffaf7";
    ctx.font = "700 20px 'Barlow Condensed', sans-serif";
    ctx.fillText("TOTAL", tableX + fixo / 2, bodyBottom + TOTAL_H / 2);
    somas.forEach((sum, index) => {
      if (!sum) return;
      ctx.font = "700 24px 'Barlow Condensed', sans-serif";
      ctx.fillText(String(sum), tableX + fixo + index * probW + probW / 2, bodyBottom + TOTAL_H / 2);
    });
    const celulaY = bodyBottom + TOTAL_H + 14;
    const celulaW = Math.min(fixo, 280);
    ctx.fillStyle = cor.faixa;
    caixa(ctx, tableX, celulaY, celulaW, TOTAL_H, 12);
    ctx.fill();
    ctx.fillStyle = "#fffaf7";
    ctx.font = "700 22px 'Barlow Condensed', sans-serif";
    ctx.fillText(`TOTAL GERAL   ${grand}`, tableX + celulaW / 2, celulaY + TOTAL_H / 2);
  }
}
