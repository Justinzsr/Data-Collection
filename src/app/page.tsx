import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicPreview } from "@/presentation/public-preview/public-preview";
import { hasDashboardSession } from "@/storage/auth/dashboard-access";
import { DEFAULT_DASHBOARD_PATH } from "@/storage/auth/dashboard-session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "DataHub · Business analytics demo",
  description: "Explore a sample business command center. Sign in to access private connected workspaces.",
};

export default async function Home() {
  if (await hasDashboardSession()) redirect(DEFAULT_DASHBOARD_PATH);
  return <PublicPreview />;
}
