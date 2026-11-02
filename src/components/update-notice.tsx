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
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (window.parent !== window) return;
    let parado = false;

    async function checar() {
      const atual = bundleAtual();
      if (!atual) return;
      let remoto = "";
      try {
        remoto = await bundleRemoto();
      } catch {
        return;
      }
      if (parado || !remoto || atual === remoto) return;
      if (sessionStorage.getItem(RELOAD_KEY) === remoto) return;
      setAberto(true);
    }

    void checar();
    const timer = window.setInterval(() => void checar(), 60_000);
    function aoVoltar() {
      if (document.visibilityState === "visible") void checar();
    }
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      parado = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white px-6 py-6 text-center shadow-xl">
        <p className="text-base font-semibold text-[#1c1c1c]">Nova versão disponível.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 w-full rounded-2xl bg-[#4682B4] py-3 text-base font-semibold text-white"
        >
          Atualizar
        </button>
      </div>
    </div>
  );
}
