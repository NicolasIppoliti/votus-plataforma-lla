import { RouteLoading } from "@/components/RouteLoading";

export default function Loading() {
  return <RouteLoading title="Cargando resultados municipales" blocks={["map", "table"]} />;
}
