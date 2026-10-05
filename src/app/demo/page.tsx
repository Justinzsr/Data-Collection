import type { Metadata } from "next";
import { PublicPreview } from "@/presentation/public-preview/public-preview";

export const metadata: Metadata = {
  title: "DataHub — Interactive demo",
  description: "Explore a sample DataHub workspace: commerce, acquisition, and source health in one business dashboard. All demo data is fictional.",
};

export default function DemoPage() {
  return <PublicPreview />;
}
