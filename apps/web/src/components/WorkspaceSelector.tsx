"use client";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSelection } from "@/lib/workspace/selection";

interface WorkspaceSelectorProps { initialSelection: WorkspaceSelection; onSwitchStart?: () => void; }
interface WorkspaceSelectorSnapshot { activeOrganizationId: string | null; revision: number | null; status: WorkspaceSelection["status"]; }
const messages: Record<string, string> = {
  conflict: "La organización cambió en otra pestaña. Actualizá la página e intentá de nuevo.",
  denied: "Ya no tenés acceso a esa organización.",
  expired: "El contexto de organización venció. Volvé a iniciar sesión.",
  mismatch: "No se pudo verificar que este contexto pertenezca a tu sesión.",
  revoked: "El contexto de organización fue revocado. Volvé a iniciar sesión.",
  selection_required: "Seleccioná una organización para continuar.",
  stale: "Tu acceso a la organización activa cambió. Seleccioná una organización autorizada nuevamente.",
  unavailable: "No se pudo cambiar la organización.",
};

export function WorkspaceSelector({ initialSelection, onSwitchStart }: WorkspaceSelectorProps) {
  const router = useRouter();
  const organizationId = useId();
  const [selected, setSelected] = useState(initialSelection.activeOrganizationId ?? "");
  const [revision, setRevision] = useState(initialSelection.revision);
  const [message, setMessage] = useState(messages[initialSelection.status] ?? "");
  const [pending, startTransition] = useTransition();
  const snapshot: WorkspaceSelectorSnapshot = { activeOrganizationId: initialSelection.activeOrganizationId, revision: initialSelection.revision, status: initialSelection.status };
  const [previous, setPrevious] = useState(snapshot);
  if (previous.activeOrganizationId !== snapshot.activeOrganizationId || previous.revision !== snapshot.revision || previous.status !== snapshot.status) {
    setPrevious(snapshot);
    if (previous.activeOrganizationId !== snapshot.activeOrganizationId) setSelected(snapshot.activeOrganizationId ?? "");
    if (previous.revision !== snapshot.revision) setRevision(snapshot.revision);
    if (previous.status !== snapshot.status) setMessage(messages[snapshot.status] ?? "");
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected || revision === null) return;
    onSwitchStart?.();
    startTransition(async () => {
      setMessage("");
      try {
        const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: selected, expectedRevision: revision }) });
        const result = (await response.json()) as { status?: unknown; revision?: unknown };
        if (typeof result.revision === "number" && Number.isSafeInteger(result.revision) && result.revision >= 0) setRevision(result.revision);
        if (response.ok && result.status === "active") { setMessage("Organización activa."); router.refresh(); return; }
        setMessage(messages[String(result.status)] ?? messages["unavailable"] ?? "");
      } catch { setMessage(messages["unavailable"] ?? ""); }
    });
  }
  if (initialSelection.status === "unavailable") return <p role="status">No se pudo cargar la organización.</p>;
  if (["revoked", "expired", "mismatch"].includes(initialSelection.status)) return <p role="status">{messages[initialSelection.status]}</p>;
  if (initialSelection.total === 0) return <div>{message ? <p role="status">{message}</p> : null}<p role="status">No hay organizaciones disponibles.</p></div>;
  if (initialSelection.organizations.length === 0) return <p role="status">No se pudo cargar la lista parcial de organizaciones.</p>;
  return <form onSubmit={submit}>
    <label htmlFor={organizationId}>Organización</label>{" "}
    <select id={organizationId} value={selected} onChange={(event) => setSelected(event.target.value)} disabled={pending}>
      <option value="" disabled>Seleccionar organización</option>
      {initialSelection.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
    </select>{" "}
    <button className="button button--secondary" type="submit" disabled={pending || !selected}>{pending ? "Cambiando…" : "Cambiar organización"}</button>
    {message ? <p role="status">{message}</p> : null}
    {initialSelection.truncated && initialSelection.total !== null ? <p role="note">La lista está limitada a las primeras 100 de {initialSelection.total} organizaciones autorizadas; la organización activa puede aparecer adicionalmente.</p> : null}
  </form>;
}
