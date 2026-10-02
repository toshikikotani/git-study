import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript,
  {
    files: ['scripts/design-qa/run.mjs', 'app/(app)/transactions/split-editor.tsx'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    rules: {
      // 金額は必ず整数(円)で扱う(ADR-008)。浮動小数点への逃げ道を塞ぐ。
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: '金額の解析には src/domain/money.ts の parseYen() を使ってください',
        },
      ],
    },
  },
];

export default config;
