/**
 * Full-page loading screen: a stick figure running on a ground line.
 * Pure SVG + CSS (the `.runner` rules at the end of globals.css), so no file and no JS.
 * Colors are the background and foreground tokens, so it follows both themes.
 */
export function RunnerLoader() {
  return (
    <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <svg viewBox="0 0 120 80" width="160" height="107" aria-hidden="true" className="runner">
        <line x1="8" y1="70" x2="112" y2="70" />
        <line className="d" x1="8" y1="76" x2="112" y2="76" />
        <g className="o">
          <g transform="translate(60 42)">
            <path d="M0 0 3-16" />
            <circle cx="6" cy="-23" r="6" />
            <g className="t">
              <path d="M0 0v14" />
              <g transform="translate(0 14)">
                <g className="k">
                  <path d="M0 0v14" />
                </g>
              </g>
            </g>
            <g className="t b">
              <path d="M0 0v14" />
              <g transform="translate(0 14)">
                <g className="k">
                  <path d="M0 0v14" />
                </g>
              </g>
            </g>
            <g transform="translate(2 -13)">
              <g className="a b">
                <path d="M0 0v9" />
                <path d="M0 9 8 6" />
              </g>
              <g className="a">
                <path d="M0 0v9" />
                <path d="M0 9 8 6" />
              </g>
            </g>
          </g>
        </g>
      </svg>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
