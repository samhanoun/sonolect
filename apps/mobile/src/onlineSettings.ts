import type { Strings } from "./i18n";
import type {
  CatalogModel,
  OnlineEditing,
  OnlineProvider,
} from "./onlineRefine";
import { PROVIDER_NAMES, isValidModelId } from "./onlineRefine";
import type { ProviderKeyStatus } from "./providerKeys";

/**
 * The Settings section of online editing, as pure functions: the status
 * line, the model list filter and the choice a model pick stores.
 */

/** At most this many catalog models are listed at once. */
export const MODEL_LIST_LIMIT = 40;

/** The status line at the top of the section. */
export function onlineEditingStatus(
  t: Strings["settings"]["onlineEditing"],
  editing: OnlineEditing | undefined,
  keySaved: Readonly<ProviderKeyStatus>,
): string {
  if (!editing) return t.notSetUp;
  const name = PROVIDER_NAMES[editing.provider];
  const status = t.status(name, editing.model);
  return keySaved[editing.provider] ? status : `${status} ${t.needsKey(name)}`;
}

/**
 * Catalog models whose id or name contains the query, ignoring case. The
 * model field doubles as the filter, so an empty query lists the first ones.
 */
export function filterModels(
  models: readonly CatalogModel[],
  query: string,
  limit: number = MODEL_LIST_LIMIT,
): CatalogModel[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? models.filter(
        (model) =>
          model.id.toLowerCase().includes(q) ||
          model.name.toLowerCase().includes(q),
      )
    : models;
  return matches.slice(0, limit);
}

/**
 * The choice to store when the user picks a model, or undefined for a model
 * id that isn't valid. "Send without asking" carries over only within the
 * same provider: a new provider is a new third party, so it asks again.
 */
export function chooseModel(
  current: OnlineEditing | undefined,
  provider: OnlineProvider,
  model: string,
): OnlineEditing | undefined {
  const id = model.trim();
  if (!isValidModelId(id)) return undefined;
  return {
    provider,
    model: id,
    alwaysAllow: current?.provider === provider && current.alwaysAllow,
  };
}
