import {
  VOICE_INPUT_CAPABILITY,
  hasServerCapabilityAdvertisement,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useSyncExternalStore } from "react";
import { useModelSettings } from "../../hooks/useModelSettings";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import {
  getPolzaSpeechLanguage,
  setPolzaSpeechLanguage,
  subscribePolzaSpeechLanguage,
  type PolzaSpeechLanguage,
} from "../../lib/polzaSpeechLanguage";
import { isBrowserNativeSpeechAvailable } from "../../lib/speechProviders/methods";
import { SettingsItem } from "./SettingsItem";
import { SettingsSection } from "./SettingsSection";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";

export function PolzaSpeechSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("speechSettingsVoiceInputTitle"));
  const { voiceInputEnabled, setVoiceInputEnabled } = useModelSettings();
  const { version, loading } = useVersion();
  const language = useSyncExternalStore(
    subscribePolzaSpeechLanguage,
    getPolzaSpeechLanguage,
    getPolzaSpeechLanguage,
  );
  const allowed =
    !hasServerCapabilityAdvertisement(version) ||
    serverHasCapability(version, VOICE_INPUT_CAPABILITY);
  const available =
    allowed &&
    (isBrowserNativeSpeechAvailable() || !!version?.voiceBackends?.length);
  return (
    <SettingsSection description={t("polzaSpeechSettingsHelp")}>
      <div className="settings-group">
        <SettingsItem
          label={t("speechSettingsVoiceInputTitle")}
          description={
            available
              ? t("speechSettingsVoiceInputDescription")
              : t("polzaSpeechUnavailableHelp")
          }
        >
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={voiceInputEnabled && allowed}
              disabled={loading || !available}
              onChange={(event) => setVoiceInputEnabled(event.target.checked)}
              aria-label={t("speechSettingsVoiceInputTitle")}
            />
            <span className="toggle-slider" />
          </label>
        </SettingsItem>
        <SettingsItem
          label={t("speechSettingsRecognitionLanguage")}
          className="model-settings-item"
        >
          <select
            className="settings-select"
            value={language}
            aria-label={t("speechSettingsRecognitionLanguage")}
            onChange={(event) =>
              setPolzaSpeechLanguage(event.target.value as PolzaSpeechLanguage)
            }
          >
            <option value="ru-RU">Русский</option>
            <option value="en-US">English</option>
            <option value="auto">{t("speechSettingsBrowserLanguage")}</option>
          </select>
        </SettingsItem>
      </div>
    </SettingsSection>
  );
}
