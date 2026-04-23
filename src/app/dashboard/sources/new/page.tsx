import { SectionHeader } from "@/presentation/components/ui/panel";
import { AddSourceWizard } from "@/presentation/source-onboarding/add-source-wizard";

export default function NewSourcePage() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Source onboarding"
        title="Add Source"
        description="Paste a link, detect the platform, choose sync mode, understand credentials/setup, save the source, then run an initial sync or continue in demo mode."
      />
      <AddSourceWizard />
    </div>
  );
}
