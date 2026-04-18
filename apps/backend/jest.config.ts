import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: true,
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
        types: ['node', 'jest'],
      },
    }],
  },
  moduleNameMapper: {
    '^@aisbp/types$': '<rootDir>/../../packages/types/src',
    '^@aisbp/db$': '<rootDir>/../../packages/db/src',
    '^@aisbp/ghl-client$': '<rootDir>/../../packages/ghl-client/src',
    '^@aisbp/ai-router$': '<rootDir>/../../packages/ai-router/src',
    '^@aisbp/formatter$': '<rootDir>/../../packages/formatter/src',
  },
};

export default config;
