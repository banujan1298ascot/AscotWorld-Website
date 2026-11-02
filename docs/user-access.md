# Users and access

Admins, and anyone an admin lets **manage users**, manage people from the
Team page's **Directory**. **Manage** on a person's card opens their account:

- **Details:** name, job title, department, email (it's what they sign in
  with, so it must be unique), phone, MES station, MES operator type and
  sign-in password.
- **Role & access:** their role, then each section of the portal. For each
  section, choose whether they can open it and which of its abilities they
  have, such as entering or confirming batches, claiming MES batches,
  changing the rota or uploading worksheets. The role gives the starting
  point, and anything changed from it is marked "changed". Changing the
  role resets their access to the new role's defaults.
- **Remove user:** takes them off the staff list so they can't sign in.
  Their history (batches, MES moves, messages) stays under their name.

## How it's stored

Only the differences from the role are kept, on the staff record and its
mirror in the `staff` table (`access` jsonb). There are four lists: abilities
given, abilities taken away, sections opened and sections hidden
(`StaffAccess` in `src/lib/access.ts`). `staffCan(person, capability)` is the
one check used everywhere:

- the screens, to show or hide controls;
- the server, to allow or refuse a request (`requireStaff` loads the
  person's access; batch-book, MES, reports and records rules all call
  `staffCan`).

Section visibility uses `canAccessModule` in `src/modules/registry.ts`. A
hidden section disappears from the menu and the dashboard, and opening its
address shows "This section isn't available to you".

Worksheet upload access stays per person in `worksheet_editors`. The access
editor shows it under Worksheets and changes it through
`/api/worksheets/access`, which anyone who manages users can now use.

## Safety rules (server-side, `checkStaffChange` in `src/server/records/rules.ts`)

- Nobody changes their own role or access, or removes themselves.
- Only an admin can change or remove an admin's account, make someone an
  admin, or let someone manage users.
- There's always at least one admin left.
- No two people can share an email address.

These are unit-tested in `src/server/records/rules.test.ts`, and the access
model in `src/lib/access.test.ts`.

**Still demo auth:** the server trusts the `x-staff-id` header (see
`src/server/auth/requireStaff.ts`), so these rules decide what the portal
allows, but they aren't proof against someone forging requests. That needs
real sign-in.
