// The types of the environment variables that the web application reads at build time.
// Vite puts only variables that start with `VITE_` into the browser code.
//
// A `.d.ts` file contains only types. These two interfaces have the same names as interfaces in the
// `vite/client` types. TypeScript joins interfaces with the same name ("declaration merging"),
// so this file adds `VITE_API_BASE_URL` to the type of `import.meta.env`.

interface ImportMetaEnv {
  /**
   * The origin of the API, for example `https://api.example.com`. Leave it empty if the web application
   * and the API have the same origin (the Vite proxy in development, or Nginx in Docker).
   * The `?` makes the property optional: the variable can be absent.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
