import type { Page } from 'patchright'
import { postGraphQlWithRetry } from './transport.js'

export type GqlPostOptions = NonNullable<Parameters<typeof postGraphQlWithRetry>[4]>

/**
 * One Air France GraphQL caller, so flows run the same over plain HTTP (impit + saved
 * cookies, no browser) or inside the collector page (Patchright). `page` exists only on the
 * browser client; flows that need a page (navigation, silent re-login) check for it.
 */
export interface GqlClient {
  readonly kind: 'http' | 'browser'
  readonly page?: Page
  post<T>(operationName: string, hash: string, variables: Record<string, unknown>, options?: GqlPostOptions): Promise<T>
}

export const browserClient = (page: Page): GqlClient => ({
  kind: 'browser',
  page,
  post: (operationName, hash, variables, options) => postGraphQlWithRetry(page, operationName, hash, variables, options),
})
