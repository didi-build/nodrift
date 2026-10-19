import { readFileSync } from "node:fs";
import { parse as parseYaml, stringify } from "yaml";
import type { DataMap, OtherItem } from "../src/data-map/types.js";

/**
 * Test-only overlay: adds `binding:` on items that clearly match we-met Wrangler
 * bindings, plus labeled test-only rows for D1 and Images.
 */
export function weMetGroupedMapWithBindingOverlay(groupedYamlPath: string): string {
  const text = readFileSync(groupedYamlPath, "utf8");
  const doc = parseYaml(text) as DataMap;

  const byId = new Map(doc.other_items.map((item) => [item.id, item]));

  const queueFollowup = byId.get("queue.visitor_followup");
  if (queueFollowup) {
    queueFollowup.binding = "WE_MET_FOLLOWUP_EMAIL_QUEUE";
  }

  const r2Photo = byId.get("storage.r2.card_photo");
  if (r2Photo) {
    r2Photo.binding = "WE_MET_ASSETS";
  }

  const testOnly: OtherItem[] = [
    {
      id: "d1.we_met_db",
      binding: "WE_MET_DB",
      whose: "operational",
      data: "TEST-ONLY overlay row for Check 2 fixture",
      purpose: "document D1 binding in tests",
      processors: ["Cloudflare"],
      retention: "TEST-ONLY",
      notes: "TEST-ONLY Check 2 overlay; not part of the grouped equivalence fixture",
    },
    {
      id: "images.images",
      binding: "IMAGES",
      whose: "operational",
      data: "TEST-ONLY overlay row for Check 2 fixture",
      purpose: "document Images binding in tests",
      processors: ["Cloudflare"],
      retention: "TEST-ONLY",
      notes: "TEST-ONLY Check 2 overlay; not part of the grouped equivalence fixture",
    },
  ];

  doc.other_items.push(...testOnly);

  return stringify(doc);
}
