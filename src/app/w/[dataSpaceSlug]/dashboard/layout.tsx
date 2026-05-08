import { notFound } from "next/navigation";
import { DashboardShell } from "@/presentation/layout/dashboard-shell";
import { getDataSpaceBySlug, listDataSpaces } from "@/storage/repositories/data-spaces-repository";

export default async function DataSpaceDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dataSpaceSlug: string }>;
}) {
  const { dataSpaceSlug } = await params;
  const [dataSpace, dataSpaces] = await Promise.all([getDataSpaceBySlug(dataSpaceSlug), listDataSpaces()]);
  if (!dataSpace) notFound();
  return (
    <DashboardShell dataSpace={dataSpace} dataSpaces={dataSpaces}>
      {children}
    </DashboardShell>
  );
}
