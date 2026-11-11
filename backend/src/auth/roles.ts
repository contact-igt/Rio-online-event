// The staff roles and which of them may use which part of the API. Permissions are listed here by name and checked with a plain `includes`:
// there is no "super_admin may do anything" shortcut, so a new route is closed to a Super Admin until its role list says otherwise.
export const STAFF_ROLES = ["super_admin", "admin", "judge"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const isStaffRole = (value: unknown): value is StaffRole => STAFF_ROLES.includes(value as StaffRole);

export const ROLES = {
  /** Everything an administrator can do today. */
  adminApi: ["super_admin", "admin"],
  /** Managing staff accounts: an ordinary administrator cannot. */
  superAdminOnly: ["super_admin"],
  judgeApi: ["judge"],
} as const satisfies Record<string, readonly StaffRole[]>;
