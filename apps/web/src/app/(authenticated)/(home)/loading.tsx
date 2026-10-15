import { RouteLoading } from "@/components/RouteLoading";

export default function Loading() {
  return <RouteLoading title="Cargando panorama" blocks={["map", "table"]} />;
}
