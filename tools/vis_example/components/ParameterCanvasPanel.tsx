import { useState } from "react";
import {
  isParameterVisible,
  type ParameterDefinition,
  type ParameterValues,
} from "../types/parameters";

type ParameterCanvasPanelProps = {
  schema: ParameterDefinition[];
  values: ParameterValues;
  onChange: (key: string, value: string | number | boolean) => void;
};

const formatNumber = (value: number): string => {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
};

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
};

const isValidHexColor = (value: string): boolean => {
  return /^#([0-9A-Fa-f]{6})$/.test(value);
};

const groupDefinitions = (
  definitions: ParameterDefinition[],
): Array<{ category: string; items: ParameterDefinition[] }> => {
  const grouped = new Map<string, ParameterDefinition[]>();

  for (const definition of definitions) {
    const current = grouped.get(definition.category) ?? [];
    current.push(definition);
    grouped.set(definition.category, current);
  }

  return Array.from(grouped.entries()).map(([category, items]) => ({
    category,
    items,
  }));
};

export function ParameterCanvasPanel({
  schema,
  values,
  onChange,
}: ParameterCanvasPanelProps) {
  const tabNames = unique(schema.map((definition) => definition.tab));
  const defaultTab = tabNames.includes("Renderer")
    ? "Renderer"
    : (tabNames[0] ?? "Parameters");
  const [selectedTab, setSelectedTab] = useState<string>(defaultTab);
  const activeTab = tabNames.includes(selectedTab) ? selectedTab : defaultTab;
  const tabDefinitions = schema.filter(
    (definition) =>
      definition.tab === activeTab && isParameterVisible(definition, values),
  );
  const categories = groupDefinitions(tabDefinitions);

  return (
    <section className="parameter-canvas">
      <header className="parameter-canvas__header">
        <h2>Parameter Canvas</h2>
        <p>Tune ranges and combinations in realtime.</p>
      </header>

      {tabNames.length > 1 ? (
        <div className="parameter-tabs" role="tablist" aria-label="Parameter tabs">
          {tabNames.map((tabName) => (
            <button
              key={tabName}
              type="button"
              role="tab"
              className={
                tabName === activeTab
                  ? "parameter-tabs__button parameter-tabs__button--active"
                  : "parameter-tabs__button"
              }
              aria-selected={tabName === activeTab}
              onClick={() => {
                setSelectedTab(tabName);
              }}
            >
              {tabName}
            </button>
          ))}
        </div>
      ) : null}

      {categories.map((category) => (
        <div className="parameter-group" key={category.category}>
          <h3>{category.category}</h3>
          {category.items.map((definition) => {
            const value = values[definition.key];

            if (definition.type === "number") {
              const numericValue =
                typeof value === "number" ? value : definition.defaultValue;

              return (
                <label className="parameter-row" key={definition.key}>
                  <span className="parameter-row__label">
                    {definition.label}
                    <strong>{formatNumber(numericValue)}</strong>
                  </span>
                  <div className="parameter-row__number">
                    <input
                      type="range"
                      min={definition.min}
                      max={definition.max}
                      step={definition.step}
                      value={numericValue}
                      onChange={(event) => {
                        onChange(definition.key, Number(event.target.value));
                      }}
                    />
                    <input
                      type="number"
                      min={definition.min}
                      max={definition.max}
                      step={definition.step}
                      value={numericValue}
                      onChange={(event) => {
                        onChange(definition.key, Number(event.target.value));
                      }}
                    />
                  </div>
                </label>
              );
            }

            if (definition.type === "boolean") {
              const boolValue =
                typeof value === "boolean" ? value : definition.defaultValue;

              return (
                <label
                  className="parameter-row parameter-row--boolean"
                  key={definition.key}
                >
                  <span className="parameter-row__label">{definition.label}</span>
                  <input
                    type="checkbox"
                    checked={boolValue}
                    onChange={(event) => {
                      onChange(definition.key, event.target.checked);
                    }}
                  />
                </label>
              );
            }

            if (definition.type === "select") {
              const selectedValue =
                typeof value === "string" ? value : definition.defaultValue;

              return (
                <label className="parameter-row" key={definition.key}>
                  <span className="parameter-row__label">{definition.label}</span>
                  <select
                    value={selectedValue}
                    onChange={(event) => {
                      onChange(definition.key, event.target.value);
                    }}
                  >
                    {definition.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            const colorValue =
              typeof value === "string" ? value : definition.defaultValue;
            const colorInputValue = isValidHexColor(colorValue)
              ? colorValue
              : definition.defaultValue;

            return (
              <label className="parameter-row" key={definition.key}>
                <span className="parameter-row__label">{definition.label}</span>
                <div className="parameter-row__color">
                  <input
                    type="color"
                    value={colorInputValue}
                    onChange={(event) => {
                      onChange(definition.key, event.target.value);
                    }}
                  />
                  <input
                    type="text"
                    value={colorValue}
                    onChange={(event) => {
                      onChange(definition.key, event.target.value);
                    }}
                  />
                </div>
              </label>
            );
          })}
        </div>
      ))}
    </section>
  );
}
