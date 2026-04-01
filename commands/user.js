import { createUser, setUserPassword } from "../server/lib/auth/manage-users.js";

function takeFlagValue(args, index, flagName) {
  const value = String(args[index + 1] || "");

  if (!value) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return value;
}

function parseCreateArgs(args) {
  const options = {
    force: false,
    password: "",
    username: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!options.username && !arg.startsWith("--")) {
      options.username = arg;
      continue;
    }

    if (arg === "--password") {
      options.password = takeFlagValue(args, index, "--password");
      index += 1;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown user create argument: ${arg}`);
  }

  if (!options.username || !options.password) {
    throw new Error("Usage: node A1.js user create <username> --password <password> [--force]");
  }

  return options;
}

function parsePasswordArgs(args) {
  const options = {
    password: "",
    username: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!options.username && !arg.startsWith("--")) {
      options.username = arg;
      continue;
    }

    if (arg === "--password") {
      options.password = takeFlagValue(args, index, "--password");
      index += 1;
      continue;
    }

    throw new Error(`Unknown user password argument: ${arg}`);
  }

  if (!options.username || !options.password) {
    throw new Error("Usage: node A1.js user password <username> --password <password>");
  }

  return options;
}

export const help = {
  name: "user",
  summary: "Manage L2 users and passwords.",
  usage: [
    "node A1.js user create <username> --password <password> [--force]",
    "node A1.js user password <username> --password <password>"
  ],
  description:
    "Creates L2 users, rewrites their SCRAM password verifier in user.yaml, and clears existing login sessions in logins.json when the password changes.",
  options: [
    {
      flag: "create",
      description: "Create a user directory with user.yaml, logins.json, and mod/."
    },
    {
      flag: "password",
      description: "Reset a user's password and clear existing sessions."
    },
    {
      flag: "--password <password>",
      description: "Password used for create or password subcommands."
    },
    {
      flag: "--force",
      description: "Replace the full user directory during create."
    }
  ]
};

export async function execute(context) {
  const subcommand = String(context.args[0] || "").trim().toLowerCase();
  const subcommandArgs = context.args.slice(1);

  if (subcommand === "create") {
    const options = parseCreateArgs(subcommandArgs);
    const result = createUser(context.projectRoot, options.username, options.password, {
      force: options.force
    });
    console.log(`Created user ${result.username}`);
    return 0;
  }

  if (subcommand === "password" || subcommand === "passwd") {
    const options = parsePasswordArgs(subcommandArgs);
    const result = setUserPassword(context.projectRoot, options.username, options.password);
    console.log(`Updated password for ${result.username}`);
    return 0;
  }

  throw new Error(
    'Unknown user subcommand. Use "node A1.js help user" for available subcommands.'
  );
}
