"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { WorkspaceSelectionStatus } from "@/lib/workspace/selection";

export interface WorkspaceSnapshot {
  organizationId: string | null;
  organizationName: string | null;
  status: WorkspaceSelectionStatus;
  revision: number | null;
  unresolvedCount: number | undefined;
}

interface WorkspacePresentationState {
  snapshot: WorkspaceSnapshot;
  invalidate: () => void;
}

const WorkspaceContext = createContext<WorkspacePresentationState | undefined>(undefined);

export function WorkspacePresentation({ snapshot, children }: {
  snapshot: WorkspaceSnapshot;
  children: ReactNode;
}) {
  // Identity, not field equality: even a same-workspace RSC refresh is new evidence.
  const [invalidatedSnapshot, setInvalidatedSnapshot] = useState<WorkspaceSnapshot>();
  const current = invalidatedSnapshot === snapshot
    ? { ...snapshot, organizationId: null, organizationName: null, unresolvedCount: undefined }
    : snapshot;
  return <WorkspaceContext value={{ snapshot: current, invalidate: () => setInvalidatedSnapshot(snapshot) }}>
    {children}
  </WorkspaceContext>;
}

export function useWorkspaceSwitchStart() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace footer requires the authenticated presentation boundary");
  return context.invalidate;
}

export function WorkspaceIdentity() {
  const snapshot = useContext(WorkspaceContext)?.snapshot;
  return <p className="workspace-identity">{snapshot?.organizationName
    ? <>Organización activa: <strong>{snapshot.organizationName}</strong></>
    : "Organización sin verificar"}</p>;
}

export function WorkspaceReviewStatus() {
  const count = useContext(WorkspaceContext)?.snapshot.unresolvedCount;
  if (count === undefined) return <p>No se pudo verificar el estado de revisión.</p>;
  if (count === 0) return <p>Sin elementos pendientes</p>;
  return <p><Link href="/review">{count} elemento(s) de revisión pendiente(s)</Link></p>;
}

export function ReviewAttention() {
  return (
    <aside className="briefing-attention" aria-labelledby="review-attention-heading">
      <h2 id="review-attention-heading">Atención operativa</h2>
      <WorkspaceReviewStatus />
      <p>La revisión es de solo lectura y corresponde al alcance autorizado.</p>
      <Button asChild variant="ghost">
        <Link href="/review">Consultar revisión</Link>
      </Button>
    </aside>
  );
}
