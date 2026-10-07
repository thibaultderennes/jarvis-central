import { redirect } from "next/navigation";

/** The map is a box on Home since 0.7.4.6. */
export default function MapPage() {
  redirect("/#box-map");
}
