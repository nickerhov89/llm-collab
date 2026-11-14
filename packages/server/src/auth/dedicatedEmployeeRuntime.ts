import { lstatSync, readFileSync } from "node:fs";

/** Root-provisioned, single-employee service; never enabled by an HTTP setting. */
function dedicatedEmployeeRuntime(): boolean {
  const file = process.env.POLZA_EMPLOYEE_POLICY;
  if (!file) return false;
  if (
    process.platform !== "linux" ||
    !/^\/etc\/polza-employees\/[a-z0-9-]+\.json$/.test(file)
  )
    throw new Error("Invalid dedicated employee policy path");
  const st = lstatSync(file);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== 0 ||
    (st.mode & 0o022) !== 0
  )
    throw new Error(
      "Employee policy must be a root-owned, immutable regular file",
    );
  const policy = JSON.parse(readFileSync(file, "utf8"));
  const cgroup = readFileSync("/proc/self/cgroup", "utf8");
  if (
    !Number.isInteger(policy.uid) ||
    policy.uid < 1500 ||
    process.getuid?.() !== policy.uid ||
    process.env.HOME !== policy.home ||
    !/^polza-employee-[a-z0-9-]+\.service$/.test(policy.unit) ||
    !cgroup
      .split("\n")
      .some((line) =>
        line.split(":").slice(2).join(":").split("/").includes(policy.unit),
      )
  )
    throw new Error(
      "Employee process is not inside its root-provisioned OS boundary",
    );
  return true;
}

// A malformed/missing configured boundary aborts startup, never falls back.
export const DEDICATED_EMPLOYEE_RUNTIME = dedicatedEmployeeRuntime();
