import { z } from "zod";
import { D } from "@/tax-engine";

/*
 * Form fields as server actions receive them: strings, validated before anything is parsed as a decimal.
 */

export const decimal = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number like 12.5.");
export const positive = decimal.refine((v) => new D(v).gt(0), "Enter a number above zero.");
export const isoDate = z.iso.date("Enter a date.");

/** A dollar amount the way people type it ("12,000", "$7,000.50"), or blank for none. Returns a plain decimal string or null. */
export const optionalDollars = z
  .string()
  .trim()
  .transform((v) => v.replace(/[$,\s]/g, ""))
  .refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a dollar amount like 7000 or 7,000.50.")
  .transform((v) => (v === "" ? null : v));

/** A four-digit year, or blank for none. */
export const optionalYear = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= min && Number(v) <= max), message)
    .transform((v) => (v === "" ? null : Number(v)));
