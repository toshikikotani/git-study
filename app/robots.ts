import type { MetadataRoute } from 'next';

/**
 * 検索エンジンにインデックスさせない。
 *
 * 本人専用のアプリであり、公開して価値のあるページが1枚も無い。
 * 認証(M0-3)が入るまでは URL を知る者が誰でも開けるため、
 * 少なくとも検索から到達される経路は塞いでおく(NFR-04)。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
