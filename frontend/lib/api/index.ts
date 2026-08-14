/**
 * The frontend's entire view of the backend.
 *
 * Components and hooks call `api.dashboard.getOverview()`, never `fetch`. That
 * gives one place where an endpoint path, a query parameter, or a response
 * shape is written down — so a backend change is a diff in this folder rather
 * than a hunt through components.
 */
import { auth } from "./auth";
import { dashboard } from "./dashboard";
import { instagram } from "./instagram";
import { workflows } from "./workflows";
import { workspaces } from "./workspaces";

export const api = {
  auth,
  dashboard,
  instagram,
  workflows,
  workspaces,
};

export { ApiClientError, errorMessage, toFormErrors, http, request } from "./client";
export type { RequestOptions } from "./client";
export type { AuthResult } from "./auth";
export type { DashboardOverview } from "./dashboard";
