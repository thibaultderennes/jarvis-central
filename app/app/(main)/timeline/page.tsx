import { redirect } from "next/navigation";

/** The Timeline is a tab of Home since 0.7.3; old links (and ?w=) land there. */
export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  redirect(`/?tab=timeline${w ? `&w=${encodeURIComponent(w)}` : ""}`);
}
