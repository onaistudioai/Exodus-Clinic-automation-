// src/lib/llm.ts opens with `import "server-only"` (a Next.js build-time
// guard the package deliberately excludes from node_modules — Next aliases
// it internally). Plain `node` has no bundler to resolve that, so this
// loader stubs it to an empty module. llm.ts has no `@/` imports and no
// next/* imports, so nothing else needs stubbing here.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {}", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
