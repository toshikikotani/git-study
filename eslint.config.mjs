import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  // mobile/ は iPhone 版(Expo)。型チェックとまとめ(バンドル)は CI の mobile の段で見る(ADR-132)。
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'mobile/**',
      '.agents/**',
      '.claude/skills/**',
      '.hallmark/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
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
