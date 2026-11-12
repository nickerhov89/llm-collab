import { useState } from "react";
import { usePolzaWorkProfile } from "../hooks/usePolzaWorkProfile";
import { useI18n } from "../i18n";
import { PolzaWorkProfileEditor } from "./PolzaWorkProfileEditor";
export function PolzaOwnWorkProfile() {
  const { profile, owner, saveOwner } = usePolzaWorkProfile();
  const { t } = useI18n();
  const [error, setError] = useState("");
  return (
    <>
      <PolzaWorkProfileEditor
        value={profile}
        disabled={!owner}
        onChange={(next) => {
          try {
            saveOwner(next);
            setError("");
          } catch {
            setError(t("taskerStorageError"));
          }
        }}
      />
      <p>{t(owner ? "workOwnerLocal" : "workManagedByAdmin")}</p>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
