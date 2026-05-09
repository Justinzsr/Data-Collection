import type { Metadata } from "next";
import { LegalPage } from "@/presentation/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Auto Lab IS350 / MoonArq Data Hub",
  description: "Privacy Policy for Auto Lab IS350 and MoonArq Data Hub connected account analytics.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="Auto Lab IS350 / MoonArq Data Hub is a private analytics and data hub used to collect and view data from connected accounts that I authorize."
      sections={[
        {
          title: "Connected services",
          body: "The app may connect to Instagram, TikTok, Vercel, Supabase, and future platform APIs for analytics and reporting inside the Data Hub.",
        },
        {
          title: "Instagram and Meta data",
          body: "When Instagram or Meta access is authorized, the app may collect platform data that is available through official APIs and granted permissions.",
          items: [
            "Instagram account ID and username.",
            "Profile and media metadata.",
            "Public media IDs.",
            "Captions or caption previews when available.",
            "Media URLs or permalinks when available.",
            "Follower and media counts when available.",
            "Insights such as reach, impressions, profile views, likes, comments, and engagement metrics when permission is granted.",
          ],
        },
        {
          title: "What this app does not collect",
          items: [
            "It does not collect Instagram passwords.",
            "It does not collect direct messages.",
            "It does not scrape dashboards.",
          ],
        },
        {
          title: "Credential handling",
          body: "Credentials and tokens are stored encrypted server-side when they are saved in the Data Hub. They are used only to support authorized analytics and reporting workflows.",
        },
        {
          title: "Use and sharing",
          items: [
            "Data is used only for analytics and reporting inside the Data Hub.",
            "Data is not sold.",
            "Data is not shared with advertisers.",
            "Data can be deleted on request or by removing a connected source.",
          ],
        },
        {
          title: "Contact",
          body: "For privacy questions or deletion requests, contact zsrjustin@gmail.com.",
        },
      ]}
    />
  );
}
