import { UserRole } from "../../types";

export function RoleSegmentedControl({
  value,
  onChange
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
}) {
  return (
    <fieldset className="role-segment">
      <legend>계정 역할</legend>
      <label className={value === "teacher" ? "active" : ""}>
        <input
          type="radio"
          name="signup-role"
          value="teacher"
          checked={value === "teacher"}
          onChange={() => onChange("teacher")}
        />
        <span>선생님</span>
      </label>
      <label className={value === "student" ? "active" : ""}>
        <input
          type="radio"
          name="signup-role"
          value="student"
          checked={value === "student"}
          onChange={() => onChange("student")}
        />
        <span>학생</span>
      </label>
    </fieldset>
  );
}
