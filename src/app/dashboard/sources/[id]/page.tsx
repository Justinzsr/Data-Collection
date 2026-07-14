import { redirect } from "next/navigation";

export default async function LegacySourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/w/moonarq/dashboard/sources/${encodeURIComponent(id)}`);
}
