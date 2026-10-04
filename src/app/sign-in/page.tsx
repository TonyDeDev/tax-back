import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in" };

export default function SignIn() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Brand className="justify-center" />
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Connect your brokerages and keep your own tax picture.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button variant="outline" disabled>
            Continue with GitHub
          </Button>
          <Button variant="outline" disabled>
            Continue with Google
          </Button>
          <p className="text-caption text-muted-foreground">Sign-in arrives with the auth phase.</p>
          <div className="border-t pt-3">
            <Link href="/hub" className={buttonVariants({ className: "w-full" })}>
              Try the demo instead
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
