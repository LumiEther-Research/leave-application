/** The four employee categories, in the fixed order the current app uses. An admin sets each one's yearly leave days. */
export const CATEGORIES = ["contractor", "employee", "intern", "student"] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryLabel: Record<Category, string> = {
  contractor: "Contractor",
  employee: "Employee",
  intern: "Intern",
  student: "Student",
};
