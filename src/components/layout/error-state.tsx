"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ErrorState({ reset, message }: { reset: () => void; message?: string }) {
  return (
    <Alert variant="destructive" className="max-w-xl">
      <AlertCircle aria-hidden />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{message ?? "We couldn't load this page. Please try again."}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCw aria-hidden />
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
