import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: `http://localhost:${process.env.PORT || 3000}/graphql`,
  documents: ['src/**/*.graphql'],
  generates: {
    'src/graphql/generated.ts': {
      plugins: [
        'typescript',
        'typescript-operations',
        'typescript-react-apollo',
      ],
      config: {
        withHooks: true,
        withHOC: false,
        withComponent: false,
        withResultType: false,
        withMutationFn: false,
        withMutationOptionsType: false,
        reactApolloVersion: 3,
        apolloReactHooksImportFrom: '@apollo/client/react',
        apolloReactCommonImportFrom: '@apollo/client/react',
        enumsAsTypes: true,
        avoidOptionals: false,
        immutableTypes: false,
        skipTypename: false,
        dedupeFragments: true,
      },
    },
    'src/graphql/schema.json': {
      plugins: ['introspection'],
      config: {
        minify: true,
      },
    },
  },
  hooks: {
    afterAllFileWrite: [
      "node -e \"const f='src/graphql/generated.ts',s=require('fs').readFileSync(f,'utf8');if(!s.startsWith('// @ts-nocheck'))require('fs').writeFileSync(f,'// @ts-nocheck\\n'+s)\"",
      'npx prettier --write',
    ],
  },
  ignoreNoDocuments: true,
}

export default config
