export function getMutationErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback

  const apolloError = error as {
    message?: string
    graphQLErrors?: Array<{ message?: string }>
  }

  const rawMessage = apolloError.graphQLErrors?.find((item) => item.message)?.message ?? apolloError.message
  if (!rawMessage) return fallback

  return rawMessage
    .replace(/^GraphQL error:\s*/i, '')
    .replace(/^Bad Request Exception:\s*/i, '')
    .trim() || fallback
}
