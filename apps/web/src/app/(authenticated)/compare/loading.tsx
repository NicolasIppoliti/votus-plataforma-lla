import { RouteLoading } from "@/components/RouteLoading";

export default function Loading() {
  return <RouteLoading title="Cargando comparación" blocks={["filters", "map", "table"]} />;
}
