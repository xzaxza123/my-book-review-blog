declare module 'virtual:react-press-routes' {
  export interface Route {
    id: string;
    path: string;
    meta: Record<string, any>;
    loader: () => Promise<{ default: React.ComponentType<any> }>;
  }
  export const routes: Route[];
}

