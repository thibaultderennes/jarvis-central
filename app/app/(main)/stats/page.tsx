import { redirect } from "next/navigation";

/** Stats is a tab of Home since 0.7.3; old links (and their ?bucket= / ?proj= filters) land there. */
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ bucket?: string; proj?: string }> }) {
  const sp = await searchParams, q = new URLSearchParams({ tab: "stats" });
  if (sp.bucket) q.set("bucket", sp.bucket);
  if (sp.proj) q.set("proj", sp.proj);
  redirect(`/?${q}`);
}
