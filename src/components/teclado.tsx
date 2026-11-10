import { useEffect, useRef, useState } from "react";

export function useToque() {
  const [toque, setToque] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const atualizar = () => setToque(mq.matches);
    atualizar();
    mq.addEventListener("change", atualizar);
    return () => mq.removeEventListener("change", atualizar);
  }, []);
  return toque;
}

let fechadorAtual: (() => void) | null = null;

export function tecladoAberto() {
  return fechadorAtual;
}

/** Toque fora guarda o número e fecha o teclado. O voltar do celular usa tecladoAberto. */
export function useFecharTeclado(aberto: boolean, fechar: () => void) {
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    if (!aberto) return;
    const atual = () => fecharRef.current();
    fechadorAtual = atual;
    const onPointer = (event: PointerEvent) => {
      const alvo = event.target;
      if (alvo instanceof Element && alvo.closest("[data-teclado], [data-campo-teclado], [data-nav]")) return;
      atual();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      if (fechadorAtual === atual) fechadorAtual = null;
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [aberto]);
}

export type Campo = {
  texto: string;
  modo: "total" | "soma" | "tira";
  ancora: number;
  digitos: string;
};

export function campoInicial(total: number): Campo {
  const n = Math.max(0, Math.floor(total));
  return { texto: String(n), modo: "total", ancora: n, digitos: "" };
}

function valor(campo: Campo): number {
  if (campo.modo === "soma") return campo.ancora + (Number(campo.digitos) || 0);
  if (campo.modo === "tira") return Math.max(0, campo.ancora - (Number(campo.digitos) || 0));
  if (!campo.digitos) return campo.ancora;
  return Number(campo.digitos) || 0;
}

function mostrar(campo: Campo): Campo {
  return { ...campo, texto: String(valor(campo)) };
}

export function teclaConta(campo: Campo, tecla: string): Campo {
  if (tecla === "+") {
    const atual = valor(campo);
    if (campo.modo === "soma") return { texto: String(atual), modo: "total", ancora: atual, digitos: "" };
    return { texto: String(atual), modo: "soma", ancora: atual, digitos: "" };
  }
  if (tecla === "-") {
    const atual = valor(campo);
    if (campo.modo === "tira") return { texto: String(atual), modo: "total", ancora: atual, digitos: "" };
    return { texto: String(atual), modo: "tira", ancora: atual, digitos: "" };
  }
  if (tecla === "ok") {
    const atual = valor(campo);
    return { texto: String(atual), modo: "total", ancora: atual, digitos: "" };
  }
  if (tecla === "⌫") {
    if (!campo.digitos) {
      if (campo.modo === "total") return { texto: "0", modo: "total", ancora: 0, digitos: "" };
      return { texto: String(campo.ancora), modo: campo.modo, ancora: campo.ancora, digitos: "" };
    }
    return mostrar({ ...campo, digitos: campo.digitos.slice(0, -1) });
  }
  if (!/^\d$/.test(tecla)) return campo;
  if (campo.modo === "total" && campo.digitos === "") {
    return mostrar({ ...campo, ancora: 0, digitos: tecla });
  }
  const digitos = (campo.digitos + tecla).replace(/^0+(?=\d)/, "").slice(0, 4);
  return mostrar({ ...campo, digitos });
}

export function teclaTexto(texto: string, tecla: string): string {
  if (tecla === "⌫") return texto.slice(0, -1);
  if (tecla === "/") {
    if (!texto || texto.endsWith("/")) return texto;
    return `${texto}/`.slice(0, 16);
  }
  if (!/^\d$/.test(tecla)) return texto;
  return `${texto}${tecla}`.slice(0, 16);
}

export function teclaLivre(texto: string, tecla: string): string {
  if (tecla === "⌫") return texto.slice(0, -1);
  if (tecla === " ") return texto.length >= 32 || texto.endsWith(" ") || texto.length === 0 ? texto : `${texto} `;
  if (!/^[a-z0-9/]$/i.test(tecla)) return texto;
  return `${texto}${tecla}`.slice(0, 32);
}

export function dicaDoCampo(campo: Campo | undefined): string {
  if (!campo || campo.modo === "total") return "O número digitado é o total.";
  if (campo.modo === "soma") return campo.digitos ? `Somando ${campo.digitos}.` : "Os próximos números somam.";
  return campo.digitos ? `Tirando ${campo.digitos}.` : "Os próximos números tiram.";
}

function Tecla({
  children,
  onClick,
  tom = "numero",
  label,
  ativo = false,
}: {
  children: string;
  onClick: () => void;
  tom?: "numero" | "acao" | "apagar";
  label?: string;
  ativo?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label ?? children}
      aria-pressed={ativo}
      onClick={onClick}
      className={
        ativo
          ? "h-12 rounded-2xl border-2 border-accent bg-white font-display text-3xl leading-none text-accent"
          : tom === "acao"
            ? "h-12 rounded-2xl bg-accent font-display text-3xl leading-none text-accent-ink"
            : tom === "apagar"
              ? "h-12 rounded-2xl bg-white font-display text-2xl leading-none text-[#5c6b7e]"
              : "h-12 rounded-2xl bg-white font-display text-3xl leading-none text-[#1d2a3a]"
      }
    >
      {children}
    </button>
  );
}

export function Teclado({
  modo,
  conta,
  onTecla,
}: {
  modo: "conta" | "matriz";
  conta?: Campo["modo"];
  onTecla: (tecla: string) => void;
}) {
  const linhas =
    modo === "conta"
      ? [
          ["1", "2", "3"],
          ["4", "5", "6"],
          ["7", "8", "9"],
          ["-", "0", "+"],
        ]
      : [
          ["1", "2", "3"],
          ["4", "5", "6"],
          ["7", "8", "9"],
          ["/", "0", "⌫"],
        ];
  return (
    <div data-teclado="" className="rounded-3xl bg-accent-soft p-2">
      <div className="grid gap-1.5">
        {linhas.map((linha) => (
          <div key={linha.join("")} className="grid grid-cols-3 gap-1.5">
            {linha.map((tecla) => (
              <Tecla
                key={tecla}
                tom={tecla === "+" || tecla === "-" || tecla === "/" ? "acao" : tecla === "⌫" ? "apagar" : "numero"}
                ativo={(tecla === "+" && conta === "soma") || (tecla === "-" && conta === "tira")}
                onClick={() => onTecla(tecla)}
              >
                {tecla === "-" ? "–" : tecla}
              </Tecla>
            ))}
          </div>
        ))}
        {modo === "conta" ? (
          <Tecla tom="apagar" label="Apagar" onClick={() => onTecla("⌫")}>
            ⌫
          </Tecla>
        ) : null}
      </div>
    </div>
  );
}

const LETRAS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export function TecladoLetras({ onTecla }: { onTecla: (tecla: string) => void }) {
  return (
    <div data-teclado="" className="rounded-3xl bg-accent-soft p-2">
      <div className="grid grid-cols-10 gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((tecla) => (
          <button
            key={tecla}
            type="button"
            onClick={() => onTecla(tecla)}
            className="h-10 rounded-xl bg-white font-display text-lg leading-none text-[#1d2a3a]"
          >
            {tecla}
          </button>
        ))}
      </div>
      <div className="mt-1 grid gap-1">
        {LETRAS.map((linha) => (
          <div key={linha[0]} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${linha.length}, minmax(0, 1fr))` }}>
            {linha.map((tecla) => (
              <button
                key={tecla}
                type="button"
                onClick={() => onTecla(tecla)}
                className="h-10 rounded-xl bg-white text-base font-semibold uppercase leading-none text-[#1d2a3a]"
              >
                {tecla}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        <button type="button" onClick={() => onTecla("/")} className="h-10 rounded-xl bg-accent font-display text-xl leading-none text-accent-ink">
          /
        </button>
        <button type="button" onClick={() => onTecla(" ")} className="col-span-2 h-10 rounded-xl bg-white text-sm font-semibold text-[#1d2a3a]">
          espaço
        </button>
        <button type="button" aria-label="Apagar" onClick={() => onTecla("⌫")} className="h-10 rounded-xl bg-white text-lg text-[#5c6b7e]">
          ⌫
        </button>
      </div>
    </div>
  );
}

export function AvisoSair({ onFicar, onSair }: { onFicar: () => void; onSair: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onFicar();
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
        <p className="text-center text-lg font-semibold">O que foi digitado não será salvo.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onFicar} className="rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold">
            Ficar
          </button>
          <button type="button" onClick={onSair} className="rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white">
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
