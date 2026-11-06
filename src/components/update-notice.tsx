import { useEffect } from "react";

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
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (window.parent !== window) return;
    let parado = false;
    let alvo = "";

    function aplicar(remoto: string) {
      if (sessionStorage.getItem(RELOAD_KEY) === remoto) return;
      sessionStorage.setItem(RELOAD_KEY, remoto);
      window.location.reload();
    }

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
      alvo = remoto;
      if (document.visibilityState === "hidden") aplicar(remoto);
    }

    function aoVoltar() {
      if (document.visibilityState === "hidden" && alvo) aplicar(alvo);
    }

    void checar();
    const timer = window.setInterval(() => void checar(), 20_000);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      parado = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  return null;
}