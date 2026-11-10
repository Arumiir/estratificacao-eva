import { useEffect, useState } from "react";

const RELOAD_KEY = "perdas-reload-for";

function nomesDe(lista: string[]) {
  return [...new Set(lista.map((item) => item.split("?")[0]?.split("/").pop() ?? "").filter((item) => /^(?:index|routes)-.+\.js$/.test(item)))]
    .sort()
    .join("|");
}

function bundleAtual() {
  const links = [...document.querySelectorAll('link[rel="modulepreload"]')].map((link) => (link as HTMLLinkElement).href);
  const scripts = [...document.scripts].map((script) => script.src);
  return nomesDe([...links, ...scripts]);
}

async function bundleRemoto() {
  const resposta = await fetch("/", { cache: "no-store", headers: { accept: "text/html" } });
  if (!resposta.ok) return "";
  const html = await resposta.text();
  return nomesDe([...html.matchAll(/\/assets\/(?:index|routes)-[^"]+\.js/g)].map((item) => item[0]));
}

export function UpdateNotice() {
  const [remoto, setRemoto] = useState("");

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (window.parent !== window) return;
    let parado = false;

    async function checar() {
      const atual = bundleAtual();
      if (!atual) return;
      let proximo = "";
      try {
        proximo = await bundleRemoto();
      } catch {
        return;
      }
      if (parado || !proximo || atual === proximo) return;
      if (sessionStorage.getItem(RELOAD_KEY) === proximo) return;
      setRemoto(proximo);
    }

    void checar();
    const timer = window.setInterval(() => void checar(), 20_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void checar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      parado = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  if (!remoto) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white px-6 py-6 text-center shadow-xl">
        <p className="text-lg font-semibold">Tem atualização</p>
        <p className="mt-2 text-base text-muted">Toque para carregar a versão nova.</p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(RELOAD_KEY, remoto);
            window.location.reload();
          }}
          className="mt-5 w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink"
        >
          Atualizar
        </button>
      </div>
    </div>
  );
}