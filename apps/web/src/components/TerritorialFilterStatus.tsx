import { Alert } from "@/components/ui/alert";

export function TerritorialFilterStatus({ visible, total, noMatches = false }: {
  visible: number; total: number; noMatches?: boolean;
}) {
  return <Alert variant="empty" presentation="inline" aria-live="polite" aria-atomic="true">{`${visible} visibles · ${total} territorios listados${noMatches ? " · No hay coincidencias." : ""}`}</Alert>;
}
