/**
 * Browser-facing command-authoring helpers for content-entry driven commands.
 * Mirrors engine/io/command_authoring.py
 */

import { ContentContext } from "./contentPackLoader";

export const TEMPLATE_COMMAND_TYPES = ["cast_spell", "use_feat", "use_item", "interact"] as const;
export type TemplateCommandType = typeof TEMPLATE_COMMAND_TYPES[number];

export class CommandAuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandAuthoringError";
  }
}

function require(condition: boolean, message: string): void {
  if (!condition) throw new CommandAuthoringError(message);
}

export interface ContentEntryOption {
  entryId: string;
  commandType: string;
  kind: string;
  packId: string;
  sourceRef: string | null;
  tags: string[];
}

export function listContentEntryOptions(
  contentContext: ContentContext,
  commandType?: string,
): ContentEntryOption[] {
  if (commandType !== undefined) {
    require(
      TEMPLATE_COMMAND_TYPES.includes(commandType as TemplateCommandType),
      `unsupported command_type filter: ${commandType}`,
    );
  }

  const out: ContentEntryOption[] = [];
  for (const entryId of Object.keys(contentContext.entryLookup).sort()) {
    const entry = contentContext.entryLookup[entryId];
    const templateType = String(entry.payload["command_type"] ?? "");
    if (!TEMPLATE_COMMAND_TYPES.includes(templateType as TemplateCommandType)) continue;
    if (commandType !== undefined && templateType !== commandType) continue;
    out.push({
      entryId,
      commandType: templateType,
      kind: entry.kind,
      packId: entry.packId,
      sourceRef: entry.sourceRef,
      tags: [...entry.tags],
    });
  }
  return out;
}

export interface CommandIntent {
  actor: string;
  commandType: string;
  contentEntryId: string;
  sourcePackId: string;
  command: Record<string, unknown>;
}

export function buildUiCommandIntent(
  contentContext: ContentContext,
  opts: {
    actor: string;
    commandType: string;
    contentEntryId: string;
    target?: string | null;
    dc?: number | null;
    overrides?: Record<string, unknown> | null;
  },
): CommandIntent {
  require(typeof opts.actor === "string" && Boolean(opts.actor), "actor must be non-empty string");
  require(
    TEMPLATE_COMMAND_TYPES.includes(opts.commandType as TemplateCommandType),
    `unsupported command_type: ${opts.commandType}`,
  );
  require(
    typeof opts.contentEntryId === "string" && Boolean(opts.contentEntryId),
    "content_entry_id must be non-empty string",
  );

  const entry = contentContext.entryLookup[opts.contentEntryId];
  require(entry !== undefined, `unknown content entry ${opts.contentEntryId}`);
  const payload = { ...entry.payload };
  const templateType = String(payload["command_type"] ?? "");
  require(
    templateType === opts.commandType,
    `command_type mismatch: ${templateType} != ${opts.commandType}`,
  );

  const command: Record<string, unknown> = {
    type: opts.commandType,
    actor: opts.actor,
    content_entry_id: opts.contentEntryId,
  };

  if (opts.commandType === "cast_spell") {
    require(
      typeof opts.target === "string" && Boolean(opts.target),
      "cast_spell intent requires target",
    );
    require(
      typeof opts.dc === "number" && opts.dc > 0,
      "cast_spell intent requires positive dc",
    );
    command["target"] = opts.target;
    command["dc"] = opts.dc;
  } else if (opts.commandType === "use_feat" || opts.commandType === "use_item") {
    command["target"] = opts.target ?? opts.actor;
  } else if (opts.commandType === "interact") {
    command["target"] = opts.target ?? opts.actor;
  }

  if (opts.overrides) {
    require(typeof opts.overrides === "object", "overrides must be object when present");
    if ("type" in opts.overrides) {
      require(
        String(opts.overrides["type"]) === opts.commandType,
        "overrides.type cannot change command type",
      );
    }
    if ("actor" in opts.overrides) {
      require(
        String(opts.overrides["actor"]) === opts.actor,
        "overrides.actor cannot change actor",
      );
    }
    Object.assign(command, opts.overrides);
  }

  if (opts.commandType === "cast_spell") {
    require(
      typeof command["target"] === "string" && Boolean(command["target"]),
      "cast_spell target must be non-empty string",
    );
    require(
      typeof command["dc"] === "number" && Number(command["dc"]) > 0,
      "cast_spell dc must be positive int",
    );
  } else if (opts.commandType === "use_feat" || opts.commandType === "use_item") {
    require(
      typeof command["target"] === "string" && Boolean(command["target"]),
      `${opts.commandType} target must be non-empty string`,
    );
  }

  return {
    actor: opts.actor,
    commandType: opts.commandType,
    contentEntryId: opts.contentEntryId,
    sourcePackId: entry.packId,
    command,
  };
}

export interface CommandAuthoringCatalog {
  templateCommandTypes: string[];
  options: ContentEntryOption[];
}

export function buildCommandAuthoringCatalog(
  contentContext: ContentContext,
): CommandAuthoringCatalog {
  return {
    templateCommandTypes: [...TEMPLATE_COMMAND_TYPES],
    options: listContentEntryOptions(contentContext),
  };
}
