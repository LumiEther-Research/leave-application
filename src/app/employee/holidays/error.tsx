"use client";

import { ErrorState } from "@/components/layout/error-state";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState reset={reset} />;
}
