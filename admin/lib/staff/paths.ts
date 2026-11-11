// Fixed paths for the staff area. Built here, never from request input, so there is no open redirect.
export type StaffRole = "super_admin" | "admin" | "judge";

export const staffLoginPath = "/staff/login";
export const staffPasswordPath = "/staff/set-password";
export const staffHome = (role: StaffRole): string => (role === "judge" ? "/judge" : "/admin");
