import type { PartyRoom } from "./index";
import type { RoomDirectory } from "./registry";
import type { AdminAuth } from "./admin";

export interface Env {
  PARTY: DurableObjectNamespace<PartyRoom>;
  DIRECTORY: DurableObjectNamespace<RoomDirectory>;
  ADMIN_AUTH: DurableObjectNamespace<AdminAuth>;
  ALLOWED_ORIGINS: string;
  ADMIN_GITHUB_USER_ID: string;
  PUBLIC_SITE_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}
