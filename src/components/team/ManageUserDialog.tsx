"use client";

/**
 * Managing one person from the Team directory — for admins, and anyone an
 * admin has let manage users:
 *
 *   Details  — name, job title, department, email, phone, MES station and
 *              operator type, sign-in password.
 *   Access   — their role, then section by section whether they can open it
 *              and which of its abilities they have. Starts from the role's
 *              defaults; only the differences are saved (src/lib/access.ts).
 *   Remove   — takes them off the staff list; their history stays.
 *
 * The server checks the same rules (src/server/records/rules.ts —
 * checkStaffChange): nobody changes their own role or access or removes
 * themselves, only an admin touches an admin's account or hands out the
 * admin role or user management, and there's always an admin left. The
 * dialog just doesn't offer what would be refused.
 */
import { useEffect, useMemo, useState } from "react";
import { Info, Trash, Warning } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Button, ErrorNotice, Field, Input, Modal, Select } from "@/components/ui";
import { SECTION_ABILITIES, accessFor, staffCan } from "@/lib/access";
import { apiFetch } from "@/lib/apiClient";
import { useDepartments } from "@/lib/batchBook";
import { useStages } from "@/lib/mes";
import { refreshCollections } from "@/lib/storage";
import { stationDotStyle } from "@/lib/stationColors";
import { OPERATOR_ROLES, ROLES, roleCan, type Capability, type OperatorRole, type Role, type StaffMember } from "@/lib/types";
import { fetchWorksheetAccess, setWorksheetAccess } from "@/lib/worksheets";
import { MODULES, MODULE_GROUPS, canAccessModule, roleOpensModule } from "@/modules/registry";

/** First + last initial (or first two letters of a single-word name). */
export function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sections in sidebar order. */
const SECTIONS = MODULES.filter((m) => m.enabled).sort(
  (a, b) => MODULE_GROUPS[a.group].order - MODULE_GROUPS[b.group].order || a.order - b.order,
);
const SECTION_IDS = SECTIONS.map((m) => m.id);
const ALL_CAPABILITIES = Object.values(SECTION_ABILITIES).flatMap((list) => list.map((a) => a.capability));

const roleDefaults = (role: Role) => ({
  can: new Set(ALL_CAPABILITIES.filter((c) => roleCan(role, c))),
  open: new Set(SECTIONS.filter((m) => roleOpensModule(m, role)).map((m) => m.id)),
});

type Tab = "details" | "access";

export function ManageUserDialog({
  person,
  me,
  allStaff,
  departments,
  onClose,
}: {
  person: StaffMember;
  me: StaffMember;
  allStaff: readonly StaffMember[];
  departments: readonly string[];
  onClose: () => void;
}) {
  const isSelf = person.id === me.id;
  const meIsAdmin = me.role === "admin";
  const [tab, setTab] = useState<Tab>("details");

  // Details
  const [name, setName] = useState(person.name);
  const [jobTitle, setJobTitle] = useState(person.jobTitle);
  const [department, setDepartment] = useState(person.department);
  const [email, setEmail] = useState(person.email);
  const [phone, setPhone] = useState(person.phone === "—" ? "" : person.phone);
  const [password, setPassword] = useState(person.demoPassword);
  const [operatorRole, setOperatorRole] = useState<OperatorRole | "">(person.operatorRole ?? "");
  const [mesStage, setMesStage] = useState<string>(person.mesStage == null ? "" : String(person.mesStage));

  // Access — the full sets they'll end up with.
  const [role, setRole] = useState<Role>(person.role);
  const [can, setCan] = useState<Set<Capability>>(() => new Set(ALL_CAPABILITIES.filter((c) => staffCan(person, c))));
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(SECTIONS.filter((m) => canAccessModule(m, person)).map((m) => m.id)),
  );
  const [roleReset, setRoleReset] = useState(false);

  // Worksheet upload access is kept per person on its own (worksheet_editors).
  const [worksheetAccess, setWorksheetAccessState] = useState<{ was: boolean; now: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWorksheetAccess(me.id)
      .then(({ people }) => {
        const has = people.find((p) => p.staffId === person.id)?.hasAccess ?? false;
        if (!cancelled) setWorksheetAccessState({ was: has, now: has });
      })
      .catch(() => {
        // Not allowed to see the list — the ability just isn't shown.
      });
    return () => {
      cancelled = true;
    };
  }, [me.id, person.id]);

  const { departments: mesDepartments } = useDepartments();
  const { stages } = useStages(mesDepartments[0]?.id);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const defaults = useMemo(() => roleDefaults(role), [role]);
  const accessLocked = isSelf;
  const roleOptions = (Object.keys(ROLES) as Role[]).filter((r) => meIsAdmin || r !== "admin" || person.role === "admin");

  function changeRole(next: Role) {
    setRole(next);
    const d = roleDefaults(next);
    setCan(d.can);
    setOpen(d.open);
    setRoleReset(true);
  }

  function toggle<T>(set: Set<T>, item: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) next.add(item);
    else next.delete(item);
    return next;
  }

  const changedCount =
    ALL_CAPABILITIES.filter((c) => can.has(c) !== defaults.can.has(c)).length +
    SECTION_IDS.filter((id) => open.has(id) !== defaults.open.has(id)).length;

  function problem(): string | null {
    if (!name.trim()) return "Enter their full name.";
    if (!jobTitle.trim()) return "Enter their job title.";
    if (!EMAIL_PATTERN.test(email.trim())) return "Enter a valid email address.";
    const clash = allStaff.find((s) => s.id !== person.id && s.email.toLowerCase() === email.trim().toLowerCase());
    if (clash) return `${clash.name} already uses that email address.`;
    if (!password.trim()) return "They need a sign-in password.";
    return null;
  }

  async function save() {
    const issue = problem();
    if (issue) {
      setError(issue);
      setTab("details");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const record: StaffMember = {
        ...person,
        name: name.trim(),
        initials: computeInitials(name),
        jobTitle: jobTitle.trim(),
        department,
        email: email.trim(),
        phone: phone.trim() || "—",
        demoPassword: password.trim(),
        operatorRole: operatorRole || null,
        mesStage: mesStage === "" ? null : Number(mesStage),
        role,
        access: accessFor(role, can, open, (id) => defaults.open.has(id), SECTION_IDS),
        updatedAt: new Date().toISOString(),
      };
      await apiFetch(`/api/records/staff/${encodeURIComponent(person.id)}`, me.id, {
        method: "PUT",
        body: JSON.stringify(record),
      });
      if (worksheetAccess && worksheetAccess.now !== worksheetAccess.was && role !== "admin") {
        await setWorksheetAccess(me.id, person.id, worksheetAccess.now);
      }
      refreshCollections();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the changes.");
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/records/staff/${encodeURIComponent(person.id)}`, me.id, { method: "DELETE" });
      refreshCollections();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove them.");
      setSaving(false);
      setConfirmingRemove(false);
    }
  }

  if (confirmingRemove) {
    return (
      <Modal
        open
        onClose={saving ? () => {} : () => setConfirmingRemove(false)}
        title={`Remove ${person.name}?`}
        description="They'll come off the staff list and won't be able to sign in. Everything they've done — batches, MES history, messages — stays on record under their name."
        footer={
          <>
            <Button onClick={() => setConfirmingRemove(false)} disabled={saving}>
              Keep them
            </Button>
            <Button variant="danger" onClick={() => void remove()} disabled={saving}>
              {saving ? "Removing…" : "Remove user"}
            </Button>
          </>
        }
      >
        {error ? <ErrorNotice message={error} /> : <p className="text-sm">{person.email}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      open
      size="lg"
      onClose={saving ? () => {} : onClose}
      title={`Manage ${person.name}`}
      description={`${person.jobTitle} · ${person.department}`}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {!isSelf ? (
            <Button variant="ghost" className="mr-auto text-[var(--danger)]" onClick={() => setConfirmingRemove(true)} disabled={saving}>
              <Trash size={15} weight="bold" />
              Remove user
            </Button>
          ) : (
            <span className="mr-auto" />
          )}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Avatar initials={computeInitials(name)} size={36} />
        <div role="tablist" aria-label="Manage user" className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-0.5">
          {(["details", "access"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`cursor-pointer rounded px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
                tab === value ? "bg-[var(--surface)] text-foreground shadow-sm" : "text-[var(--muted-foreground)] hover:text-foreground"
              }`}
            >
              {value === "details" ? "Details" : "Role & access"}
              {value === "access" && changedCount > 0 ? (
                <span className="ml-1.5 rounded bg-[var(--brand-50)] px-1 text-[11px] font-bold text-[var(--brand-700)]">
                  {changedCount} changed
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mb-3">
          <ErrorNotice message={error} />
        </div>
      ) : null}

      {tab === "details" ? (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="mu-name" required>
              <Input id="mu-name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
            </Field>
            <Field label="Job title" htmlFor="mu-title" required>
              <Input id="mu-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={saving} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email address" htmlFor="mu-email" required helper="Used to sign in — must be unique.">
              <Input id="mu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
            </Field>
            <Field label="Phone" htmlFor="mu-phone">
              <Input id="mu-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="020 8953 01xx" disabled={saving} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="mu-department">
              <Select id="mu-department" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={saving}>
                {[...new Set([department, ...departments])].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sign-in password" htmlFor="mu-password" required helper="Demo system — stored as plain text.">
              <Input id="mu-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={saving} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="MES station"
              htmlFor="mu-station"
              helper="A station account only sees its own station's work. Leave as “None” for anyone who moves between stations."
            >
              <Select id="mu-station" value={mesStage} onChange={(e) => setMesStage(e.target.value)} disabled={saving}>
                <option value="">None</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.sequenceNumber}>
                    {s.sequenceNumber}. {s.name}
                  </option>
                ))}
                {mesStage && !stages.some((s) => String(s.sequenceNumber) === mesStage) ? (
                  <option value={mesStage}>Station {mesStage}</option>
                ) : null}
              </Select>
            </Field>
            <Field label="MES operator type" htmlFor="mu-operator" helper="Check 2, 3 and 4 only take their own kind of operator.">
              <Select
                id="mu-operator"
                value={operatorRole}
                onChange={(e) => setOperatorRole(e.target.value as OperatorRole | "")}
                disabled={saving}
              >
                <option value="">None</option>
                {(Object.keys(OPERATOR_ROLES) as OperatorRole[]).map((r) => (
                  <option key={r} value={r}>
                    {OPERATOR_ROLES[r].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {accessLocked ? (
            <p className="flex items-start gap-2 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
              <Info size={14} weight="fill" className="mt-px shrink-0" />
              You can&apos;t change your own role or access — another admin or manager has to.
            </p>
          ) : null}

          <Field label="Role" htmlFor="mu-role" helper={`${ROLES[role].description} Changing the role resets their access to its defaults.`}>
            <Select id="mu-role" value={role} onChange={(e) => changeRole(e.target.value as Role)} disabled={saving || accessLocked}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].label}
                </option>
              ))}
            </Select>
          </Field>
          {roleReset ? (
            <p className="-mt-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--warning)]">
              <Warning size={14} weight="fill" />
              Access reset to the {ROLES[role].label} defaults — adjust below if needed.
            </p>
          ) : null}

          <div className="grid gap-2">
            <p className="text-xs font-bold text-foreground">
              What they can see and do
              <span className="ml-1.5 font-normal text-[var(--muted-foreground)]">
                Ticked = allowed. “Changed” marks a difference from the role&apos;s defaults.
              </span>
            </p>
            {SECTIONS.map((section) => {
              const abilities = SECTION_ABILITIES[section.id] ?? [];
              const isOpen = open.has(section.id);
              const sectionChanged = isOpen !== defaults.open.has(section.id);
              const Icon = section.icon;
              return (
                <div key={section.id} className="rounded-md border border-[var(--border)]">
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer"
                      checked={isOpen}
                      disabled={saving || accessLocked}
                      onChange={(e) => setOpen((prev) => toggle(prev, section.id, e.target.checked))}
                    />
                    <Icon size={16} weight="duotone" className="shrink-0 text-[var(--muted-foreground)]" />
                    <span className="text-sm font-bold">{section.label}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{isOpen ? "can open" : "hidden"}</span>
                    {sectionChanged ? <ChangedTag /> : null}
                  </label>
                  {abilities.length > 0 || section.id === "worksheets" ? (
                    <div className={`grid gap-1 border-t border-[var(--border)] px-3 py-2 pl-[2.6rem] sm:grid-cols-2 ${isOpen ? "" : "opacity-60"}`}>
                      {abilities.map((ability) => {
                        const on = can.has(ability.capability);
                        // Handing out user management is an admin's call.
                        const adminOnly = ability.capability === "team.manage" && !meIsAdmin;
                        return (
                          <label key={ability.capability} className="flex cursor-pointer items-start gap-2 text-[13px]">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 cursor-pointer"
                              checked={on}
                              disabled={saving || accessLocked || adminOnly}
                              onChange={(e) => setCan((prev) => toggle(prev, ability.capability, e.target.checked))}
                            />
                            <span>
                              {ability.label}
                              {on !== defaults.can.has(ability.capability) ? <ChangedTag /> : null}
                              {adminOnly ? <span className="ml-1 text-[11px] text-[var(--muted-foreground)]">(admins only)</span> : null}
                            </span>
                          </label>
                        );
                      })}
                      {section.id === "worksheets" ? (
                        <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 cursor-pointer"
                            checked={role === "admin" || Boolean(worksheetAccess?.now)}
                            disabled={saving || accessLocked || role === "admin" || worksheetAccess === null}
                            onChange={(e) => setWorksheetAccessState((prev) => (prev ? { ...prev, now: e.target.checked } : prev))}
                          />
                          <span>
                            Upload and move worksheets, and edit formulas
                            {role === "admin" ? (
                              <span className="ml-1 text-[11px] text-[var(--muted-foreground)]">(always, for admins)</span>
                            ) : worksheetAccess && worksheetAccess.now !== worksheetAccess.was ? (
                              <ChangedTag />
                            ) : null}
                          </span>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {person.mesStage != null ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={stationDotStyle(person.mesStage)} aria-hidden="true" />
              A station account — the MES also limits them to station {person.mesStage}.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function ChangedTag() {
  return (
    <span className="ml-1.5 inline-block rounded bg-[var(--warning-bg,var(--surface-sunken))] px-1 text-[10px] font-bold uppercase tracking-wide text-[var(--warning)]">
      changed
    </span>
  );
}
