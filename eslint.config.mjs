import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// L2: `eslint-config-next` 16 já exporta config FLAT nativo. O bridge antigo
// (`FlatCompat` + `compat.extends(...)`) estourava no validador do eslintrc
// ("Converting circular structure to JSON") sob ESLint 9 — o gate de lint nunca
// rodava. Aqui consumimos os arrays flat direto, sem FlatCompat.
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
