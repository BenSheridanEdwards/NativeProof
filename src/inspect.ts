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

/**
 * Candidate `native.*` locators for everything the current screen exposes, in the order a
 * reader should prefer them: semantic roles (with accessible names), then visible text —
 * exactly the alternation `getByText` matches — then test ids. Deduplicated verbatim.
 */
export function selectorSuggestions(source: string, platform: Platform): string[] {
  const suggestions = new Set<string>();

  for (const role of KNOWN_ROLES) {
    for (const node of nodesForRole(source, role, platform)) {
      const [name] = [
        ...attributeValues(node, platform === "ios" ? "label" : "content-desc"),
        ...attributeValues(node, platform === "ios" ? "value" : "text"),
      ];
      suggestions.add(
        name
          ? `native.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`
          : `native.getByRole(${JSON.stringify(role)})`,
      );
    }
  }

  const nodes = [...source.matchAll(/<[^>]*>/g)].map((match) => match[0]);
  const textAttributes = platform === "ios" ? ["label", "value"] : ["text", "content-desc"];
  for (const node of nodes) {
    for (const attribute of textAttributes) {
      for (const text of attributeValues(node, attribute)) {
        suggestions.add(`native.getByText(${JSON.stringify(text)})`);
      }
    }
  }
  for (const node of nodes) {
    const labels = new Set(textAttributes.flatMap((attribute) => attributeValues(node, attribute)));
    for (const id of attributeValues(node, platform === "ios" ? "name" : "resource-id")) {
      // An iOS `name` that just mirrors the label adds nothing over getByText.
      if (platform === "ios" && labels.has(id)) continue;
      suggestions.add(`native.getByTestId(${JSON.stringify(id)})`);
    }
  }

  return [...suggestions];
}
