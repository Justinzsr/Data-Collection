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
    <main className="relative isolate min-h-screen overflow-hidden px-5 py-10 text-slate-100 sm:px-8 lg:px-10">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 opacity-80" />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="rounded-lg border border-slate-700/60 bg-slate-950/60 p-6 shadow-2xl shadow-cyan-950/20 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-200">Auto Lab IS350 / MoonArq Data Hub</p>
          <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">{description}</p>
          <p className="mt-5 text-sm text-slate-400">Last updated: May 2026</p>
        </header>

        <section className="rounded-lg border border-slate-700/60 bg-slate-950/72 p-6 sm:p-8">
          <div className="grid gap-7">
            {sections.map((section) => (
              <article key={`${section.title ?? section.body}`} className="grid gap-3">
                {section.title ? <h2 className="text-xl font-semibold text-white">{section.title}</h2> : null}
                {section.body ? <p className="text-base leading-7 text-slate-300">{section.body}</p> : null}
                {section.items ? (
                  <ul className="grid gap-2 text-base leading-7 text-slate-300">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-col gap-4 border-t border-slate-800 pt-6 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>Contact: <a className="text-cyan-200 underline-offset-4 hover:underline" href="mailto:zsrjustin@gmail.com">zsrjustin@gmail.com</a></p>
          <nav aria-label="Legal pages" className="flex flex-wrap gap-4">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-slate-300 underline-offset-4 hover:text-white hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        </footer>
      </div>
    </main>
  );
}
