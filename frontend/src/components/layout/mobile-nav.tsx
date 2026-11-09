import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import type { Role } from "./nav-config";

/** The drawer is controlled so it closes when you pick a page: unlike a page-per-request app, the shell stays mounted. */
export function MobileNav({ role, active }: { role: Role; active: string }) {
  const [open, setOpen] = useState(false);
  // Close when the page changes. Adjusting state while rendering (React's documented alternative to an effect) avoids a second render pass.
  const [shownFor, setShownFor] = useState(active);
  if (shownFor !== active) {
    setShownFor(active);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" />}>
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 sm:max-w-72">
        <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
          <Brand />
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-6">
          <SidebarNav role={role} active={active} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
