import { useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";

import { strings } from "../i18n";
import type { CatalogModel, OnlineProvider } from "../onlineRefine";
import {
  ONLINE_PROVIDERS,
  PROVIDER_NAMES,
  loadModelCatalog,
} from "../onlineRefine";
import {
  chooseModel,
  filterModels,
  onlineEditingStatus,
} from "../onlineSettings";
import { providerFetch } from "../providerFetch";
import { useCompanionStore } from "../store";
import {
  Button,
  Card,
  Chip,
  Icon,
  Label,
  ToggleRow,
  inputColors,
} from "./components";
import { colors, fonts, glass, radius, space } from "./theme";

type Catalog =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "failed" }
  | { state: "loaded"; models: CatalogModel[] };

/**
 * Settings' ONLINE EDITING section: Rewrite and Reply with the user's own
 * OpenRouter or OpenCode Zen key (onlineRefine.ts). The key goes from its
 * field straight to SecureStore; afterwards the section only shows "Key
 * saved". The model catalog is public and loads only on a tap, without the
 * key. The web preview keeps no keys, so there every control is disabled.
 */
export function OnlineEditingSection() {
  const uiLanguage = useCompanionStore((s) => s.settings.uiLanguage);
  const editing = useCompanionStore((s) => s.settings.onlineEditing);
  const keySaved = useCompanionStore((s) => s.onlineKeySaved);
  const setOnlineEditing = useCompanionStore((s) => s.setOnlineEditing);
  const saveProviderKey = useCompanionStore((s) => s.saveProviderKey);
  const removeProviderKey = useCompanionStore((s) => s.removeProviderKey);
  const t = strings(uiLanguage).settings.onlineEditing;
  const web = Platform.OS === "web";

  const [provider, setProvider] = useState<OnlineProvider>(
    editing?.provider ?? "openrouter",
  );
  const [model, setModel] = useState(editing?.model ?? "");
  const [key, setKey] = useState("");
  const [modelError, setModelError] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({ state: "idle" });
  /** Bumped on a provider change, so a list that arrives late is dropped. */
  const catalogRequest = useRef(0);

  const name = PROVIDER_NAMES[provider];
  const inUse =
    editing?.provider === provider && editing.model === model.trim();

  const chooseProvider = (next: OnlineProvider) => {
    if (next === provider) return;
    catalogRequest.current += 1;
    setProvider(next);
    setModel(editing?.provider === next ? editing.model : "");
    setKey("");
    setModelError(false);
    setKeyError(false);
    setCatalog({ state: "idle" });
  };

  const applyModel = async (id: string) => {
    const next = chooseModel(editing, provider, id);
    if (!next) {
      setModelError(true);
      return;
    }
    setModelError(false);
    setModel(next.model);
    await setOnlineEditing(next);
  };

  // Only on a tap: the catalog is public and the request carries no key.
  const loadModels = async () => {
    const request = ++catalogRequest.current;
    setCatalog({ state: "loading" });
    const models = await loadModelCatalog(provider, providerFetch);
    if (request !== catalogRequest.current) return;
    setCatalog(models ? { state: "loaded", models } : { state: "failed" });
  };

  const saveKey = async () => {
    if (savingKey) return;
    setSavingKey(true);
    try {
      const result = await saveProviderKey(provider, key);
      if (result === "saved") {
        setKey("");
        setKeyError(false);
      } else if (result === "invalid") {
        setKeyError(true);
      }
      // "failed": the storage notice at the top of Settings says so.
    } finally {
      setSavingKey(false);
    }
  };

  const matches =
    catalog.state === "loaded" ? filterModels(catalog.models, model) : [];

  return (
    <View style={s.section}>
      <Label heading>{t.title}</Label>
      <Card>
        <Text style={s.help}>{t.help}</Text>
        <Text style={s.status}>
          {web ? t.previewOnly : onlineEditingStatus(t, editing, keySaved)}
        </Text>

        <Text style={s.fieldLabel}>{t.provider}</Text>
        <View style={s.chips}>
          {ONLINE_PROVIDERS.map((option) => (
            <Chip
              key={option}
              label={PROVIDER_NAMES[option]}
              selected={provider === option}
              disabled={web}
              onPress={() => chooseProvider(option)}
            />
          ))}
        </View>

        <Text style={s.fieldLabel}>{t.model}</Text>
        <TextInput
          accessibilityLabel={t.model}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={!web}
          placeholder={t.modelPlaceholder}
          placeholderTextColor={colors.muted}
          value={model}
          onChangeText={(value) => {
            setModel(value);
            setModelError(false);
          }}
          onSubmitEditing={() => void applyModel(model)}
          style={[s.input, modelError && s.inputError]}
          {...inputColors}
        />
        {modelError ? (
          <Text style={[s.help, s.error]}>{t.invalidModel}</Text>
        ) : null}
        <View style={s.row}>
          <Button
            variant="primary"
            label={t.useModel}
            disabled={web || !model.trim() || inUse}
            onPress={() => void applyModel(model)}
          />
          <Button
            label={catalog.state === "loading" ? t.loadingModels : t.loadModels}
            disabled={web || catalog.state === "loading"}
            onPress={() => void loadModels()}
          />
        </View>
        <Text style={s.help}>{t.loadModelsHelp}</Text>
        {catalog.state === "failed" ? (
          <Text style={[s.help, s.error]}>{t.loadModelsFailed}</Text>
        ) : null}
        {catalog.state === "loaded" ? (
          <>
            <Text style={s.help}>
              {matches.length > 0 ? t.pickModel : t.noModelMatch}
            </Text>
            <View style={s.chips}>
              {matches.map((option) => (
                <Chip
                  key={option.id}
                  label={option.id}
                  selected={
                    editing?.provider === provider &&
                    editing.model === option.id
                  }
                  onPress={() => void applyModel(option.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text style={s.fieldLabel}>{t.key}</Text>
        {keySaved[provider] ? (
          <View style={s.saved}>
            <Icon name="lock" size={16} color={colors.lime} />
            <Text style={s.body}>{t.keySaved}</Text>
          </View>
        ) : (
          <TextInput
            accessibilityLabel={t.key}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            spellCheck={false}
            secureTextEntry
            editable={!web}
            placeholder={t.keyPlaceholder(name)}
            placeholderTextColor={colors.muted}
            value={key}
            onChangeText={(value) => {
              setKey(value);
              setKeyError(false);
            }}
            style={[s.input, keyError && s.inputError]}
            {...inputColors}
          />
        )}
        {keyError ? (
          <Text style={[s.help, s.error]}>{t.invalidKey}</Text>
        ) : null}
        <Text style={s.help}>{t.keyNote}</Text>
        <View style={s.row}>
          {keySaved[provider] ? (
            <Button
              variant="danger"
              label={t.removeKey}
              disabled={web}
              onPress={() => void removeProviderKey(provider)}
            />
          ) : (
            <Button
              variant="primary"
              label={t.saveKey}
              disabled={web || savingKey || !key.trim()}
              onPress={() => void saveKey()}
            />
          )}
        </View>
      </Card>

      <Card style={s.toggles}>
        <ToggleRow
          label={t.alwaysAllow}
          value={editing?.alwaysAllow === true}
          // Nothing to send to until a provider and a model are chosen.
          disabled={web || !editing}
          onChange={(alwaysAllow) => {
            if (editing) void setOnlineEditing({ ...editing, alwaysAllow });
          }}
          last
        />
      </Card>
      <Text style={s.help}>{t.alwaysAllowHelp}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  section: { gap: space.sm },
  toggles: { paddingVertical: 4, gap: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  help: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
  },
  error: { color: colors.danger },
  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
    marginTop: space.xs,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    // Set into the glass card, like the other Settings fields (ux-26).
    backgroundColor: glass.well,
    borderWidth: 1,
    borderColor: colors.lineInteractive,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  inputError: { borderColor: colors.danger },
  saved: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 46,
  },
});
