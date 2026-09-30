import Link from "next/link";

type LegalSection = {
  title?: string;
  body?: string;
  items?: string[];
};

type LegalPageProps = {
  title: string;
  description: string;
  sections: LegalSection[];
};

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-deletion", label: "Data Deletion" },
];

export function LegalPage({ title, description, sections }: LegalPageProps) {
  return (
    <main className="relative isolate min-h-screen px-4 py-10 text-label sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="glass rounded-[28px] p-6 sm:p-8">
          <p className="eyebrow">Auto Lab IS350 / MoonArq Data Hub</p>
          <h1 className="mt-3 text-[32px] font-bold leading-tight tracking-[-0.03em] text-label sm:text-[40px]">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-label-secondary">{description}</p>
          <p className="mt-5 text-sm text-muted">Last updated: May 2026</p>
        </header>

        <section className="glass rounded-[28px] p-6 sm:p-8">
          <div className="grid gap-8">
            {sections.map((section) => (
              <article key={`${section.title ?? section.body}`} className="grid gap-3">
                {section.title ? <h2 className="text-[20px] font-semibold tracking-[-0.022em] text-label">{section.title}</h2> : null}
                {section.body ? <p className="text-base leading-7 text-label-secondary">{section.body}</p> : null}
                {section.items ? (
                  <ul className="grid gap-2 text-base leading-7 text-label-secondary">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-tint" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-col gap-4 px-2 text-sm text-label-secondary sm:flex-row sm:items-center sm:justify-between">
          <p>Contact: <a className="font-medium text-tint-text underline-offset-4 hover:underline" href="mailto:zsrjustin@gmail.com">zsrjustin@gmail.com</a></p>
          <nav aria-label="Legal pages" className="flex flex-wrap gap-4">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="font-medium text-label-secondary underline-offset-4 hover:text-label hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        </footer>
      </div>
    </main>
  );
}
