import { createHash, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";

type Papel = "preparador" | "lider";
type TurnoConta = "1" | "2" | "3";
type Conta = { nome: string; senha: string; papel: Papel; turno: TurnoConta | null };

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
  const lista: [string, string, Papel, TurnoConta | null][] = [
    ["1111", "0000", "lider", null],
    ["Guilherme", "guilherme123", "preparador", "1"],
    ["Wesley", "wesley123", "preparador", "1"],
    ["Yan", "yan123", "preparador", "1"],
    ["Francisvaldo", "francisvaldo123", "preparador", "1"],
    ["Felipe", "felipe123", "preparador", "1"],
    ["Caua", "caua123", "preparador", "1"],
  ];
  return lista.map(([nome, senha, papel, turno]) => ({ nome, senha: hashSenha(senha), papel, turno }));
}

function comSeed(contas: Conta[]) {
  const map = new Map(contas.map((conta) => [chave(conta.nome), conta]));
  let changed = false;
  if (map.delete("lider")) changed = true;
  if (map.delete("0000")) changed = true;
  for (const conta of seed()) {
    const atual = map.get(chave(conta.nome));
    if (!atual || atual.senha !== conta.senha || atual.papel !== conta.papel || atual.nome !== conta.nome || atual.turno !== conta.turno) {
      map.set(chave(conta.nome), conta);
      changed = true;
    }
  }
  return { contas: [...map.values()], changed };
}

function readConta(value: unknown): Conta | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { nome?: unknown; senha?: unknown; papel?: unknown; turno?: unknown };
  const nome = cleanNome(row.nome);
  if (nome.length < 2 || typeof row.senha !== "string" || row.senha.length < 32) return null;
  if (row.papel !== "preparador" && row.papel !== "lider") return null;
  const turno = row.turno === "1" || row.turno === "2" || row.turno === "3" ? row.turno : row.papel === "preparador" ? "1" : null;
  return { nome, senha: row.senha, papel: row.papel, turno };
}

async function readContas(): Promise<{ contas: Conta[]; etag: string | null }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return { contas: seed(), etag: null };
  try {
    const { get } = await import("@vercel/blob");
    const result = await get(PATH, { access: "private", useCache: false });
    let contas: Conta[] = [];
    let etag: string | null = null;
    if (result && result.statusCode === 200 && result.stream) {
      const parsed = JSON.parse(await new Response(result.stream).text()) as unknown;
      contas = Array.isArray(parsed)
        ? parsed.flatMap((item) => {
            const conta = readConta(item);
            return conta ? [conta] : [];
          })
        : [];
      etag = result.blob.etag;
    }
    const merged = comSeed(contas);
    if (merged.changed) {
      try {
        await writeContas(merged.contas, etag);
      } catch {
        /* o login usa a lista nova mesmo se a gravação atrasar */
      }
    }
    return { contas: merged.contas, etag };
  } catch {
    return { contas: seed(), etag: null };
  }
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
  .handler(async ({ data }): Promise<{ ok: false } | { ok: true; papel: Papel; nome: string; turno: TurnoConta | null }> => {
    if (data.nome.length < 2 || data.senha.length < 4) return { ok: false };
    const { contas } = await readContas();
    const conta = contas.find((item) => chave(item.nome) === chave(data.nome));
    if (!conta || !hashOk(data.senha, conta.senha)) return { ok: false };
    return { ok: true, papel: conta.papel, nome: conta.nome, turno: conta.turno };
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
  .validator((data: { nome?: unknown; senha?: unknown; turno?: unknown }) => ({
    nome: cleanNome(data?.nome),
    senha: cleanSenha(data?.senha),
    turno: (data?.turno === "2" || data?.turno === "3" ? data.turno : "1") as "1" | "2" | "3",
  }))
  .handler(async ({ data }): Promise<{ ok: true; nome: string } | { ok: false; erro: string }> => {
    if (data.nome.length < 2) return { ok: false, erro: "Digite o nome." };
    if (data.senha.length < 4) return { ok: false, erro: "A senha precisa de 4 caracteres." };
    if (chave(data.nome) === "lider" || chave(data.nome) === "1111") return { ok: false, erro: "Esse nome é do líder." };
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
        { nome: data.nome, senha: hashSenha(data.senha), papel: "preparador" as const, turno: data.turno },
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
