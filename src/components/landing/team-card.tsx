import { ArrowUpRight, Link2, Mail, type LucideIcon } from "lucide-react";
import Image from "next/image";
import type { ComponentType, SVGProps } from "react";
import { GithubIcon, LinkedinIcon, PortfolioIcon, XIcon } from "@/components/icons/brand-icons";
import { CopyEmailButton } from "./copy-email-button";
import { initials, type LinkKind, type LinkRow, type TeamMember } from "./team";

const ICONS: Record<LinkKind, LucideIcon | ComponentType<SVGProps<SVGSVGElement>>> = {
  linkedin: LinkedinIcon,
  portfolio: PortfolioIcon,
  email: Mail,
  github: GithubIcon,
  x: XIcon,
  other: Link2,
};

/**
 * One way to reach someone: icon, label, the address in mono, and a trailing arrow. On hover the
 * address turns link blue and the arrow nudges 2px. External rows open in a new tab.
 */
export function ContactRow({ row }: { row: LinkRow }) {
  const Icon = ICONS[row.kind];
  const external = row.kind !== "email";
  return (
    <div className="flex items-center gap-2">
      <a
        href={row.href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="group/row -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-sm px-2 py-2 transition-motion hover:bg-surface-hover"
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-muted-foreground">{row.label}</span>
          <span className="truncate font-mono text-body-sm text-foreground transition-motion group-hover/row:text-link">
            {row.value}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-motion motion-safe:group-hover/row:translate-x-0.5"
        />
        {external && <span className="sr-only">(opens in a new tab)</span>}
      </a>
      {row.kind === "email" && <CopyEmailButton email={row.value} />}
    </div>
  );
}

/** A contact card: monogram or photo, name, an optional short bio, then one row per link that is set. */
export function TeamCard({ member, rows }: { member: TeamMember; rows: LinkRow[] }) {
  return (
    <article
      aria-label={member.name}
      className="flex h-full flex-col gap-5 rounded-md border bg-card p-6 transition-motion hover:border-highlight-border"
    >
      <div className="flex items-center gap-4">
        {member.photo ? (
          <Image src={member.photo} alt="" width={48} height={48} className="size-12 shrink-0 rounded-sm object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-sm border bg-muted font-display text-subheading font-semibold text-foreground"
          >
            {initials(member.name)}
          </span>
        )}
        <h3 className="font-display text-heading-sm font-semibold">{member.name}</h3>
      </div>
      {member.bio && <p className="line-clamp-2 text-body-sm text-muted-foreground">{member.bio}</p>}
      <ul className="flex flex-col border-t pt-3">
        {rows.map((row) => (
          <li key={row.kind + row.href}>
            <ContactRow row={row} />
          </li>
        ))}
      </ul>
    </article>
  );
}
