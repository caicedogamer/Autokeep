/*
 * Tiny hash-based SPA router.
 *
 * Hash routing is used so the app ships as a static SPA with no server
 * URL-rewrite requirement and works equally well over file://, dev
 * server, and any static host. Constitution Principle VII: a routing
 * library is not justified at the project's six-route scope.
 */

export type RouteParams = Readonly<Record<string, string>>;
export type RouteHandler = (params: RouteParams) => void;

export interface RouteDef {
  /** Path pattern, e.g. `/records`, `/records/new`, `/records/:id`. */
  readonly pattern: string;
  readonly handler: RouteHandler;
}

export interface Router {
  start(): void;
  stop(): void;
  navigate(path: string): void;
  /** Currently-resolved path (without the leading `#`). */
  current(): string;
}

interface CompiledRoute {
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: RouteHandler;
}

const compile = (route: RouteDef): CompiledRoute => {
  const paramNames: string[] = [];
  const regexSource = route.pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      // Escape regex special characters in static segments.
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {
    regex: new RegExp(`^${regexSource}$`),
    paramNames,
    handler: route.handler,
  };
};

export interface RouterDeps {
  /** Default path used when the URL has no hash (e.g. on first load). */
  readonly defaultPath: string;
  /** Path used when no route matches (404 surface). */
  readonly notFoundPath: string;
  /** Called after every successful match — used to emit `route:changed`. */
  readonly onChange?: (path: string, params: RouteParams) => void;
}

export const createRouter = (routes: readonly RouteDef[], deps: RouterDeps): Router => {
  const compiled = routes.map(compile);
  let started = false;
  let lastPath = '';

  const resolve = (rawPath: string): void => {
    const path = rawPath || deps.defaultPath;
    for (const route of compiled) {
      const match = route.regex.exec(path);
      if (match) {
        const params: RouteParams = Object.fromEntries(
          route.paramNames.map((name, i) => [name, match[i + 1] ?? '']),
        );
        lastPath = path;
        route.handler(params);
        deps.onChange?.(path, params);
        return;
      }
    }
    // No match: fall through to the not-found route if it is itself a
    // declared route. If not, do nothing — caller misconfigured routes.
    if (path !== deps.notFoundPath) {
      resolve(deps.notFoundPath);
    }
  };

  const onHashChange = (): void => {
    const path = readPath();
    resolve(path);
  };

  const readPath = (): string => {
    const hash = globalThis.location?.hash ?? '';
    return hash.startsWith('#') ? hash.slice(1) : hash;
  };

  const writePath = (path: string): void => {
    if (globalThis.location) {
      globalThis.location.hash = path;
    }
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      globalThis.addEventListener?.('hashchange', onHashChange);
      onHashChange();
    },
    stop(): void {
      if (!started) return;
      started = false;
      globalThis.removeEventListener?.('hashchange', onHashChange);
    },
    navigate(path: string): void {
      writePath(path);
      // hashchange fires asynchronously; resolve eagerly so callers see
      // the side-effect before the event loop turns.
      if (path === readPath()) {
        resolve(path);
      }
    },
    current(): string {
      return lastPath;
    },
  };
};
