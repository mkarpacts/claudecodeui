// Shared by the binary previews (Word, ZIP): how a failed load is classified

// Failures every preview can hit while fetching the file
export type FetchFailureKind = 'forbidden' | 'notFound' | 'load';

export class PreviewFailure<Kind extends string = string> extends Error {
  constructor(readonly kind: Kind) {
    super(kind);
  }
}

export const failureFromStatus = (status: number): FetchFailureKind => {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  return 'load';
};

// Anything that is not a classified failure (network error, unexpected throw) is a load failure
export function failureKindOf<Kind extends string>(error: unknown): Kind | 'load' {
  if (error instanceof PreviewFailure) {
    return error.kind as Kind;
  }
  console.error('Error loading preview:', error);
  return 'load';
}
