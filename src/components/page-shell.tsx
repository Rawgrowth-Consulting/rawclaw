import type { ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";

type PageShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, description, actions, children }: PageShellProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <h1 className="text-sm font-medium text-foreground">{title}</h1>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <h2 className="font-serif text-3xl font-normal tracking-tight text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
