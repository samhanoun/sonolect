import React, { useMemo } from "react";
import { getStylePresets } from "./stylePresets";
import { useT } from "./i18n";

export type StylePresetSelectorProps = {
  currentPresetId: string;
  onSelect: (presetId: string) => void;
};

export function StylePresetSelector({
  currentPresetId,
  onSelect,
}: StylePresetSelectorProps) {
  const t = useT();
  const presets = useMemo(() => getStylePresets(), []);

  return (
    <div className="inline-actions" style={{ alignItems: "center" }}>
      <span className="editor-meta" style={{ marginRight: "0.5rem" }}>
        {t("stylePreset.label")}
      </span>
      {presets.map((preset) => (
        <button
          key={preset.id}
          className={
            currentPresetId === preset.id
              ? "primary-button compact"
              : "ghost-button"
          }
          onClick={() => onSelect(preset.id)}
          type="button"
          title={preset.description}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
