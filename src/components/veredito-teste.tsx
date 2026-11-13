import { useState } from "react";

type Semana = {
  id: string;
  rotulo: string;
  contra: string;
  piorou: Frase[];
  melhorou: Frase[];
  repete: Frase[];
};

type Frase = {
  maquina: string;
  delta: string;
  molde: string;
  problema: string;
  quando: string;
};

const SEMANAS: Semana[] = [
  {
    id: "10-16",
    rotulo: "10–16 nov",
    contra: "03–09 nov",
    piorou: [
      {
        maquina: "SIE04",
        delta: "+40",
        molde: "39/40 · ref 2",
        problema: "Contaminação (molde sujo)",
        quando: "Concentrou terça e quinta. Na semana anterior foram 52 pares.",
      },
      {
        maquina: "SIE01",
        delta: "+18",
        molde: "37/38 · ref 1",
        problema: "Gás preso",
        quando: "Quase tudo na quarta. Na semana anterior foram 30 pares.",
      },
    ],
    melhorou: [
      {
        maquina: "SIE02",
        delta: "−22",
        molde: "35 · ref 4",
        problema: "Falta de carga",
        quando: "Caiu de 80 para 58 pares.",
      },
      {
        maquina: "SIE06",
        delta: "−9",
        molde: "33/34 · ref 1",
        problema: "Rebarba",
        quando: "Caiu em todos os dias, menos sábado.",
      },
    ],
    repete: [
      {
        maquina: "SIE03",
        delta: "3 sem.",
        molde: "41/42 · ref 3",
        problema: "Contaminação (molde sujo)",
        quando: "Três semanas seguidas no topo. Não caiu.",
      },
      {
        maquina: "SIE05",
        delta: "3 sem.",
        molde: "36 · ref 2",
        problema: "Falta de carga",
        quando: "O número muda, o problema não.",
      },
    ],
  },
  {
    id: "03-09",
    rotulo: "03–09 nov",
    contra: "27 out–02 nov",
    piorou: [
      {
        maquina: "SIE02",
        delta: "+27",
        molde: "35 · ref 4",
        problema: "Falta de carga",
        quando: "Segunda e sábado. Na semana anterior foram 53 pares.",
      },
    ],
    melhorou: [
      {
        maquina: "SIE04",
        delta: "−15",
        molde: "39/40 · ref 2",
        problema: "Gás preso",
        quando: "Caiu de 67 para 52 pares.",
      },
      {
        maquina: "SIE01",
        delta: "−11",
        molde: "37/38 · ref 1",
        problema: "Rebarba",
        quando: "Só sobrou resíduo na sexta.",
      },
    ],
    repete: [
      {
        maquina: "SIE03",
        delta: "2 sem.",
        molde: "41/42 · ref 3",
        problema: "Contaminação (molde sujo)",
        quando: "Já era o pior problema na semana anterior.",
      },
      {
        maquina: "SIE05",
        delta: "2 sem.",
        molde: "36 · ref 2",
        problema: "Falta de carga",
        quando: "Segue no mesmo molde.",
      },
    ],
  },
  {
    id: "27-02",
    rotulo: "27 out–02 nov",
    contra: "20–26 out",
    piorou: [
      {
        maquina: "SIE06",
        delta: "+16",
        molde: "33/34 · ref 1",
        problema: "Rebarba",
        quando: "Quinta e sexta. Na semana anterior foram 21 pares.",
      },
    ],
    melhorou: [
      {
        maquina: "SIE01",
        delta: "−8",
        molde: "40 · ref 1",
        problema: "Manchas (fluidez/pigmentação)",
        quando: "Caiu de 29 para 21 pares.",
      },
    ],
    repete: [
      {
        maquina: "SIE05",
        delta: "1 sem.",
        molde: "36 · ref 2",
        problema: "Falta de carga",
        quando: "Primeira semana desse problema no topo.",
      },
    ],
  },
];

export function VereditoTeste() {
  const [indice, setIndice] = useState(0);
  const semana = SEMANAS[indice] ?? SEMANAS[0]!;

  return (
    <div className="mx-auto w-full max-w-lg">
      <p className="font-display text-4xl leading-none text-accent">Veredito</p>
      <p className="mt-1 text-sm font-semibold text-muted">Teste com dados fictícios. Não é o turno de verdade.</p>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {SEMANAS.map((item, itemIndice) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setIndice(itemIndice)}
            className={
              itemIndice === indice
                ? "shrink-0 rounded-tile bg-accent px-3 py-2 text-sm font-semibold text-accent-ink"
                : "shrink-0 rounded-tile border border-line bg-surface px-3 py-2 text-sm font-semibold text-muted"
            }
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      <p className="mt-4 text-base font-semibold text-fg">
        {semana.rotulo} contra {semana.contra}
      </p>

      <Bloco titulo="Piorou" tom="ruim" frases={semana.piorou} />
      <Bloco titulo="Melhorou" tom="bom" frases={semana.melhorou} />
      <Bloco titulo="Repete" tom="neutro" frases={semana.repete} />
    </div>
  );
}

function Bloco({ titulo, tom, frases }: { titulo: string; tom: "ruim" | "bom" | "neutro"; frases: Frase[] }) {
  const cor = tom === "ruim" ? "text-[#c4342d]" : tom === "bom" ? "text-[#2f7d4a]" : "text-accent";
  return (
    <section className="mt-5">
      <h2 className="font-display text-2xl leading-none text-fg">{titulo}</h2>
      <div className="mt-2 grid gap-2">
        {frases.map((frase) => (
          <article key={`${frase.maquina}-${frase.problema}`} className="rounded-tile border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-4xl leading-none">{frase.maquina}</h3>
              <p className={`font-display text-4xl leading-none ${cor}`}>{frase.delta}</p>
            </div>
            <p className="mt-2 text-sm font-semibold text-muted">{frase.molde}</p>
            <p className="mt-2 text-base font-semibold">{frase.problema}</p>
            <p className="mt-1 text-sm text-muted">{frase.quando}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
