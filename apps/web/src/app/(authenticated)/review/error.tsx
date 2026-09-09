"use client";

interface ReviewErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function ReviewError({ unstable_retry }: ReviewErrorProps) {
  return (
    <main className="review-queue page-shell">
      <header className="review-queue__header">
        <p className="eyebrow">Operaciones · revisión</p>
        <h1>Cola de revisión</h1>
      </header>
      <section className="review-queue__attention review-queue__state" role="alert" aria-labelledby="review-error-heading">
        <p className="eyebrow">Atención operativa</p>
        <h2 id="review-error-heading">No se pudo cargar la revisión</h2>
        <p>Revise la conexión y vuelva a intentar la carga.</p>
        <button className="button button--primary" type="button" onClick={unstable_retry}>Reintentar carga</button>
      </section>
    </main>
  );
}
