import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const PROJECT_ROOT = path.join(CURRENT_DIR, "..");
const APP_ROOT_DIR = path.join(CURRENT_DIR, "..", "app");
const L0_DIR = path.join(APP_ROOT_DIR, "L0");
const L1_DIR = path.join(APP_ROOT_DIR, "L1");
const L2_DIR = path.join(APP_ROOT_DIR, "L2");
const APP_DIR = L0_DIR;
const ASSET_DIR = path.join(L0_DIR, "assets");
const API_DIR = path.join(CURRENT_DIR, "api");
const PAGES_DIR = path.join(CURRENT_DIR, "pages");
const FILE_WATCH_CONFIG_PATH = path.join(CURRENT_DIR, "lib", "file-watch", "config.yaml");

export {
  API_DIR,
  APP_ROOT_DIR,
  ASSET_DIR,
  APP_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  FILE_WATCH_CONFIG_PATH,
  L0_DIR,
  L1_DIR,
  L2_DIR,
  PAGES_DIR,
  PROJECT_ROOT
};
