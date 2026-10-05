module.exports = {
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: { target: "ES2022", module: "commonjs", strict: true, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true, skipLibCheck: true, declaration: true, sourceMap: true, types: ["node", "jest"], lib: ["ES2022", "DOM"] } }] },
  testMatch: ["**/*.spec.ts"],
  displayName: "@ftr/resilience",
};
