/**
 * Versioned content-pack loader, validation, and scenario integration helpers.
 * Mirrors engine/io/content_pack_loader.py
 */

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class ContentPackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentPackValidationError";
  }
}

export class ContentPackResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentPackResolutionError";
  }
}

function require(condition: boolean, message: string): void {
  if (!condition) throw new ContentPackValidationError(message);
}

function requireResolution(condition: boolean, message: string): void {
  if (!condition) throw new ContentPackResolutionError(message);
}

export interface ContentPackEntry {
  id: string;
  kind: string;
  sourceRef?: string;
  tags: string[];
  payload: Record<string, unknown>;
}

export interface ContentPackCompatibility {
  minEnginePhase: number;
  maxEnginePhase: number;
  featureTags: string[];
}

export interface ContentPack {
  packId: string;
  version: string;
  compatibility: ContentPackCompatibility;
  entries: ContentPackEntry[];
}

export interface ContentPackMetadata {
  packId: string;
  version: string;
  entryCount: number;
  compatibility: ContentPackCompatibility;
}

export interface ContentContext {
  selectedPackId: string | null;
  packs: ContentPackMetadata[];
  entryLookup: Record<string, ResolvedEntry>;
}

export interface ResolvedEntry {
  packId: string;
  kind: string;
  sourceRef: string | null;
  tags: string[];
  payload: Record<string, unknown>;
}

export function validateContentPack(data: unknown): void {
  require(typeof data === "object" && data !== null, "content pack must be object");
  const d = data as Record<string, unknown>;

  for (const key of ["pack_id", "version", "compatibility", "entries"]) {
    require(key in d, `content pack missing key: ${key}`);
  }

  const packId = d["pack_id"];
  require(typeof packId === "string" && Boolean(packId), "pack_id must be non-empty string");

  const version = d["version"];
  require(
    typeof version === "string" && SEMVER_RE.test(version),
    "version must be semver string MAJOR.MINOR.PATCH",
  );

  const compatibility = d["compatibility"];
  require(typeof compatibility === "object" && compatibility !== null, "compatibility must be object");
  const compat = compatibility as Record<string, unknown>;
  const minPhase = compat["min_engine_phase"];
  const maxPhase = compat["max_engine_phase"];
  require(typeof minPhase === "number" && minPhase > 0, "compatibility.min_engine_phase must be positive int");
  require(typeof maxPhase === "number" && maxPhase > 0, "compatibility.max_engine_phase must be positive int");
  require(Number(minPhase) <= Number(maxPhase), "compatibility min_engine_phase cannot exceed max_engine_phase");

  const featureTags = compat["feature_tags"] ?? [];
  require(Array.isArray(featureTags), "compatibility.feature_tags must be list");

  const entries = d["entries"];
  require(Array.isArray(entries) && (entries as unknown[]).length > 0, "entries must be non-empty list");
  const seenIds = new Set<string>();
  const allowedKinds = new Set(["action", "spell", "feat", "item", "trait", "condition"]);
  for (let idx = 0; idx < (entries as unknown[]).length; idx++) {
    const entry = (entries as unknown[])[idx] as Record<string, unknown>;
    const ctx = `entries[${idx}]`;
    require(typeof entry === "object" && entry !== null, `${ctx} must be object`);
    for (const key of ["id", "kind", "payload"]) {
      require(key in entry, `${ctx} missing key: ${key}`);
    }
    const entryId = entry["id"];
    require(typeof entryId === "string" && Boolean(entryId), `${ctx}.id must be non-empty string`);
    require(!seenIds.has(entryId as string), `duplicate entry id: ${entryId}`);
    seenIds.add(entryId as string);
    const kind = entry["kind"];
    require(
      typeof kind === "string" && allowedKinds.has(kind),
      `${ctx}.kind invalid: ${kind}`,
    );
    require(typeof entry["payload"] === "object" && entry["payload"] !== null, `${ctx}.payload must be object`);
  }
}

export function parseContentPack(data: Record<string, unknown>): ContentPack {
  validateContentPack(data);
  const compat = data["compatibility"] as Record<string, unknown>;
  return {
    packId: String(data["pack_id"]),
    version: String(data["version"]),
    compatibility: {
      minEnginePhase: Number(compat["min_engine_phase"]),
      maxEnginePhase: Number(compat["max_engine_phase"]),
      featureTags: ((compat["feature_tags"] as string[]) ?? []).map(String),
    },
    entries: ((data["entries"] as Array<Record<string, unknown>>) ?? []).map((e) => ({
      id: String(e["id"]),
      kind: String(e["kind"]),
      sourceRef: e["source_ref"] ? String(e["source_ref"]) : undefined,
      tags: ((e["tags"] as string[]) ?? []).map(String),
      payload: { ...(e["payload"] as Record<string, unknown>) },
    })),
  };
}

export function contentPackSupportsPhase(pack: ContentPack, phase: number): boolean {
  return pack.compatibility.minEnginePhase <= phase && phase <= pack.compatibility.maxEnginePhase;
}

export function buildContentEntryLookup(
  packs: ContentPack[],
): Record<string, ResolvedEntry> {
  const lookup: Record<string, ResolvedEntry> = {};
  for (const pack of packs) {
    for (const entry of pack.entries) {
      requireResolution(!(entry.id in lookup), `duplicate entry id across packs: ${entry.id}`);
      lookup[entry.id] = {
        packId: pack.packId,
        kind: entry.kind,
        sourceRef: entry.sourceRef ?? null,
        tags: [...entry.tags],
        payload: { ...entry.payload },
      };
    }
  }
  // Return sorted by key like Python
  const sortedLookup: Record<string, ResolvedEntry> = {};
  for (const key of Object.keys(lookup).sort()) {
    sortedLookup[key] = lookup[key];
  }
  return sortedLookup;
}

/** Resolve scenario content context (async — loads packs from URLs) */
export async function resolveScenarioContentContext(
  scenario: Record<string, unknown>,
  enginePhase: number,
  baseUrl = "",
): Promise<ContentContext> {
  const rawPackPaths = (scenario["content_packs"] as string[]) ?? [];
  if (rawPackPaths.length === 0) {
    return { selectedPackId: null, packs: [], entryLookup: {} };
  }

  const loadedPacks: Record<string, ContentPack> = {};
  for (const rawPath of rawPackPaths) {
    const url = rawPath.startsWith("/") || rawPath.startsWith("http")
      ? rawPath
      : `${baseUrl}/${rawPath}`.replace(/\/+/g, "/");
    const response = await fetch(url);
    requireResolution(response.ok, `content pack path not found: ${rawPath}`);
    const data = await response.json() as Record<string, unknown>;
    const pack = parseContentPack(data);
    requireResolution(
      contentPackSupportsPhase(pack, enginePhase),
      `content pack ${pack.packId} incompatible with engine phase ${enginePhase}`,
    );
    requireResolution(!(pack.packId in loadedPacks), `duplicate content pack id: ${pack.packId}`);
    loadedPacks[pack.packId] = pack;
  }

  let selectedPackId = (scenario["content_pack_id"] as string) ?? null;
  if (selectedPackId === null && Object.keys(loadedPacks).length === 1) {
    selectedPackId = Object.keys(loadedPacks)[0];
  }
  if (selectedPackId !== null) {
    requireResolution(selectedPackId in loadedPacks, `scenario content_pack_id not loaded: ${selectedPackId}`);
  }

  const requiredFeatures = (scenario["required_content_features"] as string[]) ?? [];
  if (requiredFeatures.length > 0) {
    requireResolution(
      selectedPackId !== null,
      "required_content_features requires content_pack_id or exactly one loaded content pack",
    );
    const selected = loadedPacks[selectedPackId!];
    const featureTagSet = new Set(selected.compatibility.featureTags);
    const missing = requiredFeatures.filter((tag) => !featureTagSet.has(tag));
    requireResolution(
      missing.length === 0,
      `content pack ${selectedPackId} missing required feature tags: ${missing}`,
    );
  }

  const packsSorted = Object.keys(loadedPacks).sort().map((id) => loadedPacks[id]);
  const entryLookup = buildContentEntryLookup(packsSorted);

  const packsMetadata: ContentPackMetadata[] = packsSorted.map((pack) => ({
    packId: pack.packId,
    version: pack.version,
    entryCount: pack.entries.length,
    compatibility: pack.compatibility,
  }));

  return {
    selectedPackId,
    packs: packsMetadata,
    entryLookup,
  };
}

/** Synchronous variant for testing with pre-loaded JSON */
export function resolveContentContextSync(
  scenario: Record<string, unknown>,
  enginePhase: number,
  packDataList: Record<string, unknown>[],
): ContentContext {
  if (packDataList.length === 0) {
    return { selectedPackId: null, packs: [], entryLookup: {} };
  }

  const loadedPacks: Record<string, ContentPack> = {};
  for (const data of packDataList) {
    const pack = parseContentPack(data);
    requireResolution(
      contentPackSupportsPhase(pack, enginePhase),
      `content pack ${pack.packId} incompatible with engine phase ${enginePhase}`,
    );
    requireResolution(!(pack.packId in loadedPacks), `duplicate content pack id: ${pack.packId}`);
    loadedPacks[pack.packId] = pack;
  }

  let selectedPackId = (scenario["content_pack_id"] as string) ?? null;
  if (selectedPackId === null && Object.keys(loadedPacks).length === 1) {
    selectedPackId = Object.keys(loadedPacks)[0];
  }

  const packsSorted = Object.keys(loadedPacks).sort().map((id) => loadedPacks[id]);
  const entryLookup = buildContentEntryLookup(packsSorted);
  const packsMetadata: ContentPackMetadata[] = packsSorted.map((pack) => ({
    packId: pack.packId,
    version: pack.version,
    entryCount: pack.entries.length,
    compatibility: pack.compatibility,
  }));

  return { selectedPackId, packs: packsMetadata, entryLookup };
}
