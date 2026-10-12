// Stylesheets are bundled by esbuild.
declare module '*.css';

// Source of a bundled worker, embedded as a string by scripts/build.mjs.
declare module 'worker-source:xlsx' {
  const source: string;
  export default source;
}

declare module 'ssf' {
  export function format(
    format: string | number,
    value: unknown,
    options?: { date1904?: boolean },
  ): string;
}
