import type { Platform } from "./driver.js";
import { decodeXmlEntities, KNOWN_ROLES, nodesForRole } from "./source.js";

/**
 * Selector discovery for `nativeproof inspect`: turn a live page source into the
 * candidate locators a spec author would write, most semantic first — the authoring-time
 * counterpart of the did-you-mean failure hint, so nobody reads XML and guesses strings.
 */

const MAX_VALUE_LENGTH = 60;

function attributeValues(node: string, attribute: string): string[] {
  // The lookbehind keeps whole attribute names: `value=` must not read `placeholderValue=`.
  return [...node.matchAll(new RegExp(`(?<![\\w-])${attribute}="([^"]*)"`, "g"))]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter((value) => value !== "" && value.length <= MAX_VALUE_LENGTH);
}

function isInputNode(node: string, platform: Platform): boolean {
  return platform === "ios"
    ? /\btype="XCUIElementType(?:TextField|SecureTextField|SearchField|TextView)"/.test(node)
    : /(?:EditText|AutoCompleteTextView|SearchView)/.test(node);
}

function accessibleNameValues(node: string, platform: Platform): string[] {
  const labelAttribute = platform === "ios" ? "label" : "content-desc";
  const stateAttribute = platform === "ios" ? "value" : "text";
  return [
    ...attributeValues(node, labelAttribute),
    ...(isInputNode(node, platform) ? [] : attributeValues(node, stateAttribute)),
  ];
}

function textValuesForNode(node: string, platform: Platform): string[] {
  const stateAttribute = platform === "ios" ? "value" : "text";
  const attributes = platform === "ios" ? ["label", "value"] : ["text", "content-desc"];
  return attributes.flatMap((attribute) =>
    isInputNode(node, platform) && attribute === stateAttribute ? [] : attributeValues(node, attribute),
  );
}

/**
 * Candidate `native.*` locators for everything the current screen exposes, in the order a
 * reader should prefer them: semantic roles (with accessible names), then visible text —
 * exactly the alternation `getByText` matches — then test ids. Deduplicated verbatim.
 */
export function selectorSuggestions(source: string, platform: Platform): string[] {
  const suggestions = new Set<string>();

  for (const role of KNOWN_ROLES) {
    for (const node of nodesForRole(source, role, platform)) {
      const [name] = accessibleNameValues(node, platform);
      suggestions.add(
        name
          ? `native.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`
          : `native.getByRole(${JSON.stringify(role)})`,
      );
    }
  }

  const nodes = [...source.matchAll(/<[^>]*>/g)].map((match) => match[0]);
  for (const node of nodes) {
    for (const text of textValuesForNode(node, platform)) {
      suggestions.add(`native.getByText(${JSON.stringify(text)})`);
    }
  }
  for (const node of nodes) {
    const labels = new Set(textValuesForNode(node, platform));
    for (const id of attributeValues(node, platform === "ios" ? "name" : "resource-id")) {
      // An iOS `name` that just mirrors the label adds nothing over getByText.
      if (platform === "ios" && labels.has(id)) continue;
      suggestions.add(`native.getByTestId(${JSON.stringify(id)})`);
    }
  }

  return [...suggestions];
}
