import { createHash, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";

const SENHA: Record<"preparador" | "lider", string> = {
  preparador: "1234",
  lider: "0000",
};

function same(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function asPapel(value: unknown): "preparador" | "lider" | null {
  return value === "preparador" || value === "lider" ? value : null;
}

export const entrar = createServerFn({ method: "POST" })
  .validator((data: { papel?: unknown; senha?: unknown }) => ({
    papel: asPapel(data?.papel),
    senha: typeof data?.senha === "string" ? data.senha.slice(0, 80) : "",
  }))
  .handler(async ({ data }): Promise<{ ok: false } | { ok: true; papel: "preparador" | "lider" }> => {
    if (!data.papel) return { ok: false };
    if (!same(data.senha, SENHA[data.papel])) return { ok: false };
    return { ok: true, papel: data.papel };
  });
