import { createFileRoute } from "@tanstack/react-router";
import { EstratificacaoApp } from "@/components/estratificacao";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <EstratificacaoApp />;
}
