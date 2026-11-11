import { requireSession } from "@/lib/auth";
import MapView from "@/components/MapView";

/** The map on its own page, at full width. The same view is also a box you can add to Home. */
export default async function MapPage() {
  await requireSession();
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">Map</h1>
          <p className="sub">Your projects as villages in one world. Each building opens one part of a project.</p>
        </div>
      </div>
      <MapView />
    </>
  );
}
