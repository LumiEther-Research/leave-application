import { parseISO, toISODate } from "./dates";
import { CATEGORIES, type Category } from "./types";

/** Employees sign in with a Gmail address. */
const GMAIL = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@gmail\.com$/;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
const EARLIEST_JOINING_DATE = "2000-01-01";

export type NewEmployeeInput = { email: string; joiningDate: string; password: string; category: string };
export type NewEmployeeErrors = Partial<Record<keyof NewEmployeeInput, string>>;

/** "priya.sharma@gmail.com" becomes "Priya Sharma". The form has no name field. */
export function nameFromEmail(email: string): string {
  const words = email
    .split("@")[0]
    .replace(/\d+/g, " ")
    .split(/[._+-]+|\s+/)
    .filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : email;
}

export function validateNewEmployee(
  input: NewEmployeeInput,
  taken: { emails: string[] },
):
  | { ok: true; value: Omit<NewEmployeeInput, "category"> & { category: Category } }
  | { ok: false; errors: NewEmployeeErrors } {
  const errors: NewEmployeeErrors = {};
  const email = input.email.trim().toLowerCase();
  const category = CATEGORIES.find((c) => c === input.category);
  if (!category) errors.category = "Choose a category.";
  const joiningDate = input.joiningDate.trim();

  if (!GMAIL.test(email)) errors.email = "Enter a Gmail address, like name@gmail.com.";
  else if (taken.emails.map((e) => e.toLowerCase()).includes(email)) errors.email = "Someone already uses this email.";

  const real = /^\d{4}-\d{2}-\d{2}$/.test(joiningDate) && toISODate(parseISO(joiningDate)) === joiningDate;
  if (!real) errors.joiningDate = "Pick a joining date.";
  else if (joiningDate < EARLIEST_JOINING_DATE) errors.joiningDate = "That joining date is too far back.";

  if (input.password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (input.password.length > MAX_PASSWORD_LENGTH)
    errors.password = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;

  if (Object.keys(errors).length || !category) return { ok: false, errors };
  return { ok: true, value: { email, joiningDate, password: input.password, category } };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewAdminInput = { email: string; password: string };
export type NewAdminErrors = Partial<Record<keyof NewAdminInput, string>>;

/** Admins can use any email address, not just Gmail. */
export function validateNewAdmin(
  input: NewAdminInput,
  taken: { emails: string[] },
): { ok: true; value: NewAdminInput } | { ok: false; errors: NewAdminErrors } {
  const errors: NewAdminErrors = {};
  const email = input.email.trim().toLowerCase();

  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  else if (taken.emails.map((e) => e.toLowerCase()).includes(email)) errors.email = "Someone already uses this email.";

  if (input.password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (input.password.length > MAX_PASSWORD_LENGTH)
    errors.password = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email, password: input.password } };
}
