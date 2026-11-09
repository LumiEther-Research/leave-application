import { useEffect } from "react";

/** "Admins · Leave Management", the same tab title the current app sets from each page's metadata. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Leave Management` : "Leave Management";
  }, [title]);
}
