const path = require("path");
// @ftr/resilience main is dist/ (for node); tests resolve it to src so they don't need a prior build
const lib = path.join(__dirname, "libs/resilience/src/index.ts");
module.exports = {
  testEnvironment: "node",
  moduleNameMapper: { "^@ftr/resilience$": lib },
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      tsconfig: {
        target: "ES2022", module: "commonjs", strict: true, esModuleInterop: true,
        experimentalDecorators: true, emitDecoratorMetadata: true, skipLibCheck: true,
        types: ["node", "jest"], lib: ["ES2022", "DOM"],
        baseUrl: __dirname, paths: { "@ftr/resilience": [lib] },
      },
    }],
  },
  testMatch: ["**/*.spec.ts"],
};
