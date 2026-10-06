import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoButton } from "@/components/auth/demo-button";
import { ProviderSignIn } from "@/components/auth/provider-sign-in";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/safe-redirect";
import { configuredProviders } from "@/server/auth/config";
import { getCurrentUser } from "@/server/auth/session";
import { SNAPTRADE_DASHBOARD_URL } from "@/server/auth/snaptrade-provider";
import { getEnv } from "@/server/env";

export const metadata: Metadata = { title: "Sign in" };

/** Better Auth sends `?error=<code>` back here when a sign-in fails. */
function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "access_denied") return "SnapTrade access was not granted, so you were not signed in.";
  if (code === "email_reserved") return "That email cannot be used to sign in.";
  if (code === "account_not_linked") {
    return "That email already has a TaxBack account. Sign in the way you did before, then connect SnapTrade in Settings.";
  }
  return "Sign-in did not complete. Try again.";
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignIn(props: PageProps<"/sign-in">) {
  const params = await props.searchParams;
  const next = safeNext(first(params.next));

  // A real check, not the cookie: a stale cookie must not bounce between here and the Hub.
  const user = await getCurrentUser();
  if (user && !user.isDemo) redirect(next);

  const error = errorMessage(first(params.error));

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Brand className="justify-center" />
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            TaxBack reads your brokerages through SnapTrade.{" "}
            <a href={SNAPTRADE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
              SnapTrade accounts are free
            </a>
            , and you can connect one after signing in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-body-sm text-destructive">
              {error}
            </p>
          )}
          <ProviderSignIn enabled={configuredProviders(getEnv())} callbackURL={next} />
          <div className="border-t pt-3">
            <DemoButton>Try the demo instead</DemoButton>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
