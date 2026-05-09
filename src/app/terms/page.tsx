import type { Metadata } from "next";
import { LegalPage } from "@/presentation/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | Auto Lab IS350 / MoonArq Data Hub",
  description: "Terms of Service for the private Auto Lab IS350 and MoonArq Data Hub analytics dashboard.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      description="Auto Lab IS350 / MoonArq Data Hub is a private and internal analytics dashboard for connected accounts and platform data."
      sections={[
        {
          title: "Authorized use",
          body: "You are responsible for connecting only accounts that you own or are authorized to access.",
        },
        {
          title: "Collection methods",
          body: "The app uses official APIs, OAuth, webhooks, first-party tracking, and other approved platform paths where available. Scraping social dashboards is not intended.",
        },
        {
          title: "Availability",
          body: "The app may be unavailable, and connected platform APIs may change, fail, or restrict available data at any time.",
        },
        {
          title: "Analytics only",
          body: "Data shown in the Data Hub is provided for informational and analytics purposes. It should be reviewed before making business, advertising, or account decisions.",
        },
        {
          title: "No warranty",
          body: "The app is provided without warranty. It may contain errors, missing data, delays, or incomplete platform coverage.",
        },
        {
          title: "Contact",
          body: "For questions about these terms, contact zsrjustin@gmail.com.",
        },
      ]}
    />
  );
}
