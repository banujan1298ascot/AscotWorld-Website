"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import { Field, Input, Select } from "@/components/ui";
import { useProductSuggestions, type ProductSuggestion } from "@/lib/batchBook";
import {
  DOSAGE_FORMS,
  composeProductName,
  dosageFormInfo,
  formatPack,
  parseProductName,
  type DosageForm,
  type PackUnit,
} from "@/lib/products";

/**
 * The product part of a Batch Book entry: name (with suggestions from
 * products made before), strength, type, and a pack size or volume that
 * follows the type — a count for tablets and capsules, a volume for liquids
 * and creams. The full name the rest of the portal shows is built from these
 * (src/lib/products.ts) and previewed underneath.
 */

export interface ProductFieldValues {
  medicineName: string;
  strength: string;
  dosageForm: DosageForm | "";
  packSize: string;
  packUnit: PackUnit | "";
}

export const EMPTY_PRODUCT: ProductFieldValues = {
  medicineName: "",
  strength: "",
  dosageForm: "",
  packSize: "",
  packUnit: "",
};

/** How long typing pauses before suggestions are looked up. */
const SUGGEST_DELAY_MS = 150;

export function ProductFields({
  idPrefix,
  values,
  onChange,
  onPickSuggestion,
}: {
  idPrefix: string;
  values: ProductFieldValues;
  onChange: (values: ProductFieldValues) => void;
  /** After a suggestion fills the fields in — the form uses it to fill in
   *  the batch quantity's unit too, when that's still empty. */
  onPickSuggestion?: (suggestion: ProductSuggestion) => void;
}) {
  const form = dosageFormInfo(values.dosageForm || null);
  const preview = composeProductName({
    medicineName: values.medicineName,
    strength: values.strength,
    dosageForm: values.dosageForm || null,
  });

  function setForm(next: DosageForm | "") {
    const info = dosageFormInfo(next || null);
    // Keep the unit if it still suits the new type; otherwise take the
    // type's usual one (tablets for Tablets, ml for a Solution, ...).
    const unit =
      info && values.packUnit && info.packUnits.includes(values.packUnit) ? values.packUnit : (info?.packUnits[0] ?? "");
    onChange({ ...values, dosageForm: next, packUnit: unit });
  }

  function pick(s: ProductSuggestion) {
    const info = dosageFormInfo(s.dosageForm);
    onChange({
      medicineName: s.medicineName,
      strength: s.strength ?? "",
      dosageForm: s.dosageForm ?? "",
      packSize: s.packSize ? String(Number(s.packSize)) : "",
      packUnit: s.packUnit ?? info?.packUnits[0] ?? "",
    });
    onPickSuggestion?.(s);
  }

  return (
    <div className="grid gap-3.5">
      <Field label="Product" htmlFor={`${idPrefix}-medicine`} required>
        <ProductNameCombobox
          id={`${idPrefix}-medicine`}
          value={values.medicineName}
          onChange={(medicineName) => onChange({ ...values, medicineName })}
          onPick={pick}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Strength" htmlFor={`${idPrefix}-strength`}>
          <Input
            id={`${idPrefix}-strength`}
            placeholder="e.g. 500mg, 2mg/ml, 1%"
            autoComplete="off"
            value={values.strength}
            onChange={(e) => onChange({ ...values, strength: e.target.value })}
          />
        </Field>
        <Field label="Type" htmlFor={`${idPrefix}-type`} required>
          <Select
            id={`${idPrefix}-type`}
            value={values.dosageForm}
            onChange={(e) => setForm(e.target.value as DosageForm | "")}
          >
            <option value="" disabled>
              Choose type…
            </option>
            {DOSAGE_FORMS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label={form?.packLabel ?? "Pack size"}
        htmlFor={`${idPrefix}-pack`}
        helper={
          !form
            ? "Choose a type first — tablets and capsules take a pack size, liquids and creams a volume."
            : form.packLabel === "Volume"
              ? "How much is in each pack."
              : `How many ${form.packUnits[0]} are in each pack.`
        }
      >
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-pack`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={form?.packLabel === "Volume" ? "e.g. 100" : "e.g. 28"}
            disabled={!form}
            value={values.packSize}
            onChange={(e) => onChange({ ...values, packSize: e.target.value.replace(/[^\d.]/g, "") })}
            className="min-w-0 flex-1"
          />
          {form && form.packUnits.length > 1 ? (
            <Select
              aria-label="Pack unit"
              value={values.packUnit}
              onChange={(e) => onChange({ ...values, packUnit: e.target.value as PackUnit })}
              className="w-28 shrink-0"
            >
              {form.packUnits.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          ) : (
            <span className="flex h-11 shrink-0 items-center rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] px-3 text-sm font-semibold text-[var(--muted-foreground)]">
              {form?.packUnits[0] ?? "—"}
            </span>
          )}
        </div>
      </Field>

      {preview ? (
        <p className="-mt-1 text-xs text-[var(--muted-foreground)]">
          Recorded as <strong className="text-foreground">{preview}</strong>
          {formatPack(values.packSize, values.packUnit || null) ? ` · ${formatPack(values.packSize, values.packUnit || null)} per pack` : ""}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The product name input, offering products made before as you type —
 * arrow keys and Enter to pick, Escape to dismiss, or just keep typing a new
 * one. Picking fills in the strength, type and pack size it was last made
 * with.
 */
function ProductNameCombobox({
  id,
  value,
  onChange,
  onPick,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (suggestion: ProductSuggestion) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { suggestions } = useProductSuggestions(open ? query : "");

  // Looked up once typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value), SUGGEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  const showing = open && value.trim().length > 0 && suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

  function choose(s: ProductSuggestion) {
    onPick(s);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder="Start typing — e.g. Paracetamol"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showing ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Products made before"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface)] py-1 shadow-[var(--shadow-overlay)]"
        >
          <li className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--subtle-foreground)]">
            Made before
          </li>
          {suggestions.map((s, i) => {
            const pack = formatPack(s.packSize, s.packUnit);
            return (
              <li
                key={s.productName}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // mousedown, not click: it lands before the input's blur
                // closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${
                  i === activeIndex ? "bg-[var(--surface-sunken)]" : ""
                }`}
              >
                <ClockCounterClockwise size={15} weight="bold" className="shrink-0 text-[var(--subtle-foreground)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">{s.productName}</span>
                  <span className="block truncate text-xs text-[var(--muted-foreground)]">
                    {[pack ? `${pack} per pack` : null, `${s.batches} batch${s.batches === 1 ? "" : "es"} made`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** The fields for a batch that already has a record — its own structured
 *  fields, or for one entered before they existed, split from its full name. */
export function productValuesFrom(batch: {
  productName: string | null;
  medicineName: string | null;
  strength: string | null;
  dosageForm: DosageForm | null;
  packSize: string | null;
  packUnit: PackUnit | null;
}): ProductFieldValues {
  if (batch.medicineName) {
    return {
      medicineName: batch.medicineName,
      strength: batch.strength ?? "",
      dosageForm: batch.dosageForm ?? "",
      packSize: batch.packSize ? String(Number(batch.packSize)) : "",
      packUnit: batch.packUnit ?? dosageFormInfo(batch.dosageForm)?.packUnits[0] ?? "",
    };
  }
  if (!batch.productName) return EMPTY_PRODUCT;
  const parsed = parseProductName(batch.productName);
  return {
    ...EMPTY_PRODUCT,
    medicineName: parsed.medicineName,
    strength: parsed.strength ?? "",
    dosageForm: parsed.dosageForm ?? "",
    packUnit: dosageFormInfo(parsed.dosageForm)?.packUnits[0] ?? "",
  };
}

/** The product part of a create/edit request, from the form's fields. */
export function productPatch(values: ProductFieldValues) {
  return {
    medicineName: values.medicineName.trim(),
    strength: values.strength.trim() || null,
    dosageForm: values.dosageForm || null,
    packSize: values.packSize.trim() || null,
    packUnit: values.packSize.trim() ? values.packUnit || null : null,
  };
}
