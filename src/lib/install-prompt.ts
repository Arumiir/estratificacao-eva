type InstallChoice = "accepted" | "dismissed" | "unavailable";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function registerAppWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (window.parent !== window) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export async function promptInstall(): Promise<InstallChoice> {
  const win = window as Window & { __perdasInstallPrompt?: BeforeInstallPromptEvent | null };
  const event = deferred ?? win.__perdasInstallPrompt ?? null;
  if (!event) return "unavailable";
  deferred = null;
  win.__perdasInstallPrompt = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === "accepted" ? "accepted" : "dismissed";
}
