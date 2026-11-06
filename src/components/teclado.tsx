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
    return { texto: String(atual), modo: "soma", ancora: atual, digitos: "" };
  }
  if (tecla === "-") {
    const atual = valor(campo);
    return { texto: String(atual), modo: "tira", ancora: atual, digitos: "" };
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

export function dicaDoCampo(campo: Campo | undefined): string {
  if (!campo || campo.modo === "total") return "O número digitado é o total.";
  if (campo.modo === "soma") return campo.digitos ? `Somando ${campo.digitos}.` : "Os próximos números somam.";
  return campo.digitos ? `Tirando ${campo.digitos}.` : "Os próximos números tiram.";
}

const CONTA = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["+", "0", "-"],
  ["⌫"],
];

const MATRIZ = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["/", "0", "⌫"],
];

export function Teclado({
  modo,
  onTecla,
}: {
  modo: "conta" | "matriz";
  onTecla: (tecla: string) => void;
}) {
  const linhas = modo === "conta" ? CONTA : MATRIZ;
  return (
    <div className="grid gap-1.5">
      {linhas.map((linha) => (
        <div key={linha.join("")} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${linha.length}, minmax(0, 1fr))` }}>
          {linha.map((tecla) => (
            <button
              key={tecla}
              type="button"
              onClick={() => onTecla(tecla)}
              className={
                tecla === "+" || tecla === "-"
                  ? "h-12 rounded-xl bg-[#2457b8] font-display text-3xl leading-none text-white"
                  : "h-12 rounded-xl bg-[#f3f6fb] font-display text-3xl leading-none text-[#1d2a3a]"
              }
            >
              {tecla === "-" ? "–" : tecla}
            </button>
          ))}
        </div>
      ))}
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
