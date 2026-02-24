export type ParameterValue = number | boolean | string;
export type ParameterValues = Record<string, ParameterValue>;

export type ParameterVisibilityRule = {
  key: string;
  equals: ParameterValue | ParameterValue[];
};

type ParameterBase<TypeName extends string, Value> = {
  key: string;
  label: string;
  type: TypeName;
  defaultValue: Value;
  tab: string;
  category: string;
  visibleWhen?: ParameterVisibilityRule[];
};

export type NumberParameterDefinition = ParameterBase<"number", number> & {
  min: number;
  max: number;
  step: number;
};

export type BooleanParameterDefinition = ParameterBase<"boolean", boolean>;

export type ColorParameterDefinition = ParameterBase<"color", string>;

export type SelectParameterDefinition = ParameterBase<"select", string> & {
  options: Array<{
    label: string;
    value: string;
  }>;
};

export type ParameterDefinition =
  | NumberParameterDefinition
  | BooleanParameterDefinition
  | ColorParameterDefinition
  | SelectParameterDefinition;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const coerceParameterValue = (
  definition: ParameterDefinition,
  value: unknown,
): ParameterValue => {
  if (definition.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return definition.defaultValue;
    }

    return clamp(value, definition.min, definition.max);
  }

  if (definition.type === "boolean") {
    return typeof value === "boolean" ? value : definition.defaultValue;
  }

  if (definition.type === "select") {
    if (typeof value !== "string") {
      return definition.defaultValue;
    }

    return definition.options.some((option) => option.value === value)
      ? value
      : definition.defaultValue;
  }

  return typeof value === "string" ? value : definition.defaultValue;
};

const matchesVisibilityRule = (
  values: ParameterValues,
  rule: ParameterVisibilityRule,
): boolean => {
  const actualValue = values[rule.key];
  if (Array.isArray(rule.equals)) {
    return rule.equals.includes(actualValue);
  }

  return actualValue === rule.equals;
};

export const isParameterVisible = (
  definition: ParameterDefinition,
  values: ParameterValues,
): boolean => {
  if (!definition.visibleWhen || definition.visibleWhen.length === 0) {
    return true;
  }

  return definition.visibleWhen.every((rule) =>
    matchesVisibilityRule(values, rule),
  );
};

export const resolveParameterValues = (
  schema: ParameterDefinition[],
  storedValues: Record<string, unknown> | null | undefined,
): ParameterValues => {
  const values: ParameterValues = {};

  for (const definition of schema) {
    values[definition.key] = coerceParameterValue(
      definition,
      storedValues?.[definition.key],
    );
  }

  return values;
};

export const readNumber = (
  values: ParameterValues,
  key: string,
  fallback: number,
): number => {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const readBoolean = (
  values: ParameterValues,
  key: string,
  fallback: boolean,
): boolean => {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
};

export const readString = (
  values: ParameterValues,
  key: string,
  fallback: string,
): string => {
  const value = values[key];
  return typeof value === "string" ? value : fallback;
};
