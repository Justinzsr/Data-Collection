import { redirect } from "next/navigation";

export default function LegacyNewSourcePage() {
  redirect("/w/moonarq/dashboard/sources/new");
}
