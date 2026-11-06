import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The payslip template and logo are read from disk at request time, so Vercel must ship them.
  outputFileTracingIncludes: {
    "/admin/payslips": ["./src/lib/payslip/template.html", "./public/lumiether-logo.png"],
    "/api/cron/payslips": ["./src/lib/payslip/template.html", "./public/lumiether-logo.png"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
