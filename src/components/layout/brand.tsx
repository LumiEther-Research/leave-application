import Image from "next/image";
import { cn } from "@/lib/utils";

// public/lumiether-logo.png: transparent background, navy lettering.
const LOGO = { src: "/lumiether-logo.png", width: 960, height: 251 };

/**
 * The LumiEther Research logo. In dark mode it sits on a light plate (the
 * foreground token) because the navy lettering would vanish on a dark canvas.
 */
export function Brand({ height = 40, className }: { height?: number; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-md dark:bg-foreground dark:px-2 dark:py-1", className)}>
      <Image
        src={LOGO.src}
        alt="LumiEther Research"
        width={Math.round((height * LOGO.width) / LOGO.height)}
        height={height}
        priority
      />
    </div>
  );
}
