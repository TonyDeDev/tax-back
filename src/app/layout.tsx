import type { Metadata } from "next";
import { headers } from "next/headers";
import { Red_Hat_Display, Red_Hat_Mono, Red_Hat_Text } from "next/font/google";
import { DemoBadge } from "@/components/demo-badge";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const display = Red_Hat_Display({ variable: "--font-red-hat-display", subsets: ["latin"] });
const text = Red_Hat_Text({ variable: "--font-red-hat-text", subsets: ["latin"] });
const mono = Red_Hat_Mono({ variable: "--font-red-hat-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "TaxBack", template: "%s | TaxBack" },
  description: "See your Canadian brokerage accounts and tax insight in one place. Concept demo, not tax advice.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by `src/proxy.ts`; next-themes injects an inline script that the CSP only runs with this nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${text.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <DemoBadge />
          <div className="flex flex-1 flex-col">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
