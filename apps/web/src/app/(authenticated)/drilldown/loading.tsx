import { RouteLoading } from "@/components/RouteLoading";

export default function Loading() {
  return <RouteLoading title="Cargando exploración territorial" blocks={["filters", "map", "table"]} />;
}
