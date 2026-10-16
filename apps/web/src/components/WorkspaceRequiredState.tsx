import { Alert } from "@/components/ui/alert";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import type { WorkspaceSelection } from "@/lib/workspace/selection";

export function WorkspaceRequiredState({ selection, title }: { selection: WorkspaceSelection; title: string }) {
  const needsSelection = selection.status === "selection_required" || selection.status === "stale";
  const message = selection.status === "denied"
    ? "No tenés autorización para acceder a esta organización."
    : selection.status === "expired"
      ? "El contexto de organización venció. Volvé a iniciar sesión."
      : selection.status === "revoked"
        ? "El contexto de organización fue revocado. Volvé a iniciar sesión."
        : "No se pudo verificar la organización. Intentá de nuevo más tarde.";
  return <main className="page-shell">
    <h1>{title}</h1>
    <h2>{needsSelection ? "Seleccioná una organización" : "Organización no disponible"}</h2>
    {needsSelection ? <section aria-label="Selección de organización">
      <Alert variant="needs-selection">
        <p>Elegí una organización autorizada para cargar los datos de esta página.</p>
        <WorkspaceSelector initialSelection={selection} />
      </Alert>
    </section> : <Alert variant={selection.status === "denied" || selection.status === "expired" || selection.status === "revoked" ? "denied" : "unavailable"}>{message}</Alert>}
  </main>;
}
