import { useLocation } from "react-router-dom";

/** Fade and slight rise on mount. The shell stays mounted between pages, so it is keyed by the path to play once per page. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="animate-page-in">
      {children}
    </div>
  );
}
