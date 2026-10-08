/** Where a team member can be reached. Only the fields that are set render, in the order of `LINK_ORDER`. */
export interface TeamLinks {
  linkedin?: string;
  portfolio?: string;
  email?: string;
  github?: string;
  x?: string;
  other?: { label: string; url: string };
}

export interface TeamMember {
  name: string;
  /** A square image path under /public; without one the card shows a monogram. */
  photo?: string;
  /** One or two lines at most. */
  bio?: string;
  links: TeamLinks;
}

export const REPO_URL = "https://github.com/TonyDeDev/tax-back";
export const REPO_PATH = "TonyDeDev/tax-back";

/** The Contact section. Adding a person or a link is a one-line change. */
export const team: TeamMember[] = [
  {
    name: "Tony Pham",
    links: {
      linkedin: "https://www.linkedin.com/in/tonypham06",
      portfolio: "https://tonypm.com/",
      github: "https://github.com/TonyDeDev",
    },
  },
  {
    name: "Phuntsho Wangyal",
    links: {
      linkedin: "https://www.linkedin.com/in/phuntsho-wangyal",
      portfolio: "https://phuntshowangyal.github.io/Personal-Portfolio/",
      github: "https://github.com/phuntshoWangyal",
    },
  },
  {
    name: "Michael Toner",
    links: {
      linkedin: "https://www.linkedin.com/in/michael-toner-data-driven-process-improvement/",
    },
  },
];

export type LinkKind = "linkedin" | "portfolio" | "email" | "github" | "x" | "other";

export interface LinkRow {
  kind: LinkKind;
  label: string;
  href: string;
  /** What the row shows: the address without its scheme, `www.` or trailing slash. */
  value: string;
}

const LINK_ORDER = ["linkedin", "portfolio", "email", "github", "x"] as const;

const LABELS: Record<LinkKind, string> = {
  linkedin: "LinkedIn",
  portfolio: "Portfolio",
  email: "Email",
  github: "GitHub",
  x: "X",
  other: "Link",
};

/** "https://www.linkedin.com/in/tonypham06/" becomes "linkedin.com/in/tonypham06". */
export function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/** The rows a card shows: present, non-blank fields only, in a fixed order, so nothing leaves a gap. */
export function linkRows(links: TeamLinks): LinkRow[] {
  const rows: LinkRow[] = [];
  for (const kind of LINK_ORDER) {
    const raw = links[kind]?.trim();
    if (!raw) continue;
    rows.push(
      kind === "email"
        ? { kind, label: LABELS.email, href: `mailto:${raw}`, value: raw }
        : { kind, label: LABELS[kind], href: raw, value: displayUrl(raw) },
    );
  }
  const other = links.other;
  if (other?.url.trim()) {
    rows.push({ kind: "other", label: other.label.trim() || LABELS.other, href: other.url.trim(), value: displayUrl(other.url.trim()) });
  }
  return rows;
}

/** "Phuntsho Wangyal" becomes "PW". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}
