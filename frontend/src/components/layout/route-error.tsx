import { useRevalidator } from "react-router-dom";
import { ErrorState } from "./error-state";

/** errorElement for a page: the shell stays, the page shows the alert, Retry runs the loaders again. */
export function PageError() {
  const { revalidate } = useRevalidator();
  return <ErrorState reset={revalidate} />;
}

/** errorElement for the whole shell, when even the session check failed (server down, no network). */
export function ShellError() {
  const { revalidate } = useRevalidator();
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-16">
      <ErrorState reset={revalidate} message="We couldn't reach the server. Check your connection and try again." />
    </main>
  );
}
