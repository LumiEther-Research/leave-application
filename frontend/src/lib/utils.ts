import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets a later Tailwind class win over an earlier conflicting one (so a `className` passed to a component overrides its defaults). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
