import { redirect } from "next/navigation";

export default function LegacyHealthPage() {
  redirect("/w/moonarq/dashboard/health");
}
