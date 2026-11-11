import { requireSession } from "@/lib/auth";
import MapView from "@/components/MapView";

/** The map on its own page, at full width, with the time slider. The same map is also a box you can add to Home. */
export default async function MapPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
  await requireSession();
  const { at } = await searchParams;
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">Map</h1>
          <p className="sub">Your projects as settlements on one map. Click one to see what it needs; every building opens one part of the project.</p>
        </div>
      </div>
      <MapView full at={at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : null} />
    </>
  );
}
