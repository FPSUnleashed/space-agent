import {
  addGroupEntry,
  createGroup,
  normalizeLayer,
  removeGroupEntry
} from "../server/lib/customware/group-files.js";

function takeFlagValue(args, index, flagName) {
  const value = String(args[index + 1] || "");

  if (!value) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return value;
}

function normalizeEntryType(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "user" || normalized === "users") {
    return "user";
  }

  if (normalized === "group" || normalized === "groups") {
    return "group";
  }

  return "";
}

function parseLayerFlag(value) {
  const layer = normalizeLayer(value);

  if (!layer) {
    throw new Error("Group layer must be L0 or L1.");
  }

  return layer;
}

function parseCreateArgs(args) {
  const options = {
    force: false,
    groupId: "",
    layer: "L1"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!options.groupId && !arg.startsWith("--")) {
      options.groupId = arg;
      continue;
    }

    if (arg === "--layer") {
      options.layer = parseLayerFlag(takeFlagValue(args, index, "--layer"));
      index += 1;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown group create argument: ${arg}`);
  }

  if (!options.groupId) {
    throw new Error("Usage: node A1.js group create <group-id> [--layer L0|L1] [--force]");
  }

  return options;
}

function parseMembershipArgs(args, verb) {
  const options = {
    entryId: "",
    entryType: "",
    groupId: "",
    layer: "L1",
    manager: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!options.groupId && !arg.startsWith("--")) {
      options.groupId = arg;
      continue;
    }

    if (!options.entryType && !arg.startsWith("--")) {
      options.entryType = normalizeEntryType(arg);
      if (!options.entryType) {
        throw new Error(`Unsupported group entry type: ${arg}`);
      }
      continue;
    }

    if (!options.entryId && !arg.startsWith("--")) {
      options.entryId = arg;
      continue;
    }

    if (arg === "--layer") {
      options.layer = parseLayerFlag(takeFlagValue(args, index, "--layer"));
      index += 1;
      continue;
    }

    if (arg === "--manager") {
      options.manager = true;
      continue;
    }

    throw new Error(`Unknown group ${verb} argument: ${arg}`);
  }

  if (!options.groupId || !options.entryType || !options.entryId) {
    throw new Error(
      `Usage: node A1.js group ${verb} <group-id> <user|group> <id> [--manager] [--layer L0|L1]`
    );
  }

  return options;
}

function describeRole(options) {
  return options.manager ? "manager" : "member";
}

export const help = {
  name: "group",
  summary: "Manage group directories and membership relations.",
  usage: [
    "node A1.js group create <group-id> [--layer L0|L1] [--force]",
    "node A1.js group add <group-id> <user|group> <id> [--manager] [--layer L0|L1]",
    "node A1.js group remove <group-id> <user|group> <id> [--manager] [--layer L0|L1]"
  ],
  description:
    "Creates group directories and updates group.yaml so groups can include users, include other groups, and declare managers that are users or groups.",
  options: [
    {
      flag: "create",
      description: "Create a group directory with mod/ and group.yaml."
    },
    {
      flag: "add",
      description: "Add a user or group as a member or manager of the target group."
    },
    {
      flag: "remove",
      description: "Remove a user or group from the member or manager list of the target group."
    },
    {
      flag: "--manager",
      description: "Target the managing_users or managing_groups list instead of included_users or included_groups."
    },
    {
      flag: "--layer <L0|L1>",
      description: "Target group layer. Defaults to L1."
    },
    {
      flag: "--force",
      description: "Replace the full group directory during create."
    }
  ]
};

export async function execute(context) {
  const subcommand = String(context.args[0] || "").trim().toLowerCase();
  const subcommandArgs = context.args.slice(1);

  if (subcommand === "create") {
    const options = parseCreateArgs(subcommandArgs);
    const result = createGroup(context.projectRoot, options.layer, options.groupId, {
      force: options.force
    });
    console.log(`Created group ${result.layer}/${result.groupId}`);
    return 0;
  }

  if (subcommand === "add") {
    const options = parseMembershipArgs(subcommandArgs, "add");
    addGroupEntry(
      context.projectRoot,
      options.layer,
      options.groupId,
      options.entryType,
      options.entryId,
      {
        manager: options.manager
      }
    );
    console.log(
      `Added ${options.entryType} ${options.entryId} as ${describeRole(options)} of ${options.layer}/${options.groupId}`
    );
    return 0;
  }

  if (subcommand === "remove") {
    const options = parseMembershipArgs(subcommandArgs, "remove");
    removeGroupEntry(
      context.projectRoot,
      options.layer,
      options.groupId,
      options.entryType,
      options.entryId,
      {
        manager: options.manager
      }
    );
    console.log(
      `Removed ${options.entryType} ${options.entryId} from ${describeRole(options)} list of ${options.layer}/${options.groupId}`
    );
    return 0;
  }

  throw new Error(
    'Unknown group subcommand. Use "node A1.js help group" for available subcommands.'
  );
}
