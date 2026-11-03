"use client";

/**
 * The Formulas tab of the Worksheets page: each product's formula, as data —
 * what's in it and how each amount scales with the batch — so a batch's
 * generated worksheet can have its Quantity Required column and calculation
 * filled in (src/lib/formulaRules.ts). Each has an overage table: how much
 * extra to make for each pack size and number of packs. Everyone can read
 * them and try one out; the people with worksheet access add and change
 * them. A change is saved as a new version.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Calculator, Flask, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react/dist/ssr";
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Modal, Select, Skeleton, Textarea } from "@/components/ui";
import {
  DEFAULT_DECIMALS,
  FORMULA_BASES,
  FORMULA_UNITS,
  basisLabel,
  calculateBatch,
  checkFormula,
  defaultBaseUnit,
  packRange,
  parseDoseStrength,
  plain,
  quantityText,
  type BaseUnit,
  type FormulaBasis,
  type FormulaDefinition,
  type FormulaUnit,
  type OverageRule,
} from "@/lib/formulaRules";
import { saveFormula, withdrawFormula, type Formula } from "@/lib/formulas";
import { DOSAGE_FORMS, dosageFormInfo, type DosageForm } from "@/lib/products";

/** "8 ml per 100 ml", "5 mg per 5 ml", "the batch's strength", "made up to volume". */
function amountLabel(i: Formula["ingredients"][number], unit: BaseUnit): string {
  switch (i.basis) {
    case "PER_100ML":
      return `${i.amount} ${i.amountUnit} per 100 ${unit}`;
    case "PER_DOSE":
      return i.amount === null ? "the batch's strength" : `${i.amount} ${i.amountUnit} per ${i.doseVolumeMl} ${unit}`;
    case "FIXED":
      return `${i.amount} ${i.amountUnit}`;
    case "TO_VOLUME":
      return unit === "g" ? "made up to weight" : "made up to volume";
  }
}

const packSizeLabel = (rule: OverageRule, unit: BaseUnit) =>
  rule.packSize === null ? "Any pack size" : `${plain(rule.packSize)} ${unit}`;

function productTitle(f: Pick<Formula, "medicineName" | "dosageForm" | "strength">): string {
  return [f.medicineName, f.strength, dosageFormInfo(f.dosageForm)?.label].filter(Boolean).join(" ");
}

export function FormulasPanel({
  staffId,
  formulas,
  canManage,
  ready,
  search,
  onChanged,
}: {
  staffId: string;
  formulas: Formula[];
  canManage: boolean;
  ready: boolean;
  search: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Formula | "new" | null>(null);
  const [withdrawing, setWithdrawing] = useState<Formula | null>(null);

  const query = search.trim().toLowerCase();
  const shown = formulas.filter(
    (f) =>
      !query ||
      [productTitle(f), ...f.ingredients.map((i) => i.name)].some((text) => text.toLowerCase().includes(query)),
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--muted-foreground)]">
          How each solution, suspension, cream and ointment&apos;s ingredients scale with the batch. When a batch is
          confirmed, its generated worksheet gets each Quantity Required and the working filled in from here — the
          total made is packs × pack size + the overage set in the formula&apos;s table for that pack size and number
          of packs.
        </p>
        {canManage ? (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus size={15} weight="bold" />
            New formula
          </Button>
        ) : null}
      </div>

      {!ready ? (
        <Skeleton className="h-48 w-full" />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            title={query ? "No formulas match that search" : "No formulas yet"}
            description={
              query
                ? "Try the product or an ingredient's name."
                : canManage
                  ? "Add a product's formula and its batches' worksheets get their quantities worked out."
                  : "Once formulas are added they'll appear here."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {shown.map((formula) => (
            <FormulaCard
              key={formula.id}
              formula={formula}
              canManage={canManage}
              onEdit={() => setEditing(formula)}
              onWithdraw={() => setWithdrawing(formula)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <FormulaEditor
          staffId={staffId}
          formula={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}

      {withdrawing ? (
        <WithdrawModal
          staffId={staffId}
          formula={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function FormulaCard({
  formula,
  canManage,
  onEdit,
  onWithdraw,
}: {
  formula: Formula;
  canManage: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
}) {
  const [trying, setTrying] = useState(false);
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-bold text-foreground">
            <Flask size={17} weight="duotone" className="shrink-0 text-[var(--primary)]" />
            {productTitle(formula)}
            {!formula.strength ? (
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">every strength</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Version {formula.version} · {formula.createdByName} · {format(new Date(formula.createdAt), "d MMM yyyy")} ·
            made by {formula.baseUnit === "g" ? "weight (g)" : "volume (ml)"}
            {formula.hasScanLayout ? " · placed on its scanned worksheet" : ""}
          </p>
          {formula.notes ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{formula.notes}</p> : null}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant={trying ? "primary" : "secondary"} onClick={() => setTrying((t) => !t)} aria-expanded={trying}>
            <Calculator size={15} weight="bold" />
            Try it
          </Button>
          {canManage ? (
            <>
              <Button size="sm" variant="secondary" onClick={onEdit}>
                <PencilSimple size={15} weight="bold" />
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={onWithdraw} aria-label={`Withdraw the formula for ${productTitle(formula)}`}>
                <Trash size={15} weight="bold" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              <th className="px-4 py-2">Raw material</th>
              <th className="px-4 py-2">Basis</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Shown in</th>
            </tr>
          </thead>
          <tbody>
            {formula.ingredients.map((i) => (
              <tr key={i.id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-4 py-2">
                  {i.name}
                  {i.optional ? <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">(optional)</span> : null}
                </td>
                <td className="px-4 py-2">{basisLabel(i.basis, formula.baseUnit)}</td>
                <td className="px-4 py-2">{amountLabel(i, formula.baseUnit)}</td>
                <td className="px-4 py-2">
                  {i.displayUnit}
                  {i.basis !== "TO_VOLUME" ? (
                    <span className="text-[var(--muted-foreground)]">
                      {" "}
                      to {i.decimals ?? DEFAULT_DECIMALS[i.displayUnit]} dp
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--border)] px-4 py-2.5">
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Overage — added once per batch
        </p>
        <div className="flex flex-wrap gap-1.5">
          {formula.overages.map((rule, i) => (
            <span
              key={i}
              className="rounded border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1 text-[12px] tabular-nums"
            >
              <span className="text-[var(--muted-foreground)]">
                {packSizeLabel(rule, formula.baseUnit)}, {packRange(rule)} {rule.toPacks === 1 && rule.fromPacks === 1 ? "pack" : "packs"}:
              </span>{" "}
              <strong className="text-foreground">
                {plain(rule.amount)} {formula.baseUnit}
              </strong>
            </span>
          ))}
        </div>
      </div>

      {trying ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3">
          <TryFormula formula={formula} />
        </div>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/** Works a batch out from the formula as typed — the same calculation the
 *  generated worksheet uses. */
function TryFormula({ formula, idPrefix = "try" }: { formula: FormulaDefinition; idPrefix?: string }) {
  const unit = formula.baseUnit;
  const followsBatch = formula.ingredients.some((i) => i.basis === "PER_DOSE" && i.amount === null);
  const examplePack = formula.overages.find((r) => r.packSize !== null)?.packSize;
  const [packs, setPacks] = useState("1");
  const [packSize, setPackSize] = useState(String(examplePack ?? (unit === "g" ? 50 : 150)));
  const [strength, setStrength] = useState(formula.strength ?? (followsBatch ? (unit === "g" ? "1%" : "5mg/5ml") : ""));

  const result = calculateBatch(formula, {
    packs: packs.trim() === "" ? NaN : Number(packs),
    packSize: packSize.trim() === "" ? NaN : Number(packSize),
    strength: strength.trim() || null,
  });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={unit === "ml" ? "Bottles" : "Packs"} htmlFor={`${idPrefix}-bottles`}>
          <Input id={`${idPrefix}-bottles`} inputMode="numeric" value={packs} onChange={(e) => setPacks(e.target.value)} />
        </Field>
        <Field label={`Pack size (${unit})`} htmlFor={`${idPrefix}-pack`}>
          <Input id={`${idPrefix}-pack`} inputMode="decimal" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
        </Field>
        {followsBatch ? (
          <Field
            label="Batch strength"
            htmlFor={`${idPrefix}-strength`}
            error={
              strength.trim() && !parseDoseStrength(strength, unit)
                ? unit === "g"
                  ? "An amount in the product, e.g. 20mg/g or 1%"
                  : "An amount in a volume, e.g. 5mg/5ml"
                : undefined
            }
          >
            <Input
              id={`${idPrefix}-strength`}
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              placeholder={unit === "g" ? "1%" : "5mg/5ml"}
            />
          </Field>
        ) : null}
      </div>

      {!result.ok ? (
        <ErrorNotice message={result.error} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <table className="w-full self-start text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                <th className="py-1.5 pr-3">Raw material</th>
                <th className="py-1.5 text-right">Quantity required</th>
              </tr>
            </thead>
            <tbody>
              {result.value.lines.map((line) => (
                <tr key={line.ingredientId} className="border-b border-[var(--border)]">
                  <td className="py-1.5 pr-3">
                    {line.name}
                    {line.optional ? <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">(optional)</span> : null}
                  </td>
                  <td className="py-1.5 text-right font-mono font-semibold tabular-nums">{quantityText(line)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 pr-3 font-semibold">Final product quantity</td>
                <td className="py-1.5 text-right font-mono font-semibold tabular-nums">
                  {result.value.finalQuantity} {unit}
                </td>
              </tr>
            </tbody>
          </table>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              Calculation
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                — overage {plain(result.value.overage)} {unit}, from the row for{" "}
                {packSizeLabel(result.value.overageRule, unit).toLowerCase()}, {packRange(result.value.overageRule)} packs
              </span>
            </p>
            <ol className="grid gap-0.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-[12px] leading-relaxed">
              {result.value.working.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface IngredientDraft {
  id: string;
  name: string;
  basis: FormulaBasis;
  amount: string;
  amountUnit: FormulaUnit;
  doseVolumeMl: string;
  displayUnit: FormulaUnit;
  decimals: string;
  optional: boolean;
}

const newId = () => `i${Math.random().toString(36).slice(2, 8)}`;

const blankIngredient = (basis: FormulaBasis = "PER_100ML"): IngredientDraft => ({
  id: newId(),
  name: "",
  basis,
  amount: "",
  amountUnit: basis === "PER_DOSE" ? "mg" : "ml",
  doseVolumeMl: "",
  displayUnit: basis === "PER_DOSE" ? "g" : "ml",
  decimals: "",
  optional: false,
});

const asText = (n: number | null) => (n === null ? "" : String(n));

interface OverageDraft {
  key: string;
  packSize: string;
  fromPacks: string;
  toPacks: string;
  amount: string;
}

const overageDraft = (rule?: OverageRule): OverageDraft => ({
  key: newId(),
  packSize: rule ? asText(rule.packSize) : "",
  fromPacks: rule ? String(rule.fromPacks) : "1",
  toPacks: rule ? asText(rule.toPacks) : "",
  amount: rule ? String(rule.amount) : "",
});

function FormulaEditor({
  staffId,
  formula,
  onClose,
  onSaved,
}: {
  staffId: string;
  formula: Formula | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [medicineName, setMedicineName] = useState(formula?.medicineName ?? "");
  const [dosageForm, setDosageForm] = useState<DosageForm>(formula?.dosageForm ?? "SOLUTION");
  const [strength, setStrength] = useState(formula?.strength ?? "");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(formula?.baseUnit ?? "ml");
  const [overages, setOverages] = useState<OverageDraft[]>(
    formula ? formula.overages.map(overageDraft) : [{ ...overageDraft(), amount: "10" }],
  );
  const [notes, setNotes] = useState(formula?.notes ?? "");
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(
    formula
      ? formula.ingredients.map((i) => ({
          ...i,
          amount: asText(i.amount),
          doseVolumeMl: asText(i.doseVolumeMl),
          decimals: asText(i.decimals),
        }))
      : [blankIngredient("PER_DOSE"), blankIngredient("PER_100ML"), blankIngredient("TO_VOLUME")],
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const checked = useMemo(
    () =>
      checkFormula({
        medicineName,
        dosageForm,
        strength,
        baseUnit,
        overages,
        notes,
        ingredients,
      }),
    [medicineName, dosageForm, strength, baseUnit, overages, notes, ingredients],
  );

  function update(index: number, patch: Partial<IngredientDraft>) {
    setIngredients((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function updateOverage(index: number, patch: Partial<OverageDraft>) {
    setOverages((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** Creams and ointments are made by weight; the made-up-to ingredient
   *  follows. */
  function changeBaseUnit(unit: BaseUnit) {
    setBaseUnit(unit);
    setIngredients((prev) =>
      prev.map((item) => (item.basis === "TO_VOLUME" ? { ...item, amountUnit: unit, displayUnit: unit } : item)),
    );
  }

  async function submit() {
    if (!checked.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveFormula(staffId, formula?.id ?? null, checked.value);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save the formula.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={saving ? () => {} : onClose}
      title={formula ? `Edit formula — ${productTitle(formula)}` : "New formula"}
      description={
        formula
          ? `Saving makes this version ${formula.version + 1}; version ${formula.version} is kept on record.`
          : "Each ingredient's amount and how it scales with the batch. Batches of this product get their worksheet's quantities from it."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!checked.ok || saving} onClick={() => void submit()}>
            {saving ? "Saving…" : formula ? `Save as version ${formula.version + 1}` : "Save formula"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {saveError ? <ErrorNotice message={saveError} /> : null}

        <div className="grid gap-3.5 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field label="Medicine" htmlFor="f-name" required helper="As entered in the Batch Book, e.g. Melatonin">
            <Input id="f-name" value={medicineName} onChange={(e) => setMedicineName(e.target.value)} disabled={saving} />
          </Field>
          <Field label="Type" htmlFor="f-form" required>
            <Select
              id="f-form"
              value={dosageForm}
              onChange={(e) => {
                const form = e.target.value as DosageForm;
                setDosageForm(form);
                changeBaseUnit(defaultBaseUnit(form));
              }}
              disabled={saving}
            >
              {DOSAGE_FORMS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Strength" htmlFor="f-strength" helper="Blank for every strength">
            <Input id="f-strength" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 5mg/5ml" disabled={saving} />
          </Field>
          <Field label="Made by" htmlFor="f-unit" required>
            <Select id="f-unit" value={baseUnit} onChange={(e) => changeBaseUnit(e.target.value as BaseUnit)} disabled={saving}>
              <option value="ml">Volume (ml)</option>
              <option value="g">Weight (g)</option>
            </Select>
          </Field>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-bold text-foreground">Overage table</legend>
          <p className="mb-1.5 text-xs text-[var(--muted-foreground)]">
            How much extra to make, added once for the whole batch. Leave the pack size blank for a row that covers any
            pack size (a row for the exact pack size wins), and &ldquo;to&rdquo; blank for &ldquo;and over&rdquo;. A
            batch with no matching row won&apos;t be worked out.
          </p>
          <div className="overflow-x-auto rounded-md border border-[var(--border)]">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)] text-left text-xs font-bold text-[var(--muted-foreground)]">
                  <th className="px-2 py-1.5">Pack size ({baseUnit})</th>
                  <th className="px-2 py-1.5">From (packs)</th>
                  <th className="px-2 py-1.5">To (packs)</th>
                  <th className="px-2 py-1.5">Overage ({baseUnit})</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {overages.map((row, index) => (
                  <tr key={row.key} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-9"
                        inputMode="decimal"
                        aria-label={`Overage row ${index + 1} pack size`}
                        value={row.packSize}
                        onChange={(e) => updateOverage(index, { packSize: e.target.value })}
                        placeholder="any"
                        disabled={saving}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-9"
                        inputMode="numeric"
                        aria-label={`Overage row ${index + 1} from packs`}
                        value={row.fromPacks}
                        onChange={(e) => updateOverage(index, { fromPacks: e.target.value })}
                        disabled={saving}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-9"
                        inputMode="numeric"
                        aria-label={`Overage row ${index + 1} to packs`}
                        value={row.toPacks}
                        onChange={(e) => updateOverage(index, { toPacks: e.target.value })}
                        placeholder="and over"
                        disabled={saving}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-9"
                        inputMode="decimal"
                        aria-label={`Overage row ${index + 1} amount`}
                        value={row.amount}
                        onChange={(e) => updateOverage(index, { amount: e.target.value })}
                        disabled={saving}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove overage row ${index + 1}`}
                        onClick={() => setOverages((prev) => prev.filter((_, i) => i !== index))}
                        disabled={saving || overages.length === 1}
                      >
                        <X size={14} weight="bold" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setOverages((prev) => [...prev, overageDraft()])}
            disabled={saving}
          >
            <Plus size={14} weight="bold" />
            Add overage row
          </Button>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-bold text-foreground">Ingredients</legend>
          <div className="overflow-x-auto rounded-md border border-[var(--border)]">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)] text-left text-xs font-bold text-[var(--muted-foreground)]">
                  <th className="px-2 py-1.5">Raw material</th>
                  <th className="px-2 py-1.5">Basis</th>
                  <th className="px-2 py-1.5">Amount</th>
                  <th className="px-2 py-1.5">Per dose of ({baseUnit})</th>
                  <th className="px-2 py-1.5">Shown in</th>
                  <th className="px-2 py-1.5">Decimals</th>
                  <th className="px-2 py-1.5">Optional</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {ingredients.map((item, index) => {
                  const toVolume = item.basis === "TO_VOLUME";
                  const perDose = item.basis === "PER_DOSE";
                  const label = item.name || `ingredient ${index + 1}`;
                  return (
                    <tr key={item.id} className="border-b border-[var(--border)] last:border-b-0 align-top">
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-9 min-w-[200px]"
                          aria-label={`Ingredient ${index + 1} name`}
                          value={item.name}
                          onChange={(e) => update(index, { name: e.target.value })}
                          placeholder="e.g. Propylene glycol BP"
                          disabled={saving}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          className="h-9 min-w-[8.5rem]"
                          aria-label={`How ${label} is worked out`}
                          value={item.basis}
                          onChange={(e) => {
                            const basis = e.target.value as FormulaBasis;
                            update(
                              index,
                              basis === "TO_VOLUME" ? { basis, amountUnit: baseUnit, displayUnit: baseUnit, amount: "" } : { basis },
                            );
                          }}
                          disabled={saving}
                        >
                          {FORMULA_BASES.map((b) => (
                            <option key={b} value={b}>
                              {basisLabel(b, baseUnit)}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        {toVolume ? (
                          <span className="block pt-2 text-[var(--muted-foreground)]">to {baseUnit === "g" ? "weight" : "volume"}</span>
                        ) : (
                          <div className="flex gap-1">
                            <Input
                              className="h-9 min-w-[4.5rem]"
                              inputMode="decimal"
                              aria-label={`Amount of ${label}`}
                              value={item.amount}
                              onChange={(e) => update(index, { amount: e.target.value })}
                              placeholder={perDose ? "batch" : ""}
                              disabled={saving}
                            />
                            <Select
                              className="h-9 min-w-[4.75rem]"
                              aria-label={`Unit of ${label}'s amount`}
                              value={item.amountUnit}
                              onChange={(e) => update(index, { amountUnit: e.target.value as FormulaUnit })}
                              disabled={saving}
                            >
                              {FORMULA_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </Select>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {perDose ? (
                          <Input
                            className="h-9 min-w-[4.5rem]"
                            inputMode="decimal"
                            aria-label={`Dose volume for ${label}`}
                            value={item.doseVolumeMl}
                            onChange={(e) => update(index, { doseVolumeMl: e.target.value })}
                            placeholder={item.amount.trim() ? "" : "batch"}
                            disabled={saving}
                          />
                        ) : (
                          <span className="block pt-2 text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          className="h-9 min-w-[4.75rem]"
                          aria-label={`Unit ${label} is shown in`}
                          value={item.displayUnit}
                          onChange={(e) => update(index, { displayUnit: e.target.value as FormulaUnit })}
                          disabled={saving || toVolume}
                        >
                          {FORMULA_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-9 min-w-[3.5rem] max-w-[4.5rem]"
                          inputMode="numeric"
                          aria-label={`Decimal places for ${label}`}
                          value={toVolume ? "" : item.decimals}
                          onChange={(e) => update(index, { decimals: e.target.value })}
                          placeholder={toVolume ? "—" : String(DEFAULT_DECIMALS[item.displayUnit])}
                          disabled={saving || toVolume}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          className="mt-2.5 h-4 w-4 cursor-pointer"
                          aria-label={`${label} is optional`}
                          checked={item.optional}
                          onChange={(e) => update(index, { optional: e.target.checked })}
                          disabled={saving}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-0.5"
                          aria-label={`Remove ${label}`}
                          onClick={() => setIngredients((prev) => prev.filter((_, i) => i !== index))}
                          disabled={saving || ingredients.length === 1}
                        >
                          <X size={14} weight="bold" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="secondary" onClick={() => setIngredients((prev) => [...prev, blankIngredient()])} disabled={saving}>
              <Plus size={14} weight="bold" />
              Add ingredient
            </Button>
            <p className="text-xs text-[var(--muted-foreground)]">
              Per dose with the amount left blank follows the batch&apos;s strength ({baseUnit === "g" ? "20mg/g or 1%" : "5mg/5ml"}).
              Decimals left blank: g 3, ml 1.
            </p>
          </div>
        </fieldset>

        <Field label="Notes" htmlFor="f-notes" helper="Optional — e.g. the worksheet it was taken from">
          <Textarea id="f-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </Field>

        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Calculator size={14} weight="bold" />
            Check it
          </p>
          {checked.ok ? <TryFormula formula={checked.value} idPrefix="check" /> : <ErrorNotice message={checked.error} />}
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function WithdrawModal({
  staffId,
  formula,
  onClose,
  onDone,
}: {
  staffId: string;
  formula: Formula;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await withdrawFormula(staffId, formula.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't withdraw the formula.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Withdraw the formula for ${productTitle(formula)}?`}
      description="New batches of it won't get their quantities worked out until a formula is added again. It stays on record, and worksheets already generated from it are unchanged."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? "Withdrawing…" : "Withdraw"}
          </Button>
        </>
      }
    >
      {error ? <ErrorNotice message={error} /> : <p className="text-sm">Version {formula.version}, by {formula.createdByName}.</p>}
    </Modal>
  );
}
