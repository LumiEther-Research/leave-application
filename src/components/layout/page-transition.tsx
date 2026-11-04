/** Fade and slight rise on mount. Pages remount on navigation, so it plays once per page. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
