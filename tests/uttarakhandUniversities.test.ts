import { describe, expect, it } from "vitest";
import { universities } from "../data";
import {
  getUttarakhandUniversityDirectory,
  uttarakhandUniversitySourceCount,
} from "../data/uttarakhandUniversities";

describe("Uttarakhand university directory import", () => {
  it("adds the 23 institutions not already in the catalog and enriches the existing UPES entry", () => {
    const catalog = [...universities];
    const imported = getUttarakhandUniversityDirectory(catalog);
    const combined = [...catalog, ...imported];
    const directoryOnly = combined.filter((university) => university.directoryProfile?.directoryOnly);
    const upes = combined.find((university) => university.website?.includes("upes.ac.in"));

    expect(uttarakhandUniversitySourceCount).toBe(24);
    expect(directoryOnly).toHaveLength(23);
    expect(upes?.directoryProfile?.sourceName).toContain("University of Petroleum and Energy Studies");
    expect(combined).toHaveLength(27);
  });

  it("uses unique IDs and provides the source fields without inventing outcome metrics", () => {
    const catalog = [...universities];
    const combined = [...catalog, ...getUttarakhandUniversityDirectory(catalog)];
    expect(new Set(combined.map((university) => university.id)).size).toBe(combined.length);

    const directoryEntries = combined.filter((university) => university.directoryProfile?.directoryOnly);
    for (const university of directoryEntries) {
      expect(university.directoryProfile?.sourceNote).toContain("user-provided");
      expect(university.directoryProfile?.courses).not.toBe("");
      expect(university.directoryProfile?.feeRange).not.toBe("");
      expect(university.rating).toBe(0);
      expect(university.avgPlacementLPA).toBe(0);
    }
  });

  it("does not duplicate records when the client directory and API catalog both load", () => {
    const firstLoad = [...universities];
    const imported = getUttarakhandUniversityDirectory(firstLoad);
    const combined = [...firstLoad, ...imported];

    expect(getUttarakhandUniversityDirectory(combined)).toEqual([]);
    expect(combined).toHaveLength(27);
  });
});
