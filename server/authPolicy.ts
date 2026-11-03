export type RegistrationAccountType = "Student" | "Parent";
export type CounselorRole = "Student" | "Parent";

export function getRegistrationRole(accountType?: RegistrationAccountType): RegistrationAccountType {
  return accountType === "Parent" ? "Parent" : "Student";
}

export function getCounselorRole(trustedRole?: string): CounselorRole {
  return trustedRole === "Parent" ? "Parent" : "Student";
}
