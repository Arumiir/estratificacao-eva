import { createHash, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";

type Papel = "preparador" | "lider";
type Conta = { nome: string; senha: string; papel: Papel };

const PATH = "contas/lista.json";

function hashSenha(senha: string) {
  return createHash("sha256").update(`eva|${senha}`).digest("hex");
}

function hashOk(senha: string, stored: string) {
  const left = Buffer.from(hashSenha(senha));
  const right = Buffer.from(stored);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function chave(nome: string) {
  return nome
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function cleanNome(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 32);
}

function cleanSenha(value: unknown) {
  if (typeof value !== "string") return "";
  return value.slice(0, 32);
}

function seed(): Conta[] {
  return [{ nome: "Líder", senha: hashSenha("0000"), papel: "lider" }];
}

function readConta(value: unknown): Conta | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { nome?: unknown; senha?: unknown; papel?: unknown };
  const nome = cleanNome(row.nome);
  if (nome.length < 2 || typeof row.senha !== "string" || row.senha.length < 32) return null;
  if (row.papel !== "preparador" && row.papel !== "lider") return null;
  return { nome, senha: row.senha, papel: row.papel };
}

async function readContas(): Promise<{ contas: Conta[]; etag: string | null }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return { contas: seed(), etag: null };
  const { get } = await import("@vercel/blob");
  const result = await get(PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return { contas: seed(), etag: null };
  const parsed = JSON.parse(await new Response(result.stream).text()) as unknown;
  const contas = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const conta = readConta(item);
    return conta ? [conta] : [];
  }) : [];
  if (!contas.some((conta) => conta.papel === "lider")) contas.unshift(seed()[0]!);
  return { contas, etag: result.blob.etag };
}

async function writeContas(contas: Conta[], etag: string | null) {
  const { put } = await import("@vercel/blob");
  await put(PATH, JSON.stringify(contas), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : {}),
  });
}

export const entrar = createServerFn({ method: "POST" })
  .validator((data: { nome?: unknown; senha?: unknown }) => ({
    nome: cleanNome(data?.nome),
    senha: cleanSenha(data?.senha),
  }))
  .handler(async ({ data }): Promise<{ ok: false } | { ok: true; papel: Papel; nome: string }> => {
    if (data.nome.length < 2 || data.senha.length < 4) return { ok: false };
    const { contas } = await readContas();
    const conta = contas.find((item) => chave(item.nome) === chave(data.nome));
    if (!conta || !hashOk(data.senha, conta.senha)) return { ok: false };
    return { ok: true, papel: conta.papel, nome: conta.nome };
  });

export const listarPreparadores = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(async (): Promise<{ nomes: string[] }> => {
    const { contas } = await readContas();
    return {
      nomes: contas.filter((conta) => conta.papel === "preparador").map((conta) => conta.nome),
    };
  });

export const criarPreparador = createServerFn({ method: "POST" })
  .validator((data: { nome?: unknown; senha?: unknown }) => ({
    nome: cleanNome(data?.nome),
    senha: cleanSenha(data?.senha),
  }))
  .handler(async ({ data }): Promise<{ ok: true; nome: string } | { ok: false; erro: string }> => {
    if (data.nome.length < 2) return { ok: false, erro: "Digite o nome." };
    if (data.senha.length < 4) return { ok: false, erro: "A senha precisa de 4 caracteres." };
    if (chave(data.nome) === "lider") return { ok: false, erro: "Esse nome é do líder." };
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return { ok: false, erro: "A nuvem não está ligada." };
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await readContas();
      if (current.contas.some((conta) => chave(conta.nome) === chave(data.nome))) {
        return { ok: false, erro: "Já existe esse nome." };
      }
      const next = [
        ...current.contas,
        { nome: data.nome, senha: hashSenha(data.senha), papel: "preparador" as const },
      ];
      try {
        await writeContas(next, current.etag);
        return { ok: true, nome: data.nome };
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    return { ok: false, erro: "Não foi possível salvar." };
  });
