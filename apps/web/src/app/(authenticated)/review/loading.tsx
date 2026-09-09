export default function Loading() {
  return (
    <main className="review-queue page-shell">
      <header className="review-queue__header">
        <p className="eyebrow">Operaciones · revisión</p>
        <h1>Cola de revisión</h1>
        <p className="review-queue__lede" role="status">Cargando cola de revisión…</p>
      </header>
      <div className="review-queue__attention" aria-hidden="true">
        <div className="review-queue__placeholder" />
        <div className="review-queue__placeholder" />
        <div className="review-queue__placeholder" />
      </div>
      <div className="review-queue__results" aria-hidden="true">
        <div className="review-queue__placeholder" />
        <div className="review-queue__placeholder review-queue__placeholder--body" />
      </div>
    </main>
  );
}
