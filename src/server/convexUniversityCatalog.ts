import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { UniversityDb } from "../db/types";
import { resolveConvexDeploymentTarget } from "./convexDeploymentTarget";

type UniversityPage = FunctionReturnType<typeof api.universities.list>;
type ConvexUniversity = UniversityPage["page"][number];

const clients = new Map<string, ConvexHttpClient>();

export function useConvexUniversityCatalog(): boolean {
  return process.env.UNIINFO_CATALOG_BACKEND === "convex";
}

export function resetConvexUniversityCatalogClientCache(): void {
  clients.clear();
}

function getClient(): ConvexHttpClient {
  const deployment = process.env.UNIINFO_CONVEX_DEPLOYMENT?.trim();
  const url = process.env.UNIINFO_CONVEX_URL?.trim();
  if (!deployment || !url) {
    throw new Error("UniInfo Convex catalog requires an explicitly configured deployment and URL.");
  }

  const target = resolveConvexDeploymentTarget({
    deploymentName: deployment,
    url,
    role: "catalog-read",
  });
  let client = clients.get(target.url);
  if (!client) {
    client = new ConvexHttpClient(target.url, { logger: false });
    clients.set(target.url, client);
  }
  return client;
}

function toUniversity(record: ConvexUniversity): UniversityDb {
  return {
    ...record,
    logo: record.logo ?? null,
    website: record.website ?? null,
    virtualTourUrl: record.virtualTourUrl ?? null,
    expertInsight: record.expertInsight ?? null,
    alumniStories: record.alumniStories ?? null,
    campusMap: record.campusMap ?? null,
    directoryProfile: record.directoryProfile ?? null,
    createdAt: new Date(record.createdAt),
  };
}

export async function getConvexUniversities(query?: { search?: string }): Promise<UniversityDb[]> {
  const convex = getClient();
  const records: ConvexUniversity[] = [];
  let cursor: string | null = null;

  // ponytail: preserve PostgreSQL substring search semantics; move filtering into Convex if full-catalogue reads become costly.
  while (true) {
    const page = await convex.query(api.universities.list, {
      paginationOpts: { numItems: 100, cursor },
    });
    records.push(...page.page);
    if (page.isDone) break;
    if (!page.continueCursor || page.continueCursor === cursor) {
      throw new Error("UniInfo Convex catalog pagination did not advance.");
    }
    cursor = page.continueCursor;
  }

  const universities = records.map(toUniversity);
  const search = query?.search?.trim().toLowerCase();
  if (!search) return universities;

  return universities.filter((university) => {
    const profile = university.directoryProfile;
    return [
      university.name,
      university.location,
      typeof profile?.courses === "string" ? profile.courses : "",
      typeof profile?.sourceName === "string" ? profile.sourceName : "",
    ].some((value) => value.toLowerCase().includes(search));
  });
}

export async function getConvexUniversityById(id: number): Promise<UniversityDb | null> {
  const university = await getClient().query(api.universities.getByLegacyId, { legacyId: id });
  return university ? toUniversity(university) : null;
}
