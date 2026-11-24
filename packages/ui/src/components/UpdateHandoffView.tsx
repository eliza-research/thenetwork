// spec/sitePages.md, "The update handoff accepts only a canonical reference on the hub"
import type { Brand } from "../../../core/src/generated/brandIdentity.ts";
import { Button } from "./Button.tsx";
import { PageShell } from "./PageShell.tsx";

export type UpdateHandoffViewProps = {
  brand: Brand;
  buttons: readonly { href: string; label: string }[];
};

export function UpdateHandoffView({ brand, buttons }: UpdateHandoffViewProps) {
  return (
    <PageShell brand={brand}>
      <div className="flex max-w-sm flex-col gap-6 pt-8">
        <h1 className="text-3xl font-semibold tracking-tight">Open your update</h1>
        <div className="grid gap-3">
          {buttons.map(({ href, label }) => (
            <Button key={label} asChild size="lg" variant="outline" className="h-12 justify-start">
              <a href={href} rel="noreferrer">{label}</a>
            </Button>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
