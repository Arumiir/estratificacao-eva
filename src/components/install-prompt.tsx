import { useEffect, useState } from "react";
import {
  isIosBrowser,
  isStandalone,
  promptInstall,
  registerAppWorker,
} from "@/lib/install-prompt";

const DISMISS_KEY = "perdas-install-dismissed";

export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [ios, setIos] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (isStandalone()) return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    if (window.parent === window) registerAppWorker();
    setIos(isIosBrowser());
    setOpen(true);
  }, []);

  if (!open) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  async function install() {
    const outcome = await promptInstall();
    if (outcome === "accepted" || outcome === "dismissed") {
      if (outcome === "dismissed") sessionStorage.setItem(DISMISS_KEY, "1");
      setOpen(false);
      return;
    }
    setHint("No menu do navegador (⋮), toque em Instalar app ou Adicionar à tela inicial.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-fg/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="install-title"
        className="w-full max-w-md rounded-tile border border-line bg-surface p-5 shadow-lg"
      >
        <h2 id="install-title" className="font-display text-3xl leading-none text-accent">
          Instalar neste celular?
        </h2>
        <p className="mt-2 text-base text-fg">
          O app fica na tela inicial e abre direto, sem a barra do navegador.
        </p>
        {ios ? (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm font-semibold text-muted">
            <li>Toque em Compartilhar no Safari.</li>
            <li>Escolha Adicionar à Tela de Início.</li>
            <li>Confirme em Adicionar.</li>
          </ol>
        ) : null}
        {hint ? <p className="mt-3 text-sm font-semibold text-muted">{hint}</p> : null}
        <div className="mt-4 flex gap-2">
          {ios ? null : (
            <button
              type="button"
              onClick={() => void install()}
              className="min-h-12 flex-1 rounded-tile bg-accent px-4 font-semibold text-accent-ink"
            >
              Instalar
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="min-h-12 flex-1 rounded-tile bg-surface-2 px-4 font-semibold text-fg"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
