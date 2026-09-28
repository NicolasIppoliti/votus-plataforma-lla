"use client";

import { EvidenceState } from "@/components/EvidenceState";
import { Button } from "@/components/ui/button";

interface ReviewErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}

export default function ReviewError({ retry }: ReviewErrorProps) {
  return (
    <main className="review-queue page-shell">
      <header className="review-queue__header">
        <p className="eyebrow">Operaciones · revisión</p>
        <h1>Cola de revisión</h1>
      </header>
      <EvidenceState
        state="error"
        title="No se pudo cargar la revisión"
        titleId="review-error-heading"
        eyebrow="Atención operativa"
        action={<Button variant="solid" type="button" onClick={retry}>Reintentar carga</Button>}
      >
        <p>Revise la conexión y vuelva a intentar la carga.</p>
      </EvidenceState>
    </main>
  );
}
