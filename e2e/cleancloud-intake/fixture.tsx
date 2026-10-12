import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "../../client/src/lib/trpc";
import { CleancloudIntakePanel } from "../../client/src/components/CleancloudIntakePanel";
import "../../client/src/index.css";
Object.assign(window, { React });
function Fixture() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
  );
  const [client] = useState(() =>
    trpc.createClient({
      links: [httpLink({ url: "/api/trpc", transformer: superjson })],
    })
  );
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <main className="mx-auto max-w-lg p-4">
          <CleancloudIntakePanel />
        </main>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
