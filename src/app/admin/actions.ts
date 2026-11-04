"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { resolveRequest } from "@/lib/store";

export async function decideRequest(id: string, decision: "approved" | "rejected") {
  await requireRole("admin");
  if (decision !== "approved" && decision !== "rejected") return { ok: false as const };
  const updated = await resolveRequest(id, decision);
  if (!updated) return { ok: false as const };
  revalidatePath("/admin");
  return { ok: true as const };
}
