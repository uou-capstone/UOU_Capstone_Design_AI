import { AuthService, normalizeEmail } from "../services/auth/AuthService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { UserRole } from "../types/domain.js";

const PASSWORD = "MergeEduTest!2026";

const accounts: Array<{
  email: string;
  displayName: string;
  role: UserRole;
  inviteCode: string;
}> = [
  {
    email: "teacher.test01@mergeedu.local",
    displayName: "테스트 선생님 01",
    role: "teacher",
    inviteCode: "9001"
  },
  {
    email: "teacher.test02@mergeedu.local",
    displayName: "테스트 선생님 02",
    role: "teacher",
    inviteCode: "9002"
  },
  ...Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return {
      email: `student.test${String(number).padStart(2, "0")}@mergeedu.local`,
      displayName: `테스트 학생 ${String(number).padStart(2, "0")}`,
      role: "student" as const,
      inviteCode: String(7100 + number)
    };
  })
];

async function main() {
  const store = new JsonStore();
  await store.init();
  const auth = new AuthService(store);
  const now = new Date().toISOString();

  let created = 0;
  let updated = 0;

  for (const account of accounts) {
    const emailNormalized = normalizeEmail(account.email);
    const password = await auth.hashPassword(PASSWORD);
    const existing = await store.getUserByEmail(emailNormalized);
    const patch = {
      email: account.email,
      emailNormalized,
      displayName: account.displayName,
      role: account.role,
      inviteCode: account.inviteCode,
      passwordHash: password.passwordHash,
      passwordSalt: password.passwordSalt,
      emailVerifiedAt: now,
      emailVerificationCodeHash: undefined,
      emailVerificationExpiresAt: undefined,
      emailVerificationAttempts: 0,
      emailVerificationSentAt: undefined,
      googleSub: undefined
    };

    if (existing) {
      await store.updateUser(existing.id, patch);
      updated += 1;
      continue;
    }

    await store.createUser(patch);
    created += 1;
  }

  console.log(
    `[seedTempAccounts] ready: created=${created}, updated=${updated}, password=${PASSWORD}`
  );
}

main().catch((error) => {
  console.error("[seedTempAccounts] failed", error);
  process.exit(1);
});
