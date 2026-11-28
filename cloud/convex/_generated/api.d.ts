/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as companion from "../companion.js";
import type * as crons from "../crons.js";
import type * as lib_answers from "../lib/answers.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_summary from "../lib/summary.js";
import type * as lib_waiting from "../lib/waiting.js";
import type * as phone from "../phone.js";
import type * as push from "../push.js";
import type * as pushData from "../pushData.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  companion: typeof companion;
  crons: typeof crons;
  "lib/answers": typeof lib_answers;
  "lib/auth": typeof lib_auth;
  "lib/push": typeof lib_push;
  "lib/summary": typeof lib_summary;
  "lib/waiting": typeof lib_waiting;
  phone: typeof phone;
  push: typeof push;
  pushData: typeof pushData;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
