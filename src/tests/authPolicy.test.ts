import { describe, expect, it } from "vitest";
import { getCounselorRole, getRegistrationRole } from "../server/authPolicy";
import { registerSchema } from "../server/validator";

describe("authentication role policy", () => {
  it("rejects client-supplied role fields, including Admin", () => {
    expect(registerSchema.body.safeParse({
      email: "attacker@example.com",
      password: "ValidPass1!",
      role: "Admin",
    }).success).toBe(false);
    expect(registerSchema.body.safeParse({
      email: "attacker@example.com",
      password: "ValidPass1!",
      accountType: "Admin",
    }).success).toBe(false);
  });

  it("allows only the server-mapped Student or Parent registration types", () => {
    const parent = registerSchema.body.safeParse({
      email: "parent@example.com",
      password: "ValidPass1!",
      accountType: "Parent",
    });

    expect(parent.success).toBe(true);
    expect(parent.success && getRegistrationRole(parent.data.accountType)).toBe("Parent");
    expect(getRegistrationRole()).toBe("Student");
  });

  it("uses only the stored role for counselor behavior", () => {
    expect(getCounselorRole("Parent")).toBe("Parent");
    expect(getCounselorRole("Student")).toBe("Student");
    expect(getCounselorRole("Admin")).toBe("Student");
    expect(getCounselorRole()).toBe("Student");
  });
});
