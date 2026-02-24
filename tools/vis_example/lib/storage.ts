import { resolveParameterValues, type ParameterDefinition } from "../types/parameters";

const PARAM_STATE_KEY = "viztester.params.shared";
const UI_STATE_KEY = "viztester.ui";

const canUseStorage = (): boolean => {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
};

export const loadParameterValues = (
  schema: ParameterDefinition[],
): Record<string, string | number | boolean> => {
  if (!canUseStorage()) {
    return resolveParameterValues(schema, null);
  }

  try {
    const raw = window.localStorage.getItem(PARAM_STATE_KEY);
    if (!raw) {
      return resolveParameterValues(schema, null);
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return resolveParameterValues(schema, parsed);
  } catch {
    return resolveParameterValues(schema, null);
  }
};

export const saveParameterValues = (
  values: Record<string, string | number | boolean>,
): void => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(PARAM_STATE_KEY, JSON.stringify(values));
};

export type PersistedUiState = {
  volume: number;
};

export const loadUiState = (): PersistedUiState | null => {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PersistedUiState;
  } catch {
    return null;
  }
};

export const saveUiState = (state: PersistedUiState): void => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
};
