import { ArrowUpRight } from "lucide-react";
import { GithubIcon } from "@/components/icons/brand-icons";
import { buttonArrowClass, buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { REPO_URL } from "./team";

/**
 * The code is public: a Graphite card with the repo and an outline link to it. Outline, not filled,
 * because the hero already has the page's one primary button. Hover lifts the border to Moss.
 */
export function OpenSourceSection() {
  return (
    <div className="group/card flex flex-col items-start gap-5 rounded-md border bg-card p-6 transition-motion hover:border-highlight-border md:p-8">
      <Tag>Open source</Tag>
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 id="open-source" className="font-display text-heading-sm font-medium md:text-heading">
          Open source, built in public.
        </h2>
        <p className="text-body text-muted-foreground">
          The code is public: read exactly how every tax number is calculated, report an issue, or contribute.
        </p>
      </div>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        <GithubIcon aria-hidden className="size-4 shrink-0" />
        View on GitHub
        <ArrowUpRight aria-hidden className={cn(buttonArrowClass, "motion-safe:group-hover/card:translate-x-0.5")} />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}
