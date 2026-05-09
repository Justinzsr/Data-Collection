import type { Metadata } from "next";
import { LegalPage } from "@/presentation/legal/legal-page";

export const metadata: Metadata = {
  title: "User Data Deletion Instructions | Auto Lab IS350 / MoonArq Data Hub",
  description: "Instructions for requesting deletion of connected-account data from Auto Lab IS350 and MoonArq Data Hub.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="User Data Deletion Instructions"
      description="You can request deletion of connected-account data stored by Auto Lab IS350 / MoonArq Data Hub."
      sections={[
        {
          title: "How to request deletion",
          items: [
            "Remove or delete the source inside the Data Hub, if that option is available.",
            "Revoke app access from the relevant platform, such as Meta, Instagram, or TikTok.",
            "Email zsrjustin@gmail.com with the subject: Data deletion request - Auto Lab IS350.",
          ],
        },
        {
          title: "What will be deleted",
          items: [
            "Connected source records.",
            "Encrypted tokens and credentials.",
            "Platform metrics.",
            "Raw ingestions.",
            "Generated reports related to that source where practical.",
            "Connector events and sync logs related to that source where practical.",
          ],
        },
        {
          title: "Timing",
          body: "Deletion requests will be handled within a reasonable period, typically within 30 days.",
        },
        {
          title: "Temporary logs",
          body: "Some minimal logs may be retained temporarily for security, debugging, or operational integrity when required.",
        },
        {
          title: "Safety",
          body: "No passwords are stored. Do not send passwords, platform secrets, or other sensitive credentials by email.",
        },
      ]}
    />
  );
}
