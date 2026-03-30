/**
 * middlewares/index.ts — 内置中间件统一导出
 */

export { bodyParser } from './bodyParser';
export { staticFiles } from './staticFiles';

export type { BodyParserOptions } from './bodyParser';
export type { StaticFilesOptions } from './staticFiles';
